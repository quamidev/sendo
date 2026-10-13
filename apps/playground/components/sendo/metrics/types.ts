import type { MetricsStrings } from "./strings";
import type {
  Account,
  MetricsAiResolutionRow,
  MetricsAssignee,
  MetricsCostRow,
  MetricsDaily,
  MetricsFirstResponseRow,
  MetricsSourceRow,
  Tag,
  TagColor,
} from "@quami/sendo";

/** A number in the filter (no token reference or other server-only fields). */
export interface MetricsNumberView {
  id: string;
  label: string | null;
  displayPhone: string;
  isDefault: boolean;
  active: boolean;
  timezone: string;
}

export function serializeMetricsNumber(account: Account): MetricsNumberView {
  return {
    id: account.id,
    label: account.label,
    displayPhone: account.displayPhone,
    isDefault: account.isDefault,
    active: account.active,
    timezone: account.timezone,
  };
}

export interface MetricsTagView {
  id: string;
  name: string;
  color: TagColor;
}

export function serializeMetricsTag(tag: Tag): MetricsTagView {
  return { id: tag.id, name: tag.name, color: tag.color };
}

/** What the filter row selects. Days are `YYYY-MM-DD`, both included. */
export interface MetricsFilters {
  from: string;
  to: string;
  /** Account id; `null` = every number of the tenant. */
  account: string | null;
  /** Any-match; empty = every conversation. */
  tagIds: string[];
}

/** Everything `sendo.metrics.*` returned for one filter selection (`cost` is `null` without `costs.view`). */
export interface MetricsRaw {
  daily: MetricsDaily[];
  byAssignee: MetricsAssignee[];
  firstResponse: MetricsFirstResponseRow[];
  aiResolution: MetricsAiResolutionRow[];
  bySource: MetricsSourceRow[];
  cost: MetricsCostRow[] | null;
}

/** One calendar day of the range (days without activity are zeros). */
export interface MetricsDayPoint {
  day: string;
  inbound: number;
  outbound: number;
  conversations: number;
  /** `null` without `costs.view`. */
  costCents: number | null;
}

export interface MetricsKpis {
  messages: number;
  inbound: number;
  outbound: number;
  conversations: number;
  /** Median seconds to the first reply (AI or person) of conversations started in range. */
  medianFirstResponseSeconds: number | null;
  /** The same, only replies sent by people. */
  teamMedianFirstResponseSeconds: number | null;
  /** Conversations with an inbound message in range and no reply yet. */
  unanswered: number;
  /** Conversations closed in range. */
  closed: number;
  aiResolved: number;
  /** `aiResolved / closed`; `null` when nothing closed. */
  aiResolvedShare: number | null;
}

export interface MetricsAssigneeSummary {
  /** User id, `business_app` for replies from the WhatsApp Business app, `""` when not recorded. */
  id: string;
  name: string | null;
  /** Sum over days of conversations they wrote in (a conversation counts once per day). */
  conversationDays: number;
  messagesSent: number;
  firstResponses: number;
  medianFirstResponseSeconds: number | null;
}

export interface MetricsSourceSummary {
  /** `null` = no attribution ("Directo"). */
  source: string | null;
  conversations: number;
}

export interface MetricsTagSummary {
  /** `null` = conversations without tags. */
  id: string | null;
  name: string | null;
  color: TagColor | null;
  /** Conversations whose first inbound message is in range. */
  conversations: number;
  medianFirstResponseSeconds: number | null;
  closed: number;
  aiResolved: number;
}

export interface MetricsAgentCost {
  /** AI agent name. */
  agent: string | null;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  turns: number;
}

/** What the screen renders; computed on the server by `summarizeMetrics`. */
export interface MetricsReport {
  filters: MetricsFilters;
  /** Timezone the days were read in. */
  timeZone: string;
  days: MetricsDayPoint[];
  kpis: MetricsKpis;
  assignees: MetricsAssigneeSummary[];
  sources: MetricsSourceSummary[];
  tags: MetricsTagSummary[];
  /** `null` without `costs.view` (supervisors). */
  cost: { totalCents: number; perAgent: MetricsAgentCost[] } | null;
}

export type MetricsErrorCode = "FORBIDDEN" | "INVALID" | "NOT_FOUND" | "UNKNOWN";

export type MetricsActionResult<T> =
  { ok: true; data: T } | { ok: false; code: MetricsErrorCode; message: string };

/** The server action the screen calls (`app/(protected)/inbox/metrics/actions.ts`). */
export interface MetricsActions {
  loadMetrics(filters: MetricsFilters): Promise<MetricsActionResult<MetricsReport>>;
}

/**
 * The timezone days are read in: the selected number's, else the tenant's default number's, else
 * the first connected one's, else UTC.
 */
export function metricsTimeZone(numbers: MetricsNumberView[], account: string | null): string {
  const pick =
    (account === null ? undefined : numbers.find((number) => number.id === account)) ??
    numbers.find((number) => number.isDefault) ??
    numbers.find((number) => number.active) ??
    numbers[0];
  return pick?.timezone ?? "UTC";
}

/** Longest range one request may read (days, both ends included). */
export const METRICS_MAX_DAYS = 366;

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function dayToUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** `day` moved by `delta` calendar days (`YYYY-MM-DD` arithmetic, no timezone). */
export function addDays(day: string, delta: number): string {
  return new Date(dayToUtc(day) + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Days from `from` to `to`, both included (`[]` when `to < from`). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to && out.length <= METRICS_MAX_DAYS; day = addDays(day, 1)) {
    out.push(day);
  }
  return out;
}

/** Number of days in `[from, to]`, both included. */
export function rangeLength(from: string, to: string): number {
  return Math.round((dayToUtc(to) - dayToUtc(from)) / 86_400_000) + 1;
}

/** `true` for a real calendar date in `YYYY-MM-DD`. */
export function isDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DAY_PATTERN.test(value) &&
    new Date(dayToUtc(value)).toISOString().slice(0, 10) === value
  );
}

export const RANGE_PRESETS = [7, 30, 90] as const;

/** Today in `timeZone`, `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function presetRange(days: number, today: string): Pick<MetricsFilters, "from" | "to"> {
  return { from: addDays(today, -(days - 1)), to: today };
}

/** `null` when valid, else the message to show. */
export function rangeError(from: string, to: string, strings: MetricsStrings): string | null {
  if (!isDay(from) || !isDay(to) || to < from) return strings.rangeInvalid;
  if (rangeLength(from, to) > METRICS_MAX_DAYS) return strings.rangeTooLong(METRICS_MAX_DAYS);
  return null;
}
