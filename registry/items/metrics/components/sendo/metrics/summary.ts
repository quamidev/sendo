import {
  daysBetween,
  type MetricsAgentCost,
  type MetricsAssigneeSummary,
  type MetricsDayPoint,
  type MetricsFilters,
  type MetricsRaw,
  type MetricsReport,
  type MetricsSourceSummary,
  type MetricsTagSummary,
  type MetricsTagView,
} from "./types";

/** Interpolated median (same as the package and Postgres `percentile_cont(0.5)`). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) / 2;
  const lo = sorted[Math.floor(pos)] ?? 0;
  const hi = sorted[Math.ceil(pos)] ?? 0;
  return lo + (hi - lo) * (pos - Math.floor(pos));
}

const CENT_SCALE = 10_000;
const roundCents = (n: number) => Math.round(n * CENT_SCALE) / CENT_SCALE;

function byName(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, "es");
}

export interface SummarizeInput {
  filters: MetricsFilters;
  timeZone: string;
  raw: MetricsRaw;
  /** The tenant's tags (names and colours for the per-tag cut). */
  tags: MetricsTagView[];
}

/**
 * Folds the per-day rows of `sendo.metrics.*` into what the screen shows. Runs on the server
 * (in `loadMetrics` and the page), so only the summary crosses to the browser.
 */
export function summarizeMetrics({ filters, timeZone, raw, tags }: SummarizeInput): MetricsReport {
  const showCost = raw.cost !== null;

  const days = new Map<string, MetricsDayPoint>(
    daysBetween(filters.from, filters.to).map((day) => [
      day,
      { day, inbound: 0, outbound: 0, conversations: 0, costCents: showCost ? 0 : null },
    ]),
  );
  for (const row of raw.daily) {
    const point = days.get(row.day);
    // With numbers in several timezones, a number's last local day can start inside the range
    // but be labelled the day after it; the chart and the tiles both leave it out.
    if (!point) continue;
    point.inbound += row.inbound;
    point.outbound += row.outbound;
    point.conversations += row.conversationsStarted;
    if (point.costCents !== null)
      point.costCents = roundCents(point.costCents + (row.costCents ?? 0));
  }

  const points = [...days.values()];
  const inbound = points.reduce((sum, point) => sum + point.inbound, 0);
  const outbound = points.reduce((sum, point) => sum + point.outbound, 0);
  const answered = raw.firstResponse.filter((row) => row.seconds !== null);
  const aiResolved = raw.aiResolution.filter((row) => row.aiResolved).length;

  const assignees = new Map<string, MetricsAssigneeSummary & { seconds: number[] }>();
  for (const row of raw.byAssignee) {
    const id = row.assignee ?? "";
    const entry = assignees.get(id) ?? {
      id,
      name: row.name,
      conversationDays: 0,
      messagesSent: 0,
      firstResponses: 0,
      medianFirstResponseSeconds: null,
      seconds: [],
    };
    entry.name ??= row.name;
    entry.conversationDays += row.conversations;
    entry.messagesSent += row.messagesSent;
    entry.firstResponses += row.firstResponses;
    entry.seconds.push(...row.firstResponseSeconds);
    assignees.set(id, entry);
  }

  const sources = new Map<string | null, number>();
  for (const row of raw.bySource) {
    sources.set(row.source, (sources.get(row.source) ?? 0) + row.conversations);
  }

  const tagIndex = new Map(tags.map((tag) => [tag.id, tag]));
  const tagRows = new Map<string | null, MetricsTagSummary & { seconds: number[] }>();
  const tagRow = (id: string | null) => {
    let entry = tagRows.get(id);
    if (!entry) {
      const tag = id === null ? undefined : tagIndex.get(id);
      entry = {
        id,
        name: tag?.name ?? null,
        color: tag?.color ?? null,
        conversations: 0,
        medianFirstResponseSeconds: null,
        closed: 0,
        aiResolved: 0,
        seconds: [],
      };
      tagRows.set(id, entry);
    }
    return entry;
  };
  // Ids missing from `tags` (deleted meanwhile) count as untagged.
  const tagIdsOf = (ids: string[]) => {
    const known = ids.filter((id) => tagIndex.has(id));
    return known.length === 0 ? [null] : known;
  };
  for (const row of raw.firstResponse) {
    for (const id of tagIdsOf(row.tagIds)) {
      const entry = tagRow(id);
      entry.conversations += 1;
      if (row.seconds !== null) entry.seconds.push(row.seconds);
    }
  }
  for (const row of raw.aiResolution) {
    for (const id of tagIdsOf(row.tagIds)) {
      const entry = tagRow(id);
      entry.closed += 1;
      if (row.aiResolved) entry.aiResolved += 1;
    }
  }

  let cost: MetricsReport["cost"] = null;
  if (raw.cost !== null) {
    const perAgent = new Map<string | null, MetricsAgentCost>();
    for (const row of raw.cost) {
      const entry = perAgent.get(row.agent) ?? {
        agent: row.agent,
        costCents: 0,
        tokensIn: 0,
        tokensOut: 0,
        turns: 0,
      };
      entry.costCents = roundCents(entry.costCents + row.costCents);
      entry.tokensIn += row.tokensIn;
      entry.tokensOut += row.tokensOut;
      entry.turns += row.turns;
      perAgent.set(row.agent, entry);
    }
    cost = {
      totalCents: roundCents(points.reduce((sum, point) => sum + (point.costCents ?? 0), 0)),
      perAgent: [...perAgent.values()].sort(
        (a, b) => b.costCents - a.costCents || byName(a.agent, b.agent),
      ),
    };
  }

  return {
    filters,
    timeZone,
    days: points,
    kpis: {
      messages: inbound + outbound,
      inbound,
      outbound,
      conversations: points.reduce((sum, point) => sum + point.conversations, 0),
      medianFirstResponseSeconds: median(answered.map((row) => row.seconds ?? 0)),
      teamMedianFirstResponseSeconds: median(
        answered.filter((row) => row.responder === "human").map((row) => row.seconds ?? 0),
      ),
      unanswered: raw.firstResponse.length - answered.length,
      closed: raw.aiResolution.length,
      aiResolved,
      aiResolvedShare: raw.aiResolution.length === 0 ? null : aiResolved / raw.aiResolution.length,
    },
    assignees: [...assignees.values()]
      .map(({ seconds, ...entry }) => ({ ...entry, medianFirstResponseSeconds: median(seconds) }))
      .sort((a, b) => b.messagesSent - a.messagesSent || byName(a.name ?? a.id, b.name ?? b.id)),
    sources: [...sources.entries()]
      .map(([source, conversations]): MetricsSourceSummary => ({ source, conversations }))
      .sort((a, b) => b.conversations - a.conversations || byName(a.source, b.source)),
    tags: [...tagRows.values()]
      .map(({ seconds, ...entry }) => ({ ...entry, medianFirstResponseSeconds: median(seconds) }))
      .sort((a, b) => {
        if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1;
        return b.conversations - a.conversations || byName(a.name, b.name);
      }),
    cost,
  };
}
