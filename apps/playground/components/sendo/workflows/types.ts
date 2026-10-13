import type { Account, RuleOrigin, RuleType, RuleView } from "@quami/sendo";

/** A stored rule as the rules screen shows it (plain JSON: crosses the server/client boundary). */
export interface RuleRowView {
  id: string;
  /** The rule's name; unique per tenant. System lines in the inbox quote it («Turno cobranza»). */
  key: string;
  type: RuleType;
  /** Stored params; may not match the schema (`valid: false`). */
  params: Record<string, unknown>;
  /** `null` = every number of the tenant. */
  accountId: string | null;
  position: number;
  active: boolean;
  /** `code` = inserted by `sendo rules sync`; `screen` = created here. */
  origin: RuleOrigin;
  /** `false` when `params` fail the package schema: the engine ignores the rule. */
  valid: boolean;
  /** Validation messages (`path: message` lines) when `valid` is false. */
  error: string | null;
  updatedBy: string | null;
  /** Display name of `updatedBy` (from `resolveUserNames` in `rules-config.ts`), when known. */
  updatedByName: string | null;
  /** ISO timestamp. */
  updatedAt: string;
}

export function serializeRule(rule: RuleView, names: Record<string, string> = {}): RuleRowView {
  return {
    id: rule.id,
    key: rule.key,
    type: rule.type,
    params: rule.params,
    accountId: rule.accountId,
    position: rule.position,
    active: rule.active,
    origin: rule.origin,
    valid: rule.valid,
    error: rule.error,
    updatedBy: rule.updatedBy,
    updatedByName: rule.updatedBy === null ? null : (names[rule.updatedBy] ?? null),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

/** A number a rule can be limited to (no token reference or other server-only fields). */
export interface RuleNumberView {
  id: string;
  label: string | null;
  displayPhone: string;
  /** Rules may store the Meta phone number id instead of the account id. */
  phoneNumberId: string | null;
  active: boolean;
}

export function serializeNumber(account: Account): RuleNumberView {
  return {
    id: account.id,
    label: account.label,
    displayPhone: account.displayPhone,
    phoneNumberId: account.phoneNumberId,
    active: account.active,
  };
}

/** The number a rule (or a route match) points at, by account id or phone number id. */
export function findNumber(numbers: RuleNumberView[], ref: string): RuleNumberView | undefined {
  return numbers.find((number) => number.id === ref || number.phoneNumberId === ref);
}

export type WorkflowsErrorCode = "FORBIDDEN" | "INVALID" | "NOT_FOUND" | "DUPLICATE" | "UNKNOWN";

export type WorkflowsActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: WorkflowsErrorCode;
      /** The server's English detail, for logs; the screen shows `errorMessages[code]`. */
      message: string;
      /** For `INVALID`: messages by field path (`key`, `schedule.mon.0`, `match.keywords.3`). */
      fieldErrors?: Record<string, string>;
    };

/** What the rule editor saves. `id: null` creates a rule; otherwise `key` must be the stored key. */
export interface SaveRuleInput {
  id: string | null;
  key: string;
  type: RuleType;
  params: Record<string, unknown>;
  /** Account id; `null` = every number. */
  account: string | null;
}

/**
 * The server actions the rules screen calls (`app/(protected)/inbox/rules/actions.ts`). Every
 * mutation answers with the tenant's rules in their new order, so the screen re-syncs.
 */
export interface RulesActions {
  listRules(): Promise<WorkflowsActionResult<RuleRowView[]>>;
  saveRule(input: SaveRuleInput): Promise<WorkflowsActionResult<RuleRowView[]>>;
  toggleRule(id: string, enabled: boolean): Promise<WorkflowsActionResult<RuleRowView[]>>;
  reorderRules(ids: string[]): Promise<WorkflowsActionResult<RuleRowView[]>>;
  deleteRule(id: string): Promise<WorkflowsActionResult<RuleRowView[]>>;
}
