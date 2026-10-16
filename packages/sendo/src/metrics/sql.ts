/**
 * The metrics as SQL (schema v3). `METRICS_VIEWS` holds the bodies of the five
 * `sendo_metrics_*` views exactly as the `schema` migration creates them;
 * `METRICS_SQL` holds the same queries over the base tables with the filters as
 * positional parameters, for Postgres clients without the views (Drizzle, Prisma, `pg`):
 *
 * - `$1` tenant id (`uuid`, `null` = rows without a tenant)
 * - `$2` from, `$3` to (`timestamptz`, half-open range)
 * - `$4` account id (`uuid` or `null`)
 * - `$5` tag ids (`uuid[]`, any match; `null` or empty = no filter)
 *
 * Build the parameters with `metricsSqlParams(query)`. Every query returns view rows
 * (snake_case, one row per view grain); the adapters fold them into `Metrics*Row` values.
 *
 * Definitions shared by every view:
 * - A day is a calendar day in the account's timezone; `day_start` is its local midnight.
 * - Counted messages exclude internal notes, drafts and history imports
 *   (`metadata.imported = true`).
 * - `closed_at` of a closed conversation is its last close system line
 *   (`metadata.event = 'closed'`), else its last activity.
 * - `tag_ids` is the conversation's tag set (sorted), so tag cuts stay additive.
 */

/** Zero-dependency module: also imported by scripts that generate the migration text. */

export type MetricsViewName =
  | "sendo_metrics_daily"
  | "sendo_metrics_by_assignee"
  | "sendo_metrics_first_response"
  | "sendo_metrics_ai_resolution"
  | "sendo_metrics_by_source";

export type MetricsQueryName =
  "daily" | "byAssignee" | "firstResponse" | "aiResolution" | "bySource" | "cost";

const counted = (m: string): string =>
  `not ${m}.internal and not ${m}.draft and not (${m}.metadata @> '{"imported": true}'::jsonb)`;

const localDay = (at: string, tz: string): string => `(${at} at time zone ${tz})::date`;
const dayStart = (day: string, tz: string): string => `(${day}::timestamp at time zone ${tz})`;

/** One row per conversation, with its account timezone, tag set and close time. */
const conv = (filter: string): string => `conv as (
  select
    c.id, c.tenant_id, c.account_id, c.channel, c.contact_id, c.status, c.source,
    c.assigned_to, c.ever_human, c.created_at, a.timezone,
    coalesce(
      (select array_agg(ct.tag_id order by ct.tag_id)
       from public.sendo_conversation_tags ct
       where ct.conversation_id = c.id),
      '{}'::uuid[]
    ) as tag_ids,
    case when c.status = 'closed' then coalesce(
      (select max(l.created_at)
       from public.sendo_messages l
       where l.conversation_id = c.id and l.internal and l.metadata ->> 'event' = 'closed'),
      c.last_activity_at
    ) end as closed_at
  from public.sendo_conversations c
  join public.sendo_accounts a on a.id = c.account_id
  where ${filter}
)`;

/** First counted inbound, then the first counted agent/human reply after it. */
const firstResponse = `first_in as (
  select cv.*,
    (select min(m.created_at)
     from public.sendo_messages m
     where m.conversation_id = cv.id and m.direction = 'in' and ${counted("m")}) as first_inbound_at
  from conv cv
),
first_resp as (
  select fi.*,
    fr.created_at as first_response_at,
    fr.sender::text as responder,
    fr.sender_ref as responder_ref,
    extract(epoch from fr.created_at - fi.first_inbound_at) as response_seconds
  from first_in fi
  left join lateral (
    select r.created_at, r.sender, r.sender_ref
    from public.sendo_messages r
    where r.conversation_id = fi.id and r.direction = 'out' and r.sender in ('agent', 'human')
      and ${counted("r")} and r.created_at > fi.first_inbound_at
    order by r.created_at, r.id
    limit 1
  ) fr on true
  where fi.first_inbound_at is not null
)`;

