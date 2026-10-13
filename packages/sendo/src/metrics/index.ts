import { localDay, localDayStart } from "../adapters/metrics";
import type {
  MetricsAdapterQuery,
  MetricsAiResolutionRow,
  MetricsAssigneeRow,
  MetricsCostRow,
  MetricsDailyRow,
  MetricsFirstResponseRow,
  MetricsSourceRow,
} from "../adapters/types";
import type { SendoContext } from "../core/context";
import { findAccount } from "../core/accounts/resolver";
import { AccountNotFoundError, PayloadValidationError } from "../errors/errors";
import { assertCan, can, requireActor, type Actor } from "../team/permissions";

/** At most this many tag ids per query (any-match). */
export const METRICS_MAX_TAG_IDS = 100;

/**
 * What every `sendo.metrics.*` method takes. The tenant is always the actor's.
 *
 * Days are calendar days in each account's timezone: a daily row counts when its local
 * midnight is in `[from, to)`, so pass local midnights (`metricsDayRange`). Per-conversation
 * rows count when their own timestamp (`firstInboundAt`, `closedAt`) is in `[from, to)`.
 */
export interface MetricsQuery {
  /** Needs `metrics.view` (supervisor, admin); `cost` also needs `costs.view` (admin). */
  actor: Actor;
  from: Date;
  /** Exclusive. */
  to: Date;
  /** One number: account id or Meta phone number id of the actor's tenant (connected or not). */
  account?: string;
  /** Any-match on the conversation's tags. Empty or omitted: every conversation. */
  tagIds?: string[];
}

/**
 * `MetricsDailyRow` as the API returns it: cost and tokens are `null` unless the actor has
 * `costs.view` (AC-CO-2: costs are admin only).
 */
export interface MetricsDaily extends Omit<
  MetricsDailyRow,
  "costCents" | "tokensIn" | "tokensOut"
> {
  costCents: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

/** `MetricsAssigneeRow` plus the person's name and avatar from `resolveUsers`. */
export interface MetricsAssignee extends MetricsAssigneeRow {
  /** `null` when `resolveUsers` is not configured or did not return the id (and for `business_app`). */
  name: string | null;
  avatarUrl: string | null;
}

/** `sendo.metrics` (SND-4.4): read-only, tenant-scoped, role-checked. */
export interface MetricsApi {
  /** Messages and conversations per local day and number. */
  daily(q: MetricsQuery): Promise<MetricsDaily[]>;
  /** Team members per day (AI agents are in `cost`), with names from `resolveUsers`. */
  byAssignee(q: MetricsQuery): Promise<MetricsAssignee[]>;
  /** First response per conversation whose first inbound message is in range. */
  firstResponse(q: MetricsQuery): Promise<MetricsFirstResponseRow[]>;
  /** Closed conversations (closed in range) and whether the AI resolved them alone. */
  aiResolution(q: MetricsQuery): Promise<MetricsAiResolutionRow[]>;
  /** New conversations per source and day (`source: null` = direct). */
  bySource(q: MetricsQuery): Promise<MetricsSourceRow[]>;
  /** Model cost per AI agent and day. Needs `costs.view` (admin). */
  cost(q: MetricsQuery): Promise<MetricsCostRow[]>;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1));
  return next.toISOString().slice(0, 10);
}

function validDay(value: unknown, field: string): string {
  if (typeof value !== "string" || !DAY_RE.test(value)) {
    throw new PayloadValidationError({ field, message: "use a YYYY-MM-DD date." });
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 0));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new PayloadValidationError({ field, message: `${value} is not a calendar date.` });
  }
  return value;
}

function validTimeZone(timeZone: unknown): string {
  try {
    if (typeof timeZone !== "string" || timeZone === "") throw new RangeError();
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    throw new PayloadValidationError({
      field: "timeZone",
      message: "use an IANA timezone such as America/Guatemala.",
    });
  }
}

/**
 * `from`/`to` for `MetricsQuery` from calendar days in a timezone, both days included:
 * `{ from: "2026-10-01", to: "2026-10-07", timeZone: "America/Guatemala" }` → local midnight of
 * Oct 1 up to (not including) local midnight of Oct 8. DST-safe.
 */
export function metricsDayRange(input: { from: string; to: string; timeZone: string }): {
  from: Date;
  to: Date;
} {
  const timeZone = validTimeZone(input.timeZone);
  const fromDay = validDay(input.from, "from");
  const toDay = validDay(input.to, "to");
  if (toDay < fromDay) {
    throw new PayloadValidationError({ field: "to", message: "must not be before `from`." });
  }
  return { from: localDayStart(fromDay, timeZone), to: localDayStart(nextDay(toDay), timeZone) };
}

