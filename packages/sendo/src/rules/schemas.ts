import type { Channel } from "../channels/types";
import type { TenantId } from "../types/entities";

/**
 * Rule definitions (tech spec "Rules engine"). Types only for now: SND-3.4 adds the zod
 * schemas here without renaming any exported type.
 */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** `["09:00", "13:00"]`: local time, start inclusive, end exclusive. */
export type TimeRange = [string, string];

interface RuleScope {
  /** Unique per tenant; `sendo rules sync` upserts by `(tenant, key)`. */
  key: string;
  /** Restricts the rule to one account (sendo account id or phone number id). */
  account?: string;
  tenant?: TenantId;
}

export interface BusinessHoursParams {
  /** IANA time zone, e.g. `"America/Guatemala"`. */
  timezone: string;
  schedule: Record<Weekday, TimeRange[]>;
  /** `YYYY-MM-DD` dates that count as closed all day. */
  holidays?: string[];
  outsideMessage: string;
  /** `"all"` also holds the agent outside hours. */
  appliesTo: "human" | "all";
}

export interface RouteParams {
  match: { channel?: Channel; account?: string; source?: string; keywords?: string[] };
  action: { queue?: string; tags?: string[]; to: "agent" | "human"; reason?: string };
}

export interface AutoAssignParams {
  queue?: string | null;
  strategy: "least_open" | "round_robin";
}

export interface EscalateParams {
  afterMinutes: number;
  queue?: string | null;
  action: "reassign" | "notify" | "return_to_agent";
}

export interface AutoCloseParams {
  afterDays: number;
}

export type BusinessHoursRule = RuleScope & { type: "business_hours"; params: BusinessHoursParams };
export type RouteRule = RuleScope & { type: "route"; params: RouteParams };
export type AutoAssignRule = RuleScope & { type: "auto_assign"; params: AutoAssignParams };
export type EscalateRule = RuleScope & { type: "escalate"; params: EscalateParams };
export type AutoCloseRule = RuleScope & { type: "auto_close"; params: AutoCloseParams };

export type RuleDefinition =
  BusinessHoursRule | RouteRule | AutoAssignRule | EscalateRule | AutoCloseRule;

export type RuleType = RuleDefinition["type"];

/** Identifies the rule in events (`rule.applied`, `escalation`). `id` is `null` for code-only rules. */
export interface RuleRef {
  id: string | null;
  key: string;
  type: RuleType;
}