const views: Record<MetricsViewName, (filter: string) => string> = {
  sendo_metrics_daily: (filter) => `with ${conv(filter)},
activity as (
  select cv.tenant_id, cv.account_id, cv.channel, cv.timezone, cv.tag_ids, m.created_at as at,
    case when m.direction = 'in' and ${counted("m")} then 1 else 0 end as inbound,
    case when m.direction = 'out' and ${counted("m")} then 1 else 0 end as outbound,
    0 as started,
    0 as closed,
    m.cost_cents,
    m.tokens_in,
    m.tokens_out
  from conv cv
  join public.sendo_messages m on m.conversation_id = cv.id
  union all
  select cv.tenant_id, cv.account_id, cv.channel, cv.timezone, cv.tag_ids, cv.created_at,
    0, 0, 1, 0, null, null, null
  from conv cv
  union all
  select cv.tenant_id, cv.account_id, cv.channel, cv.timezone, cv.tag_ids, cv.closed_at,
    0, 0, 0, 1, null, null, null
  from conv cv
  where cv.closed_at is not null
),
bucketed as (
  select act.*, ${localDay("act.at", "act.timezone")} as day from activity act
)
select
  b.tenant_id, b.account_id, b.channel, b.day,
  ${dayStart("b.day", "b.timezone")} as day_start,
  b.tag_ids,
  sum(b.inbound)::int as inbound,
  sum(b.outbound)::int as outbound,
  sum(b.started)::int as conversations_started,
  sum(b.closed)::int as conversations_closed,
  coalesce(sum(b.cost_cents), 0)::numeric(14, 4) as cost_cents,
  coalesce(sum(b.tokens_in), 0)::bigint as tokens_in,
  coalesce(sum(b.tokens_out), 0)::bigint as tokens_out
from bucketed b
group by b.tenant_id, b.account_id, b.channel, b.timezone, b.day, b.tag_ids`,

  sendo_metrics_by_assignee: (filter) => `with ${conv(filter)},
${firstResponse},
activity as (
  select cv.tenant_id, cv.account_id, cv.channel, cv.timezone, cv.tag_ids,
    m.sender::text as sender, m.sender_ref as assignee, m.created_at as at,
    m.conversation_id, not m.draft as sent, null::numeric as response_seconds,
    m.cost_cents, m.tokens_in, m.tokens_out
  from conv cv
  join public.sendo_messages m on m.conversation_id = cv.id
  where m.direction = 'out' and m.sender in ('agent', 'human') and not m.internal
    and not (m.metadata @> '{"imported": true}'::jsonb)
  union all
  select fr.tenant_id, fr.account_id, fr.channel, fr.timezone, fr.tag_ids,
    fr.responder, fr.responder_ref, fr.first_response_at,
    null, false, fr.response_seconds, null, null, null
  from first_resp fr
  where fr.first_response_at is not null
),
bucketed as (
  select act.*, ${localDay("act.at", "act.timezone")} as day from activity act
)
select
  b.tenant_id, b.account_id, b.channel, b.day,
  ${dayStart("b.day", "b.timezone")} as day_start,
  b.sender, b.assignee, b.tag_ids,
  count(distinct b.conversation_id) filter (where b.sent)::int as conversations,
  count(*) filter (where b.sent)::int as messages_sent,
  count(b.response_seconds)::int as first_responses,
  coalesce(
    array_agg(b.response_seconds order by b.response_seconds)
      filter (where b.response_seconds is not null),
    '{}'::numeric[]
  ) as first_response_seconds,
  percentile_cont(0.5) within group (order by b.response_seconds) as median_first_response_seconds,
  coalesce(sum(b.cost_cents), 0)::numeric(14, 4) as cost_cents,
  coalesce(sum(b.tokens_in), 0)::bigint as tokens_in,
  coalesce(sum(b.tokens_out), 0)::bigint as tokens_out,
  count(*) filter (
    where b.cost_cents is not null or b.tokens_in is not null or b.tokens_out is not null
  )::int as turns
from bucketed b
group by b.tenant_id, b.account_id, b.channel, b.timezone, b.day, b.sender, b.assignee, b.tag_ids`,

  sendo_metrics_first_response: (filter) => `with ${conv(filter)},
${firstResponse}
select
  fr.tenant_id, fr.account_id, fr.channel, fr.id as conversation_id, fr.contact_id,
  fr.assigned_to, fr.source, fr.tag_ids,
  ${localDay("fr.first_inbound_at", "fr.timezone")} as day,
  fr.first_inbound_at, fr.first_response_at, fr.responder, fr.responder_ref,
  fr.response_seconds
from first_resp fr`,

  sendo_metrics_ai_resolution: (filter) => `with ${conv(filter)}
select
  cv.tenant_id, cv.account_id, cv.channel, cv.id as conversation_id, cv.source, cv.tag_ids,
  ${localDay("cv.closed_at", "cv.timezone")} as day,
  cv.created_at, cv.closed_at, cv.ever_human,
  h.human_messages, h.agent_messages,
  (not cv.ever_human and h.human_messages = 0) as ai_resolved
from conv cv
cross join lateral (
  select
    count(*) filter (where m.sender = 'human')::int as human_messages,
    count(*) filter (where m.sender = 'agent')::int as agent_messages
  from public.sendo_messages m
  where m.conversation_id = cv.id and m.direction = 'out' and ${counted("m")}
) h
where cv.closed_at is not null`,

  sendo_metrics_by_source: (filter) => `with ${conv(filter)},
bucketed as (
  select cv.*, ${localDay("cv.created_at", "cv.timezone")} as day from conv cv
)
select
  b.tenant_id, b.account_id, b.channel, b.source, b.day,
  ${dayStart("b.day", "b.timezone")} as day_start,
  b.tag_ids,
  count(*)::int as conversations
from bucketed b
group by b.tenant_id, b.account_id, b.channel, b.source, b.timezone, b.day, b.tag_ids`,
};

