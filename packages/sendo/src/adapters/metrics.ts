import type { Channel } from "../channels/types";
import type { MetricsQueryName } from "../metrics/sql";
import type { TenantId } from "../types/entities";
import type {
  SendoAdapter,
  MetricsAdapterQuery,
  MetricsAiResolutionRow,
  MetricsAssigneeRow,
  MetricsCostRow,
  MetricsDailyRow,
  MetricsFirstResponseRow,
  MetricsSourceRow,
} from "./types";

/**
 * Metrics shared by every adapter. Each adapter produces rows at the grain of the
 * `sendo_metrics_*` views (memory computes them, Supabase reads the views, SQL adapters run
 * `METRICS_SQL`), filters them with `MetricsAdapterQuery`, and folds them here, so results
 * only differ if the view rows differ.
 */

// ---------- view rows (camelCase mirrors of the views) ----------

interface ViewScope {
  tenantId: TenantId;
  accountId: string;
  channel: Channel;
  tagIds: string[];
}

interface DayGrain extends ViewScope {
  day: string;
  dayStart: Date;
}

export interface DailyViewRow extends DayGrain {
  inbound: number;
  outbound: number;
  conversationsStarted: number;
  conversationsClosed: number;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
}

export interface AssigneeViewRow extends DayGrain {
  sender: "agent" | "human";
  assignee: string | null;
  conversations: number;
  messagesSent: number;
  firstResponses: number;
  firstResponseSeconds: number[];
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  turns: number;
}

export interface SourceViewRow extends DayGrain {
  source: string | null;
  conversations: number;
}

export type FirstResponseViewRow = MetricsFirstResponseRow & { tenantId: TenantId };
export type AiResolutionViewRow = MetricsAiResolutionRow & { tenantId: TenantId };

// ---------- calendar days in a timezone ----------

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, f);
  }
  return f;
}

function clockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = clockFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    clockFormatters.set(timeZone, f);
  }
  return f;
}

/** `YYYY-MM-DD` of `at` in `timeZone` (Postgres `(at at time zone tz)::date`). */
export function localDay(at: Date, timeZone: string): string {
  return dayFormatter(timeZone).format(at);
}

/** Milliseconds `timeZone` is ahead of UTC at instant `at`. */
function offsetMs(at: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of clockFormatter(timeZone).formatToParts(new Date(at))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** Local midnight of `day` in `timeZone` (Postgres `(day::timestamp at time zone tz)`). */
export function localDayStart(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  let guess = wall - offsetMs(wall, timeZone);
  guess = wall - offsetMs(guess, timeZone);
  return new Date(guess);
}

// ---------- filters ----------

function inRange(at: Date, q: MetricsAdapterQuery): boolean {
  const t = at.getTime();
  return t >= q.from.getTime() && t < q.to.getTime();
}

function inScope(row: ViewScope & { tenantId: TenantId }, q: MetricsAdapterQuery): boolean {
  if (row.tenantId !== q.tenantId) return false;
  if (q.accountId !== undefined && row.accountId !== q.accountId) return false;
  const tags = q.tagIds ?? [];
  return tags.length === 0 || row.tagIds.some((id) => tags.includes(id));
}

/** `MetricsAdapterQuery` on day-grain view rows (`dayStart` in range). */
export function matchesDay(row: DayGrain, q: MetricsAdapterQuery): boolean {
  return inScope(row, q) && inRange(row.dayStart, q);
}

export function matchesFirstResponse(row: FirstResponseViewRow, q: MetricsAdapterQuery): boolean {
  return inScope(row, q) && inRange(row.firstInboundAt, q);
}

export function matchesAiResolution(row: AiResolutionViewRow, q: MetricsAdapterQuery): boolean {
  return inScope(row, q) && inRange(row.closedAt, q);
}

// ---------- folding ----------

const CENT_SCALE = 10_000;
/** `numeric(…, 4)` cents: removes float noise from JavaScript sums. */
export const roundCents = (n: number): number => Math.round(n * CENT_SCALE) / CENT_SCALE;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullableText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareText(a, b);
}

/** Interpolated median (Postgres `percentile_cont(0.5)`) of ascending values. */
export function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) / 2;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? 0;
  return a + (b - a) * (pos - lo);
}

