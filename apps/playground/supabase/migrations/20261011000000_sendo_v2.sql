-- =============================================================================
-- @quami/sendo — conversation schema, version 2 (team inbox: snippets, tags, rules)
--
-- Installed by the `sendo-schema` registry item, after `20261010000000_sendo_v1.sql`.
-- Additive only: four new tables, their RLS select policies, one optional hook
-- (`sendo_current_user_id`) and service-role RPCs. Nothing in v1 changes.
--
-- * Same conventions as v1: `sendo_` prefix, uuid keys, timestamptz, nullable
--   `tenant_id uuid` without a foreign key, RLS on, read-only policies through
--   `public.sendo_can_access_tenant(tenant_id)`, writes only with the service role.
-- * Personal snippets (`visibility = 'personal'`) are only readable by their owner:
--   `owner_user_id = public.sendo_current_user_id()`. The default returns
--   `auth.uid()::text`; replace it if your app's user ids are not Supabase Auth ids.
-- * Safe to run more than once (IF NOT EXISTS / guarded DO blocks).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Quick replies. `tenant` snippets are shared by the team; `personal` ones belong to
-- `owner_user_id` (the app's user id). `account_id` optionally limits a snippet to one
-- number. Shortcuts are unique per (tenant, owner, shortcut); tenant snippets share
-- the empty owner.
create table if not exists public.sendo_snippets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid,
  account_id    uuid references public.sendo_accounts (id) on delete cascade,
  shortcut      text not null,
  body          text not null,
  visibility    text not null default 'tenant',
  owner_user_id text,           -- set exactly when visibility = 'personal'
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sendo_snippets_shortcut_check check (shortcut ~ '^[a-z0-9_-]{1,32}$'),
  constraint sendo_snippets_visibility_check check (visibility in ('tenant', 'personal')),
  constraint sendo_snippets_owner_check
    check ((visibility = 'personal') = (owner_user_id is not null))
);

-- Conversation labels from a fixed palette. Names are unique per tenant, ignoring case.
create table if not exists public.sendo_tags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid,
  name       text not null,
  color      text not null,
  created_at timestamptz not null default now(),
  constraint sendo_tags_name_check check (length(btrim(name)) between 1 and 64),
  constraint sendo_tags_color_check
    check (color in ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'))
);

-- Tags applied to a conversation. Deleting a tag or a conversation removes the link.
create table if not exists public.sendo_conversation_tags (
  conversation_id uuid not null references public.sendo_conversations (id) on delete cascade,
  tag_id          uuid not null references public.sendo_tags (id) on delete cascade,
  tenant_id       uuid,
  added_by        text,
  added_at        timestamptz not null default now(),
  constraint sendo_conversation_tags_pkey primary key (conversation_id, tag_id)
);

-- Workflow rules (business hours, routing, auto-assign, escalation, auto-close).
-- `params` is validated by the package's zod schema for `type`; `state` holds engine
-- bookkeeping such as the round-robin cursor. `key` is stable per tenant.
create table if not exists public.sendo_rules (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid,
  account_id uuid references public.sendo_accounts (id) on delete cascade,
  key        text not null,
  type       text not null,
  params     jsonb not null,
  position   integer not null default 0,
  active     boolean not null default true,
  origin     text not null default 'screen',
  state      jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint sendo_rules_tenant_key unique nulls not distinct (tenant_id, key),
  constraint sendo_rules_type_check
    check (type in ('business_hours', 'route', 'auto_assign', 'escalate', 'auto_close')),
  constraint sendo_rules_origin_check check (origin in ('code', 'screen'))
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create unique index if not exists sendo_snippets_shortcut_key
  on public.sendo_snippets (tenant_id, coalesce(owner_user_id, ''), shortcut) nulls not distinct;

create unique index if not exists sendo_tags_name_key
  on public.sendo_tags (tenant_id, lower(name)) nulls not distinct;

create index if not exists sendo_conversation_tags_tag_idx
  on public.sendo_conversation_tags (tag_id);

create index if not exists sendo_rules_tenant_position_idx
  on public.sendo_rules (tenant_id, position);

-- Tick queries: escalation (human, waiting) and auto-close (open, inactive).
create index if not exists sendo_conversations_awaiting_reply_idx
  on public.sendo_conversations (tenant_id, awaiting_reply_since)
  where status = 'human' and awaiting_reply_since is not null;

create index if not exists sendo_conversations_open_activity_idx
  on public.sendo_conversations (tenant_id, last_activity_at)
  where status <> 'closed';

-- ---------------------------------------------------------------------------
-- Current-user hook (personal snippets)
-- ---------------------------------------------------------------------------

-- Optional hook: the id the app stores in `owner_user_id` for the signed-in user.
-- Defaults to the Supabase Auth user id. Replace it (same signature) when your app
-- identifies operators differently, e.g.:
--
--   create or replace function public.sendo_current_user_id()
--   returns text language sql stable security definer set search_path = '' as $fn$
--     select (select auth.jwt() -> 'app_metadata' ->> 'app_user_id');
--   $fn$;
create or replace function public.sendo_current_user_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid())::text;
$$;

comment on function public.sendo_current_user_id() is
  'sendo RLS hook: the app user id of the signed-in user (personal snippets). Defaults to auth.uid()::text; replace it if your user ids differ.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.sendo_snippets          enable row level security;
