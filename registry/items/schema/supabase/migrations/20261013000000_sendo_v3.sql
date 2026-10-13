-- =============================================================================
-- @quami/sendo — conversation schema, version 3 (broadcasts and metrics)
--
-- Installed by the `sendo-schema` registry item, after `20261011000000_sendo_v2.sql`.
-- Additive only: two new tables with RLS select policies, and five read-only metrics
-- views. Nothing in v1 or v2 changes.
--
-- * Same conventions as v1: `sendo_` prefix, uuid keys, timestamptz, nullable
--   `tenant_id uuid` without a foreign key, RLS on, read-only policies through
--   `public.sendo_can_access_tenant(tenant_id)`, writes only with the service role.
-- * The metrics views are `security_invoker = true`: a signed-in user only aggregates the
--   rows the RLS policies (and the `sendo_can_access_*` hooks) let them read. They hold no
--   state. `@quami/sendo` exports the same queries as parameterized SQL (`METRICS_SQL`).
--   - A day is a calendar day in the account's timezone; `day_start` is its local midnight.
--   - Counted messages exclude internal notes, drafts and history imports.
--   - `tag_ids` is the conversation's sorted tag set: sum rows whose `tag_ids` overlap the
--     tags you want for an any-match tag cut.
-- * Safe to run more than once (IF NOT EXISTS / OR REPLACE / guarded DO blocks).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A template sent to many contacts. The package's tick sends pending recipients at
-- `rate_per_minute`. Deleting (purging) the account deletes its broadcasts.
create table if not exists public.sendo_broadcasts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  account_id      uuid not null references public.sendo_accounts (id) on delete cascade,
  template_name   text not null,
  language        text not null,
  category        text not null,          -- template category at creation (eligibility)
  variables       jsonb,                  -- shared template variables
  rate_per_minute integer not null default 60,
  status          text not null default 'queued',
  pause_reason    text,                   -- e.g. 'billing'
  created_by      text,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  constraint sendo_broadcasts_status_check
    check (status in ('queued', 'sending', 'paused', 'done', 'cancelled', 'failed')),
  constraint sendo_broadcasts_rate_per_minute_check check (rate_per_minute > 0)
);

