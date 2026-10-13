import type { z } from "zod";
import type { SendoAdapter } from "../adapters/types";
import { isUuid } from "../core/accounts";
import type { JsonObject, TenantId } from "../types/entities";
import { formatRuleIssues, ruleDefinitionSchema, type RuleDefinition } from "./schemas";

export interface SyncRulesOptions {
  /** Overwrite `params`, type and account of rules that already exist (default: insert missing only). */
  force?: boolean;
  /**
   * Tenant for rules that don't declare one; rules declaring another tenant are skipped.
   * Omitted: each rule's own `tenant` (`null` when absent).
   */
  tenant?: TenantId;
  /** Recorded as `updatedBy`. */
  by?: string;
}

const EXPECTED: Record<string, string> = {
  string: "un texto",
  number: "un número",
  int: "un número entero",
  array: "una lista",
  object: "un objeto",
  boolean: "true o false",
};

/** Spanish text for zod's generic issues; the schemas' own Spanish messages take precedence. */
function ruleIssueMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case "invalid_type": {
      const expected = EXPECTED[issue.expected] ?? "otro tipo de valor";
      return issue.input === undefined
        ? `Falta este campo (se espera ${expected}).`
        : `Se espera ${expected}.`;
    }
    case "invalid_value":
      return `Usa uno de: ${issue.values.map((v) => JSON.stringify(v)).join(", ")}.`;
    case "invalid_union": {
      const options = (issue as { options?: unknown }).options;
      return Array.isArray(options)
        ? `Valor desconocido; usa uno de: ${options.map(String).join(", ")}.`
        : "Valor inválido.";
    }
    case "too_small":
      if (issue.origin === "number") return `Debe ser al menos ${String(issue.minimum)}.`;
      if (issue.origin === "array") return `Necesita al menos ${String(issue.minimum)} elementos.`;
      return "No puede estar vacío.";
    case "too_big":
      if (issue.origin === "number") return `Debe ser como máximo ${String(issue.maximum)}.`;
      if (issue.origin === "array") return `Máximo ${String(issue.maximum)} elementos.`;
      return `Máximo ${String(issue.maximum)} caracteres.`;
    default:
      return undefined;
  }
}

export type SyncRuleOutcome = "created" | "updated" | "unchanged" | "skipped";

export interface SyncRulesResult {
  rules: {
    key: string;
    tenantId: TenantId;
    type: RuleDefinition["type"];
    outcome: SyncRuleOutcome;
  }[];
  /** Invalid definitions (`index`/`key`: message); when any, nothing was written. */
  errors: string[];
}

/**
 * `sendo rules sync`: validates every definition, then upserts by `(tenant, key)` with
 * `origin: "code"`. Existing rules are left untouched unless `force`, which replaces their
 * type, params and account (position and on/off state stay as the screen left them).
 */
export async function syncRules(
  adapter: SendoAdapter,
  definitions: unknown,
  opts: SyncRulesOptions = {},
): Promise<SyncRulesResult> {
  const result: SyncRulesResult = { rules: [], errors: [] };
  if (!Array.isArray(definitions)) {
    result.errors.push("`rules` debe ser un arreglo de reglas.");
    return result;
  }
  const valid: RuleDefinition[] = [];
  const seen = new Set<string>();
  definitions.forEach((definition: unknown, index) => {
    const parsed = ruleDefinitionSchema.safeParse(definition, { error: ruleIssueMessage });
    if (!parsed.success) {
      const key =
        typeof definition === "object" && definition !== null && "key" in definition
          ? String(definition.key)
          : `#${String(index)}`;
      result.errors.push(`${key}: ${formatRuleIssues(parsed.error).replace(/\n/g, "; ")}`);
      return;
    }
    const tenant = parsed.data.tenant ?? opts.tenant ?? null;
    const id = `${tenant ?? ""}\u0000${parsed.data.key}`;
    if (seen.has(id)) {
      result.errors.push(`${parsed.data.key}: clave repetida.`);
      return;
    }
    seen.add(id);
    valid.push(parsed.data);
  });

  const accountIds = new Map<string, string>();
  for (const rule of valid) {
    const ref = rule.account;
    if (ref === undefined || accountIds.has(ref)) continue;
    const account =
      (isUuid(ref) ? await adapter.accounts.getById(ref) : null) ??
      (await adapter.accounts.getByPhoneNumberId(ref));
    if (account === null) {
      result.errors.push(`${rule.key}: no existe la cuenta ${ref}.`);
      continue;
    }
    const tenant = rule.tenant ?? opts.tenant ?? null;
    if (account.tenantId !== tenant) {
      result.errors.push(`${rule.key}: la cuenta ${ref} no pertenece al tenant de la regla.`);
      continue;
    }
    accountIds.set(ref, account.id);
  }
  if (result.errors.length > 0) return result;

  for (const rule of valid) {
    const tenantId = rule.tenant ?? opts.tenant ?? null;
    if (opts.tenant !== undefined && tenantId !== opts.tenant) {
      result.rules.push({ key: rule.key, tenantId, type: rule.type, outcome: "skipped" });
      continue;
    }
    const accountId = rule.account === undefined ? null : (accountIds.get(rule.account) ?? null);
    const { rule: stored, created } = await adapter.rules.upsert(
      {
        tenantId,
        key: rule.key,
        type: rule.type,
        params: rule.params as unknown as JsonObject,
        accountId,
        origin: "code",
        updatedBy: opts.by ?? null,
      },
      { ifMissing: opts.force !== true },
    );
    result.rules.push({
      key: stored.key,
      tenantId,
      type: stored.type,
      outcome: created ? "created" : opts.force === true ? "updated" : "unchanged",
    });
  }
  return result;
}