const VIEW_NAMES = Object.keys(views) as MetricsViewName[];

/** The body (`select ...`) of each `sendo_metrics_*` view, as created by schema v3. */
export const METRICS_VIEWS: Readonly<Record<MetricsViewName, string>> = Object.fromEntries(
  VIEW_NAMES.map((name) => [name, views[name]("true")]),
) as Record<MetricsViewName, string>;

/** `create or replace view` statements for the five views (the v3 migration text). */
export function metricsViewStatements(): string {
  return VIEW_NAMES.map(
    (name) =>
      `create or replace view public.${name}\nwith (security_invoker = true) as\n${METRICS_VIEWS[name]};`,
  ).join("\n\n");
}

const scope =
  "c.tenant_id is not distinct from $1::uuid and ($4::uuid is null or c.account_id = $4::uuid)";
const tags = "($5::uuid[] is null or cardinality($5::uuid[]) = 0 or v.tag_ids && $5::uuid[])";
const range = (column: string): string =>
  `v.${column} >= $2::timestamptz and v.${column} < $3::timestamptz`;

const query = (view: MetricsViewName, where: string[]): string =>
  `select v.*\nfrom (\n${views[view](scope)}\n) v\nwhere ${[...where, tags].join("\n  and ")}`;

/**
 * Parameterized queries behind `sendo.metrics.*` (see the module comment for `$1..$5`).
 * `byAssignee` and `cost` read the same grain, split by `sender` (`human` / `agent`).
 */
export const METRICS_SQL: Readonly<Record<MetricsQueryName, string>> = {
  daily: query("sendo_metrics_daily", [range("day_start")]),
  byAssignee: query("sendo_metrics_by_assignee", [range("day_start"), "v.sender = 'human'"]),
  firstResponse: query("sendo_metrics_first_response", [range("first_inbound_at")]),
  aiResolution: query("sendo_metrics_ai_resolution", [range("closed_at")]),
  bySource: query("sendo_metrics_by_source", [range("day_start")]),
  cost: query("sendo_metrics_by_assignee", [range("day_start"), "v.sender = 'agent'"]),
};

/** Positional parameters for `METRICS_SQL`, in order. */
export function metricsSqlParams(q: {
  tenantId: string | null;
  from: Date;
  to: Date;
  accountId?: string;
  tagIds?: string[];
}): [string | null, Date, Date, string | null, string[] | null] {
  return [
    q.tenantId,
    q.from,
    q.to,
    q.accountId ?? null,
    q.tagIds && q.tagIds.length > 0 ? q.tagIds : null,
  ];
}