-- One row per contact of a broadcast with its send result. Status webhooks find the row
-- through `message_id`.
create table if not exists public.sendo_broadcast_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  broadcast_id uuid not null references public.sendo_broadcasts (id) on delete cascade,
  contact_id   uuid not null references public.sendo_contacts (id) on delete cascade,
  variables    jsonb,                     -- this recipient's template variables
  message_id   uuid references public.sendo_messages (id) on delete set null,
  status       text not null default 'pending',
  skip_reason  text,                      -- e.g. 'no_opt_in', 'opted_out', 'invalid_phone'
  error        jsonb,                     -- Meta's error when failed
  updated_at   timestamptz not null default now(),
  constraint sendo_broadcast_recipients_broadcast_id_contact_id_key unique (broadcast_id, contact_id),
  constraint sendo_broadcast_recipients_status_check
    check (status in ('pending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'cancelled'))
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists sendo_broadcasts_tenant_created_idx
  on public.sendo_broadcasts (tenant_id, created_at desc);

create index if not exists sendo_broadcast_recipients_pending_idx
  on public.sendo_broadcast_recipients (broadcast_id, updated_at)
  where status = 'pending';

create index if not exists sendo_broadcast_recipients_broadcast_status_idx
  on public.sendo_broadcast_recipients (broadcast_id, status);

create index if not exists sendo_broadcast_recipients_message_idx
  on public.sendo_broadcast_recipients (message_id)
  where message_id is not null;

create index if not exists sendo_broadcast_recipients_contact_idx
  on public.sendo_broadcast_recipients (contact_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.sendo_broadcasts           enable row level security;
alter table public.sendo_broadcast_recipients enable row level security;

-- Read-only policies for signed-in users; no write policies (service role only).
drop policy if exists sendo_broadcasts_select on public.sendo_broadcasts;
create policy sendo_broadcasts_select on public.sendo_broadcasts
  for select to authenticated
  using (public.sendo_can_access_tenant(tenant_id));

drop policy if exists sendo_broadcast_recipients_select on public.sendo_broadcast_recipients;
create policy sendo_broadcast_recipients_select on public.sendo_broadcast_recipients
  for select to authenticated
  using (public.sendo_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Metrics views (security_invoker: RLS of the reader applies)
-- ---------------------------------------------------------------------------
-- sendo_metrics_daily          per tenant, account, channel, day and tag set: inbound and
--                              outbound messages, conversations started and closed, model
--                              cost (`cost_cents`, drafts included) and tokens.
-- sendo_metrics_by_assignee    per tenant, account, channel, day, sender ('human' or
--                              'agent'), assignee (`sender_ref`) and tag set: conversations
--                              handled, messages sent, first responses with their seconds
--                              and median, and model cost per AI agent.
-- sendo_metrics_first_response per conversation with an inbound message: the first reply by
--                              the agent or a human after it (notes and drafts excluded).
-- sendo_metrics_ai_resolution  per closed conversation: `ai_resolved` when it was never
--                              handed off (`ever_human = false`) and no human message.
-- sendo_metrics_by_source      new conversations per tenant, account, channel, source, day
--                              and tag set.

create or replace view public.sendo_metrics_daily
with (security_invoker = true) as
with conv as (
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
  where true
),
activity as (
  select cv.tenant_id, cv.account_id, cv.channel, cv.timezone, cv.tag_ids, m.created_at as at,
    case when m.direction = 'in' and not m.internal and not m.draft and not (m.metadata @> '{"imported": true}'::jsonb) then 1 else 0 end as inbound,
    case when m.direction = 'out' and not m.internal and not m.draft and not (m.metadata @> '{"imported": true}'::jsonb) then 1 else 0 end as outbound,
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
  select act.*, (act.at at time zone act.timezone)::date as day from activity act
)
select
  b.tenant_id, b.account_id, b.channel, b.day,
  (b.day::timestamp at time zone b.timezone) as day_start,
  b.tag_ids,
  sum(b.inbound)::int as inbound,
  sum(b.outbound)::int as outbound,
  sum(b.started)::int as conversations_started,
  sum(b.closed)::int as conversations_closed,
  coalesce(sum(b.cost_cents), 0)::numeric(14, 4) as cost_cents,
  coalesce(sum(b.tokens_in), 0)::bigint as tokens_in,
  coalesce(sum(b.tokens_out), 0)::bigint as tokens_out
from bucketed b
group by b.tenant_id, b.account_id, b.channel, b.timezone, b.day, b.tag_ids;

create or replace view public.sendo_metrics_by_assignee
with (security_invoker = true) as
with conv as (
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
  where true
),
first_in as (
  select cv.*,
    (select min(m.created_at)
     from public.sendo_messages m
     where m.conversation_id = cv.id and m.direction = 'in' and not m.internal and not m.draft and not (m.metadata @> '{"imported": true}'::jsonb)) as first_inbound_at
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
      and not r.internal and not r.draft and not (r.metadata @> '{"imported": true}'::jsonb) and r.created_at > fi.first_inbound_at
    order by r.created_at, r.id
    limit 1
  ) fr on true
  where fi.first_inbound_at is not null
),
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
  select act.*, (act.at at time zone act.timezone)::date as day from activity act
)
select
  b.tenant_id, b.account_id, b.channel, b.day,
  (b.day::timestamp at time zone b.timezone) as day_start,
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
group by b.tenant_id, b.account_id, b.channel, b.timezone, b.day, b.sender, b.assignee, b.tag_ids;

create or replace view public.sendo_metrics_first_response
with (security_invoker = true) as
with conv as (
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
  where true
),
first_in as (
  select cv.*,
    (select min(m.created_at)
     from public.sendo_messages m
     where m.conversation_id = cv.id and m.direction = 'in' and not m.internal and not m.draft and not (m.metadata @> '{"imported": true}'::jsonb)) as first_inbound_at
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
      and not r.internal and not r.draft and not (r.metadata @> '{"imported": true}'::jsonb) and r.created_at > fi.first_inbound_at
    order by r.created_at, r.id
    limit 1
  ) fr on true
  where fi.first_inbound_at is not null
)
select
  fr.tenant_id, fr.account_id, fr.channel, fr.id as conversation_id, fr.contact_id,
  fr.assigned_to, fr.source, fr.tag_ids,
  (fr.first_inbound_at at time zone fr.timezone)::date as day,
  fr.first_inbound_at, fr.first_response_at, fr.responder, fr.responder_ref,
  fr.response_seconds
from first_resp fr;

create or replace view public.sendo_metrics_ai_resolution
with (security_invoker = true) as
with conv as (
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
  where true
)
select
  cv.tenant_id, cv.account_id, cv.channel, cv.id as conversation_id, cv.source, cv.tag_ids,
  (cv.closed_at at time zone cv.timezone)::date as day,
  cv.created_at, cv.closed_at, cv.ever_human,
  h.human_messages, h.agent_messages,
  (not cv.ever_human and h.human_messages = 0) as ai_resolved
from conv cv
cross join lateral (
  select
    count(*) filter (where m.sender = 'human')::int as human_messages,
    count(*) filter (where m.sender = 'agent')::int as agent_messages
  from public.sendo_messages m
  where m.conversation_id = cv.id and m.direction = 'out' and not m.internal and not m.draft and not (m.metadata @> '{"imported": true}'::jsonb)
) h
where cv.closed_at is not null;

create or replace view public.sendo_metrics_by_source
with (security_invoker = true) as
with conv as (
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
  where true
),
bucketed as (
  select cv.*, (cv.created_at at time zone cv.timezone)::date as day from conv cv
)
select
  b.tenant_id, b.account_id, b.channel, b.source, b.day,
  (b.day::timestamp at time zone b.timezone) as day_start,
  b.tag_ids,
  count(*)::int as conversations
from bucketed b
group by b.tenant_id, b.account_id, b.channel, b.source, b.timezone, b.day, b.tag_ids;

-- ---------------------------------------------------------------------------
-- Schema version
-- ---------------------------------------------------------------------------
insert into public.sendo_schema_meta (version) values (3)
on conflict (version) do nothing;
