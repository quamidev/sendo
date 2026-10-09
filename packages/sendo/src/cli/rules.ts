import type { SendoAdapter } from "../adapters/types";
import { syncRules, type SyncRuleOutcome } from "../rules/sync";
import { loadRulesFromConfig } from "./config-loader";

export interface RulesSyncCliInput {
  adapter: SendoAdapter;
  configPath: string;
  cwd: string;
  force: boolean;
  tenant?: string;
}

const OUTCOME_LABEL: Record<SyncRuleOutcome, string> = {
  created: "creada",
  updated: "sobrescrita (--force)",
  unchanged: "ya existía, sin cambios",
  skipped: "omitida (otro tenant)",
};

export interface RulesSyncCliResult {
  ok: boolean;
  text: string;
}

/** `sendo rules sync`: loads `rules` from `--config` and upserts them with `origin = "code"`. */
export async function runRulesSync(input: RulesSyncCliInput): Promise<RulesSyncCliResult> {
  const definitions = await loadRulesFromConfig(input.configPath, input.cwd);
  const result = await syncRules(input.adapter, definitions, {
    force: input.force,
    ...(input.tenant === undefined ? {} : { tenant: input.tenant }),
    by: "cli",
  });
  if (result.errors.length > 0) {
    return {
      ok: false,
      text: [
        "Reglas inválidas; no se guardó ninguna:",
        ...result.errors.map((e) => `  - ${e}`),
      ].join("\n"),
    };
  }
  if (result.rules.length === 0) return { ok: true, text: "No hay reglas que sincronizar." };
  const lines = result.rules.map((r) => {
    const tenant = r.tenantId === null ? "sin tenant" : `tenant ${r.tenantId}`;
    return `  ${r.key} (${r.type}, ${tenant}): ${OUTCOME_LABEL[r.outcome]}`;
  });
  const kept = result.rules.filter((r) => r.outcome === "unchanged").length;
  if (kept > 0 && !input.force) {
    lines.push(
      `${String(kept)} regla(s) ya existían y se conservaron tal como están (usa --force para sobrescribirlas con el código).`,
    );
  }
  return { ok: true, text: ["Reglas sincronizadas:", ...lines].join("\n") };
}
