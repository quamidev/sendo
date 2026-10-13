import { z } from "zod";
import type { Channel } from "../channels/types";
import type { TenantId } from "../types/entities";

/**
 * Rule definitions (tech spec "Rules engine") and their zod schemas. The same schemas validate
 * code-defined rules (`sendo rules sync`), rules written through `sendo.rules.upsert` and the
 * `params` read back from storage.
 */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** `["09:00", "13:00"]`: local time, start inclusive, end exclusive (`"24:00"` = midnight). */
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

/** Params of one rule type. */
export type RuleParams<T extends RuleType = RuleType> = Extract<
  RuleDefinition,
  { type: T }
>["params"];

/** Identifies the rule in events (`rule.applied`, `escalation`). `id` is `null` for code-only rules. */
export interface RuleRef {
  id: string | null;
  key: string;
  type: RuleType;
}

// ---------- zod schemas ----------

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const satisfies readonly Weekday[];

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const nonBlank = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "No puede estar vacío.")
    .max(max, `Máximo ${String(max)} caracteres.`);

/** Rule keys: 1–64 characters, no leading or trailing spaces. */
export const ruleKeySchema = nonBlank(64);

export const timeRangeSchema: z.ZodType<TimeRange> = z
  .tuple([
    z.string().regex(TIME_RE, "Usa HH:MM (00:00–24:00)."),
    z.string().regex(TIME_RE, "Usa HH:MM (00:00–24:00)."),
  ])
  .refine(([start, end]) => start < end, "El inicio debe ser anterior al fin.");

const daySchema = z.array(timeRangeSchema).max(12);

export const businessHoursParamsSchema: z.ZodType<BusinessHoursParams> = z.object({
  timezone: z.string().refine(isTimeZone, "Zona horaria IANA desconocida."),
  schedule: z.object({
    mon: daySchema,
    tue: daySchema,
    wed: daySchema,
    thu: daySchema,
    fri: daySchema,
    sat: daySchema,
    sun: daySchema,
  }),
  holidays: z.array(z.string().regex(DATE_RE, "Usa AAAA-MM-DD.")).max(366).optional(),
  outsideMessage: nonBlank(4096),
  appliesTo: z.enum(["human", "all"]),
});

export const routeParamsSchema: z.ZodType<RouteParams> = z.object({
  match: z.object({
    channel: z.enum(["whatsapp"]).optional(),
    account: nonBlank(128).optional(),
    source: z
      .string()
      .regex(/^(?:[a-z0-9-]{1,32}|ad:[^\s]{1,128})$/, "Código de origen inválido.")
      .optional(),
    keywords: z.array(nonBlank(64)).max(100).optional(),
  }),
  action: z.object({
    queue: nonBlank(64).optional(),
    tags: z.array(nonBlank(64)).max(20).optional(),
    to: z.enum(["agent", "human"]),
    reason: nonBlank(500).optional(),
  }),
});

export const autoAssignParamsSchema: z.ZodType<AutoAssignParams> = z.object({
  queue: nonBlank(64).nullable().optional(),
  strategy: z.enum(["least_open", "round_robin"]),
});

export const escalateParamsSchema: z.ZodType<EscalateParams> = z.object({
  afterMinutes: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60),
  queue: nonBlank(64).nullable().optional(),
  action: z.enum(["reassign", "notify", "return_to_agent"]),
});

export const autoCloseParamsSchema: z.ZodType<AutoCloseParams> = z.object({
  afterDays: z.number().int().min(1).max(365),
});

/** The params schema of each rule type. */
export const ruleParamsSchemas = {
  business_hours: businessHoursParamsSchema,
  route: routeParamsSchema,
  auto_assign: autoAssignParamsSchema,
  escalate: escalateParamsSchema,
  auto_close: autoCloseParamsSchema,
} as const satisfies { [T in RuleType]: z.ZodType<RuleParams<T>> };

export const ruleTypeSchema = z.enum([
  "business_hours",
  "route",
  "auto_assign",
  "escalate",
  "auto_close",
]);

const scopeShape = {
  key: ruleKeySchema,
  account: nonBlank(128).optional(),
  tenant: z.string().nullable().optional(),
};

/** A whole code-defined rule (`rules: RuleDefinition[]`). */
export const ruleDefinitionSchema: z.ZodType<RuleDefinition> = z.discriminatedUnion("type", [
  z.object({ ...scopeShape, type: z.literal("business_hours"), params: businessHoursParamsSchema }),
  z.object({ ...scopeShape, type: z.literal("route"), params: routeParamsSchema }),
  z.object({ ...scopeShape, type: z.literal("auto_assign"), params: autoAssignParamsSchema }),
  z.object({ ...scopeShape, type: z.literal("escalate"), params: escalateParamsSchema }),
  z.object({ ...scopeShape, type: z.literal("auto_close"), params: autoCloseParamsSchema }),
]);

export type RuleParamsResult<T extends RuleType> =
  { success: true; params: RuleParams<T> } | { success: false; error: string };

/** `"schedule.mon.0: El inicio debe ser anterior al fin."` lines. */
export function formatRuleIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("\n");
}

/** Validates `params` against the schema of `type`. */
export function parseRuleParams<T extends RuleType>(type: T, params: unknown): RuleParamsResult<T> {
  const schema = ruleParamsSchemas[type] as z.ZodType<RuleParams<T>>;
  const result = schema.safeParse(params);
  return result.success
    ? { success: true, params: result.data }
    : { success: false, error: formatRuleIssues(result.error) };
}