function groupBy<R, K>(rows: readonly R[], key: (r: R) => string, init: (r: R) => K) {
  const groups = new Map<string, { value: K; rows: R[] }>();
  for (const row of rows) {
    const k = key(row);
    let g = groups.get(k);
    if (!g) {
      g = { value: init(row), rows: [] };
      groups.set(k, g);
    }
    g.rows.push(row);
  }
  return [...groups.values()];
}

const sum = <R>(rows: readonly R[], pick: (r: R) => number): number =>
  rows.reduce((total, r) => total + pick(r), 0);

export function foldDaily(rows: readonly DailyViewRow[]): MetricsDailyRow[] {
  return groupBy(
    rows,
    (r) => JSON.stringify([r.day, r.accountId, r.channel]),
    (r) => ({ day: r.day, accountId: r.accountId, channel: r.channel }),
  )
    .map(({ value, rows: g }) => ({
      ...value,
      inbound: sum(g, (r) => r.inbound),
      outbound: sum(g, (r) => r.outbound),
      conversationsStarted: sum(g, (r) => r.conversationsStarted),
      conversationsClosed: sum(g, (r) => r.conversationsClosed),
      costCents: roundCents(sum(g, (r) => r.costCents)),
      tokensIn: sum(g, (r) => r.tokensIn),
      tokensOut: sum(g, (r) => r.tokensOut),
    }))
    .sort(
      (a, b) =>
        compareText(a.day, b.day) ||
        compareText(a.accountId, b.accountId) ||
        compareText(a.channel, b.channel),
    );
}

function groupAssignees(rows: readonly AssigneeViewRow[], sender: "agent" | "human") {
  return groupBy(
    rows.filter((r) => r.sender === sender),
    (r) => JSON.stringify([r.day, r.assignee]),
    (r) => ({ day: r.day, assignee: r.assignee }),
  ).sort(
    (a, b) =>
      compareText(a.value.day, b.value.day) ||
      compareNullableText(a.value.assignee, b.value.assignee),
  );
}

export function foldByAssignee(rows: readonly AssigneeViewRow[]): MetricsAssigneeRow[] {
  return groupAssignees(rows, "human").map(({ value, rows: g }) => {
    const seconds = g.flatMap((r) => r.firstResponseSeconds).sort((a, b) => a - b);
    return {
      day: value.day,
      assignee: value.assignee,
      conversations: sum(g, (r) => r.conversations),
      messagesSent: sum(g, (r) => r.messagesSent),
      firstResponses: sum(g, (r) => r.firstResponses),
      firstResponseSeconds: seconds,
      medianFirstResponseSeconds: median(seconds),
    };
  });
}

export function foldCost(rows: readonly AssigneeViewRow[]): MetricsCostRow[] {
  return groupAssignees(rows, "agent").map(({ value, rows: g }) => ({
    day: value.day,
    agent: value.assignee,
    costCents: roundCents(sum(g, (r) => r.costCents)),
    tokensIn: sum(g, (r) => r.tokensIn),
    tokensOut: sum(g, (r) => r.tokensOut),
    turns: sum(g, (r) => r.turns),
  }));
}

export function foldBySource(rows: readonly SourceViewRow[]): MetricsSourceRow[] {
  return groupBy(
    rows,
    (r) => JSON.stringify([r.day, r.source]),
    (r) => ({ day: r.day, source: r.source }),
  )
    .map(({ value, rows: g }) => ({ ...value, conversations: sum(g, (r) => r.conversations) }))
    .sort(
      (a, b) =>
        compareText(a.day, b.day) ||
        b.conversations - a.conversations ||
        compareNullableText(a.source, b.source),
    );
}

export function foldFirstResponse(
  rows: readonly FirstResponseViewRow[],
): MetricsFirstResponseRow[] {
  return rows
    .map(({ tenantId: _tenantId, ...row }) => row)
    .sort(
      (a, b) =>
        a.firstInboundAt.getTime() - b.firstInboundAt.getTime() ||
        compareText(a.conversationId, b.conversationId),
    );
}

export function foldAiResolution(rows: readonly AiResolutionViewRow[]): MetricsAiResolutionRow[] {
  return rows
    .map(({ tenantId: _tenantId, ...row }) => row)
    .sort(
      (a, b) =>
        a.closedAt.getTime() - b.closedAt.getTime() ||
        compareText(a.conversationId, b.conversationId),
    );
}

