"use server";

import {
  assertCan,
  isSendoError,
  RULE_TYPES,
  type Actor,
  type RuleInput,
  type RuleType,
} from "@quami/sendo";
import { defaultWorkflowsStrings } from "@/components/sendo/workflows/strings";
import {
  serializeRule,
  type RuleRowView,
  type SaveRuleInput,
  type WorkflowsActionResult,
  type WorkflowsErrorCode,
} from "@/components/sendo/workflows/types";
import { validateRule, type FieldErrors } from "@/components/sendo/workflows/validation";
import { sendo } from "@/lib/sendo";
import { requireUser, resolveUserNames, type RulesUser } from "./rules-config";

class InvalidInputError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
  }
}
class DuplicateKeyError extends Error {}
class UnknownRuleError extends Error {}

function errorCode(error: unknown): WorkflowsErrorCode {
  if (error instanceof InvalidInputError) return "INVALID";
  if (error instanceof DuplicateKeyError) return "DUPLICATE";
  if (error instanceof UnknownRuleError) return "NOT_FOUND";
  if (!isSendoError(error)) return "UNKNOWN";
  switch (error.code) {
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "RECORD_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
      return "NOT_FOUND";
    case "INVALID_PAYLOAD":
      return "INVALID";
    default:
      return "UNKNOWN";
  }
}

/** Runs `fn` and turns errors into `{ ok: false }`. Library errors carry user-safe messages. */
async function attempt<T>(fn: () => Promise<T>): Promise<WorkflowsActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const code = errorCode(error);
    if (code === "UNKNOWN") console.error("[sendo rules]", error);
    const message =
      error instanceof Error && (code !== "UNKNOWN" || isSendoError(error))
        ? error.message
        : "Unexpected error";
    return {
      ok: false,
      code,
      message,
      ...(error instanceof InvalidInputError &&
        error.fieldErrors !== undefined && { fieldErrors: error.fieldErrors }),
    };
  }
}

/** Rules are an admin tool (`rules.manage`), scoped to the user's tenant. */
async function actorOf(user: RulesUser): Promise<Actor> {
  const actor = await sendo.actor(user.userId, user.tenantId);
  assertCan(actor, "rules.manage");
  return actor;
}

/** The tenant's rules in evaluation order, with the editors' names when the app provides them. */
async function snapshot(actor: Actor): Promise<RuleRowView[]> {
  const rules = await sendo.rules.list({ actor });
  const editors = [
    ...new Set(rules.flatMap((rule) => (rule.updatedBy === null ? [] : [rule.updatedBy]))),
  ];
  const names =
    editors.length === 0
      ? {}
      : await resolveUserNames(editors).catch((error: unknown) => {
          console.error("[sendo rules] resolveUserNames failed", error);
          return {};
        });
  return rules.map((rule) => serializeRule(rule, names));
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.length > 200) {
    throw new InvalidInputError("Invalid rule id");
  }
  return value;
}

function requireType(value: unknown): RuleType {
  const type = RULE_TYPES.find((candidate) => candidate === value);
  if (type === undefined) throw new InvalidInputError("Invalid rule type");
  return type;
}

/** The tenant's rules. */
export async function listRules(): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const user = await requireUser();
  return attempt(async () => snapshot(await actorOf(user)));
}

/**
 * Creates (`id: null`) or updates a rule. Validated with the package schemas here and again by
 * `sendo.rules.upsert`, which records `updatedBy`. Names are unique and never change.
 */
export async function saveRule(
  input: SaveRuleInput,
): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const type = requireType(input.type);
    const validation = validateRule(
      { key: input.key, type, params: input.params },
      defaultWorkflowsStrings,
    );
    if (!validation.ok) {
      throw new InvalidInputError(defaultWorkflowsStrings.fixErrors, validation.errors);
    }
    const existing = await sendo.rules.list({ actor });
    if (input.id === null) {
      if (existing.some((rule) => rule.key === validation.key))
        throw new DuplicateKeyError("Duplicate rule name");
    } else {
      const current = existing.find((rule) => rule.id === requireId(input.id));
      if (current === undefined) throw new UnknownRuleError("Unknown rule");
      if (current.key !== validation.key || current.type !== type) {
        throw new InvalidInputError("A rule's name and type can't change");
      }
    }
    const account = input.account === null ? null : requireId(input.account);
    await sendo.rules.upsert(
      {
        key: validation.key,
        type,
        params: validation.params as unknown as RuleInput["params"],
        account,
      },
      { actor },
    );
    return snapshot(actor);
  });
}

/** Turns a rule on or off. */
export async function toggleRule(
  id: string,
  enabled: boolean,
): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    if (typeof enabled !== "boolean") throw new InvalidInputError("Invalid enabled flag");
    await sendo.rules.toggle(requireId(id), enabled, { actor });
    return snapshot(actor);
  });
}

/** Sets the evaluation order: `ids` first to last. */
export async function reorderRules(ids: string[]): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    if (!Array.isArray(ids) || ids.length > 1000) throw new InvalidInputError("Invalid order");
    await sendo.rules.reorder(ids.map(requireId), { actor });
    return snapshot(actor);
  });
}

/** Deletes a rule. Code-defined rules come back on the next `sendo rules sync`. */
export async function deleteRule(id: string): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    await sendo.rules.delete(requireId(id), { actor });
    return snapshot(actor);
  });
}