/** `YYYY-MM-DD` of `at` (default now) in `timeZone`: "today" for date pickers. */
export function metricsLocalDay(timeZone: string, at: Date = new Date()): string {
  return localDay(at, validTimeZone(timeZone));
}

function validDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new PayloadValidationError({ field, message: "must be a valid Date." });
  }
  return value;
}

function validTagIds(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || id === "")) {
    throw new PayloadValidationError({ field: "tagIds", message: "must be an array of tag ids." });
  }
  if (value.length > METRICS_MAX_TAG_IDS) {
    throw new PayloadValidationError({
      field: "tagIds",
      message: `pick at most ${String(METRICS_MAX_TAG_IDS)} tags.`,
      limit: METRICS_MAX_TAG_IDS,
    });
  }
  return value.length === 0 ? undefined : (value as string[]);
}

/** `SENDO_MODULES` entry. */
export function installMetrics(ctx: SendoContext): void {
  const { adapter } = ctx;

  /** Checks the capability, then builds the tenant-scoped adapter query. */
  async function scoped(q: MetricsQuery, capability: "metrics.view" | "costs.view") {
    requireActor(q.actor, capability);
    assertCan(q.actor, "metrics.view");
    if (capability === "costs.view") assertCan(q.actor, "costs.view");
    const from = validDate(q.from, "from");
    const to = validDate(q.to, "to");
    if (to.getTime() <= from.getTime()) {
      throw new PayloadValidationError({ field: "to", message: "must be after `from`." });
    }
    const tagIds = validTagIds(q.tagIds);
    await ctx.ready();
    const tenantId = q.actor.tenantId;
    let accountId: string | undefined;
    if (q.account !== undefined) {
      if (typeof q.account !== "string" || q.account === "") {
        throw new PayloadValidationError({ field: "account", message: "must be an account id." });
      }
      // Disconnected numbers keep their history, so `active` is not required here.
      const account = await findAccount(adapter, q.account);
      if (account === null || account.tenantId !== tenantId) {
        throw new AccountNotFoundError({ account: q.account, tenantId });
      }
      accountId = account.id;
    }
    const query: MetricsAdapterQuery = {
      tenantId,
      from,
      to,
      ...(accountId !== undefined && { accountId }),
      ...(tagIds !== undefined && { tagIds }),
    };
    return query;
  }

  async function names(
    ids: string[],
  ): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
    const out = new Map<string, { name: string; avatarUrl: string | null }>();
    const resolveUsers = ctx.team.resolveUsers;
    if (resolveUsers === null || ids.length === 0) return out;
    try {
      for (const user of await resolveUsers(ids)) {
        if (!ids.includes(user.id) || user.name.trim() === "") continue;
        out.set(user.id, { name: user.name, avatarUrl: user.avatarUrl ?? null });
      }
    } catch (error) {
      ctx.logger.warn("[sendo] resolveUsers failed", error);
    }
    return out;
  }

  ctx.slots.metrics = {
    async daily(q) {
      const query = await scoped(q, "metrics.view");
      const rows = await adapter.metrics.daily(query);
      if (can(q.actor, "costs.view")) return rows;
      return rows.map((row) => ({ ...row, costCents: null, tokensIn: null, tokensOut: null }));
    },

    async byAssignee(q) {
      const rows = await adapter.metrics.byAssignee(await scoped(q, "metrics.view"));
      const ids = [
        ...new Set(
          rows.flatMap((row) =>
            row.assignee === null || row.assignee === "business_app" ? [] : [row.assignee],
          ),
        ),
      ];
      const users = await names(ids);
      return rows.map((row) => {
        const user = row.assignee === null ? undefined : users.get(row.assignee);
        return { ...row, name: user?.name ?? null, avatarUrl: user?.avatarUrl ?? null };
      });
    },

    async firstResponse(q) {
      return adapter.metrics.firstResponse(await scoped(q, "metrics.view"));
    },

    async aiResolution(q) {
      return adapter.metrics.aiResolution(await scoped(q, "metrics.view"));
    },

    async bySource(q) {
      return adapter.metrics.bySource(await scoped(q, "metrics.view"));
    },

    async cost(q) {
      return adapter.metrics.cost(await scoped(q, "costs.view"));
    },
  };
}