// ---------- database rows (PostgREST JSON, `pg`, Prisma) ----------

/** A `sendo_metrics_*` view row as any Postgres client returns it (snake_case). */
export type MetricsDbRow = Record<string, unknown>;

/** `numeric`, `bigint` (string in `pg`) or Prisma `Decimal` → number. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function timestamp(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

/** `date` column: PostgREST sends `YYYY-MM-DD`; `pg` parses it as local midnight. */
function day(value: unknown): string {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function scope(row: MetricsDbRow): ViewScope & { tenantId: TenantId } {
  return {
    tenantId: text(row.tenant_id),
    accountId: String(row.account_id),
    channel: String(row.channel) as Channel,
    tagIds: ids(row.tag_ids),
  };
}

function dayGrain(row: MetricsDbRow): DayGrain {
  return { ...scope(row), day: day(row.day), dayStart: timestamp(row.day_start) };
}

export function dailyFromDb(row: MetricsDbRow): DailyViewRow {
  return {
    ...dayGrain(row),
    inbound: num(row.inbound),
    outbound: num(row.outbound),
    conversationsStarted: num(row.conversations_started),
    conversationsClosed: num(row.conversations_closed),
    costCents: num(row.cost_cents),
    tokensIn: num(row.tokens_in),
    tokensOut: num(row.tokens_out),
  };
}

export function assigneeFromDb(row: MetricsDbRow): AssigneeViewRow {
  const seconds = Array.isArray(row.first_response_seconds) ? row.first_response_seconds : [];
  return {
    ...dayGrain(row),
    sender: row.sender === "agent" ? "agent" : "human",
    assignee: text(row.assignee),
    conversations: num(row.conversations),
    messagesSent: num(row.messages_sent),
    firstResponses: num(row.first_responses),
    firstResponseSeconds: seconds.map(Number),
    costCents: num(row.cost_cents),
    tokensIn: num(row.tokens_in),
    tokensOut: num(row.tokens_out),
    turns: num(row.turns),
  };
}

export function sourceFromDb(row: MetricsDbRow): SourceViewRow {
  return { ...dayGrain(row), source: text(row.source), conversations: num(row.conversations) };
}

export function firstResponseFromDb(row: MetricsDbRow): FirstResponseViewRow {
  const responder = text(row.responder);
  return {
    ...scope(row),
    conversationId: String(row.conversation_id),
    contactId: String(row.contact_id),
    assignedTo: text(row.assigned_to),
    source: text(row.source),
    day: day(row.day),
    firstInboundAt: timestamp(row.first_inbound_at),
    firstResponseAt: row.first_response_at == null ? null : timestamp(row.first_response_at),
    responder: responder === "agent" || responder === "human" ? responder : null,
    responderRef: text(row.responder_ref),
    seconds: numOrNull(row.response_seconds),
  };
}

export function aiResolutionFromDb(row: MetricsDbRow): AiResolutionViewRow {
  return {
    ...scope(row),
    conversationId: String(row.conversation_id),
    source: text(row.source),
    day: day(row.day),
    createdAt: timestamp(row.created_at),
    closedAt: timestamp(row.closed_at),
    everHuman: row.ever_human === true,
    humanMessages: num(row.human_messages),
    agentMessages: num(row.agent_messages),
    aiResolved: row.ai_resolved === true,
  };
}

/**
 * `metrics` namespace for adapters that run `METRICS_SQL` (Drizzle, Prisma): `run` executes
 * one query with `metricsSqlParams(query)` and returns the raw rows.
 */
export function metricsFromSql(
  run: (name: MetricsQueryName, query: MetricsAdapterQuery) => Promise<MetricsDbRow[]>,
): SendoAdapter["metrics"] {
  return {
    daily: async (q) => foldDaily((await run("daily", q)).map(dailyFromDb)),
    byAssignee: async (q) => foldByAssignee((await run("byAssignee", q)).map(assigneeFromDb)),
    firstResponse: async (q) =>
      foldFirstResponse((await run("firstResponse", q)).map(firstResponseFromDb)),
    aiResolution: async (q) =>
      foldAiResolution((await run("aiResolution", q)).map(aiResolutionFromDb)),
    bySource: async (q) => foldBySource((await run("bySource", q)).map(sourceFromDb)),
    cost: async (q) => foldCost((await run("cost", q)).map(assigneeFromDb)),
  };
}