alter table public.sendo_tags              enable row level security;
alter table public.sendo_conversation_tags enable row level security;
alter table public.sendo_rules             enable row level security;

-- Read-only policies for signed-in users; no write policies (service role only).
drop policy if exists sendo_snippets_select on public.sendo_snippets;
create policy sendo_snippets_select on public.sendo_snippets
  for select to authenticated
  using (
    public.sendo_can_access_tenant(tenant_id)
    and (visibility = 'tenant' or owner_user_id = public.sendo_current_user_id())
  );

drop policy if exists sendo_tags_select on public.sendo_tags;
create policy sendo_tags_select on public.sendo_tags
  for select to authenticated
  using (public.sendo_can_access_tenant(tenant_id));

drop policy if exists sendo_conversation_tags_select on public.sendo_conversation_tags;
create policy sendo_conversation_tags_select on public.sendo_conversation_tags
  for select to authenticated
  using (
    public.sendo_can_access_tenant(tenant_id)
    and public.sendo_can_access_conversation(conversation_id)
  );

drop policy if exists sendo_rules_select on public.sendo_rules;
create policy sendo_rules_select on public.sendo_rules
  for select to authenticated
  using (public.sendo_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Service-role RPC functions (used by the Supabase adapter)
-- ---------------------------------------------------------------------------

-- Shallow-merges `patch` into a rule's state atomically. Returns the updated row, or
-- no row when `rule_id` is unknown.
create or replace function public.sendo_merge_rule_state(rule_id uuid, patch jsonb)
returns setof public.sendo_rules
language sql
security definer
set search_path = ''
as $$
  update public.sendo_rules r
  set state = r.state || coalesce(sendo_merge_rule_state.patch, '{}'::jsonb)
  where r.id = sendo_merge_rule_state.rule_id
  returning r.*;
$$;

-- Escalation candidates for the tick: `human` conversations of the tenant waiting for a
-- reply since before `waiting_since`, not escalated since they started waiting. Optional
-- `account_id`; `match_queue` restricts to `queue` (NULL = no queue). Oldest wait first.
create or replace function public.sendo_escalation_candidates(
  tenant_id uuid,
  waiting_since timestamptz,
  max_rows int,
  account_id uuid default null,
  match_queue boolean default false,
  queue text default null
)
returns setof public.sendo_conversations
language sql
stable
security definer
set search_path = ''
as $$
  select c.*
  from public.sendo_conversations c
  where c.tenant_id is not distinct from sendo_escalation_candidates.tenant_id
    and c.status = 'human'
    and c.awaiting_reply_since is not null
    and c.awaiting_reply_since < sendo_escalation_candidates.waiting_since
    and (c.escalated_at is null or c.escalated_at < c.awaiting_reply_since)
    and (sendo_escalation_candidates.account_id is null
         or c.account_id = sendo_escalation_candidates.account_id)
    and (not sendo_escalation_candidates.match_queue
         or c.queue is not distinct from sendo_escalation_candidates.queue)
  order by c.awaiting_reply_since asc, c.id asc
  limit greatest(coalesce(sendo_escalation_candidates.max_rows, 0), 0);
$$;

-- Conversations per `source` (NULL = no attribution) for the tenant, optionally for one
-- account and a `created_at` range [from_at, to_at).
create or replace function public.sendo_count_by_source(
  tenant_id uuid,
  account_id uuid default null,
  from_at timestamptz default null,
  to_at timestamptz default null
)
returns table (source text, conversations bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.source, count(*) as conversations
  from public.sendo_conversations c
  where c.tenant_id is not distinct from sendo_count_by_source.tenant_id
    and (sendo_count_by_source.account_id is null or c.account_id = sendo_count_by_source.account_id)
    and (sendo_count_by_source.from_at is null or c.created_at >= sendo_count_by_source.from_at)
    and (sendo_count_by_source.to_at is null or c.created_at < sendo_count_by_source.to_at)
  group by c.source;
$$;

revoke execute on function public.sendo_current_user_id() from public;
revoke execute on function public.sendo_merge_rule_state(uuid, jsonb) from public;
revoke execute on function public.sendo_escalation_candidates(uuid, timestamptz, int, uuid, boolean, text) from public;
revoke execute on function public.sendo_count_by_source(uuid, uuid, timestamptz, timestamptz) from public;

do $$
declare
  r text;
begin
  -- The RLS hook runs inside policies for signed-in users; the RPCs are server-only.
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.sendo_current_user_id() to authenticated;
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function public.sendo_merge_rule_state(uuid, jsonb) from %I', r);
      execute format('revoke execute on function public.sendo_escalation_candidates(uuid, timestamptz, int, uuid, boolean, text) from %I', r);
      execute format('revoke execute on function public.sendo_count_by_source(uuid, uuid, timestamptz, timestamptz) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.sendo_current_user_id() to service_role;
    grant execute on function public.sendo_merge_rule_state(uuid, jsonb) to service_role;
    grant execute on function public.sendo_escalation_candidates(uuid, timestamptz, int, uuid, boolean, text) to service_role;
    grant execute on function public.sendo_count_by_source(uuid, uuid, timestamptz, timestamptz) to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Schema version
-- ---------------------------------------------------------------------------
insert into public.sendo_schema_meta (version) values (2)
on conflict (version) do nothing;
