-- =============================================================================
-- @quami/wa-li — WhatsApp schema, version 1
--
-- Installed by the `wa-li-schema` registry item. Targets Supabase (Postgres 15+,
-- roles `anon`, `authenticated`, `service_role`, publication `supabase_realtime`).
--
-- * Every table is prefixed `wa_`, uses uuid primary keys and timestamptz, and has
--   a nullable `tenant_id uuid` WITHOUT a foreign key. Add your own FK if you want
--   (e.g. `references tenants(id)`).
-- * RLS is enabled on every table. The package talks to the database with the
--   service role, which bypasses RLS. Browser clients (inbox realtime) only see rows
--   for which `public.wa_can_access_tenant(tenant_id)` returns true.
-- * `public.wa_can_access_tenant` returns FALSE by default. YOUR APP MUST REPLACE IT
--   (see the function below) or the inbox will not receive any realtime rows.
-- * Safe to run on a fresh database more than once (IF NOT EXISTS / guarded DO blocks).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'wa_conversation_status' and typnamespace = 'public'::regnamespace) then
    create type public.wa_conversation_status as enum ('agent', 'human', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'wa_message_status' and typnamespace = 'public'::regnamespace) then
    create type public.wa_message_status as enum ('pending', 'sent', 'delivered', 'read', 'failed', 'received');
  end if;
  if not exists (select 1 from pg_type where typname = 'wa_direction' and typnamespace = 'public'::regnamespace) then
    create type public.wa_direction as enum ('in', 'out');
  end if;
  if not exists (select 1 from pg_type where typname = 'wa_sender' and typnamespace = 'public'::regnamespace) then
    create type public.wa_sender as enum ('contact', 'agent', 'human', 'system');
  end if;
  if not exists (select 1 from pg_type where typname = 'wa_event_status' and typnamespace = 'public'::regnamespace) then
    create type public.wa_event_status as enum ('received', 'processed', 'failed', 'unrouted');
  end if;
  if not exists (select 1 from pg_type where typname = 'wa_download_status' and typnamespace = 'public'::regnamespace) then
    create type public.wa_download_status as enum ('pending', 'done', 'failed');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- WhatsApp Business phone numbers. `token_ref` is the NAME of the env var or secret
-- holding the access token, never the token itself.
create table if not exists public.wa_accounts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  phone_number_id text not null,
  waba_id         text not null,
  display_phone   text not null,
  token_ref       text not null,
  timezone        text not null default 'America/Guatemala',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint wa_accounts_phone_number_id_key unique (phone_number_id)
);

create table if not exists public.wa_contacts (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid,
  account_id       uuid not null references public.wa_accounts (id) on delete cascade,
  phone            text not null, -- E.164, e.g. +50255551234
  wa_id            text,
  profile_name     text,
  app_ref          text,          -- the app's own user / patient / resident ID
  marketing_opt_in boolean not null default false,
  opt_in_at        timestamptz,
  created_at       timestamptz not null default now(),
  constraint wa_contacts_account_id_phone_key unique (account_id, phone)
);

create table if not exists public.wa_conversations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid,
  account_id        uuid not null references public.wa_accounts (id) on delete cascade,
  contact_id        uuid not null references public.wa_contacts (id) on delete cascade,
  status            public.wa_conversation_status not null default 'agent',
  assigned_to       text,
  handoff_reason    text,
  last_inbound_at   timestamptz,
  last_activity_at  timestamptz not null default now(),
  window_expires_at timestamptz,
  unread_count      int not null default 0,
  created_at        timestamptz not null default now(),
  constraint wa_conversations_unread_count_check check (unread_count >= 0)
);

-- `conversation_id` is NULL only for adapter-internal `status_placeholder` rows: a
-- status webhook that arrived before the outbound row got its `meta_message_id`.
-- Placeholders are merged into the real row and deleted; they are never shown.
create table if not exists public.wa_messages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid,
  conversation_id  uuid references public.wa_conversations (id) on delete cascade,
  direction        public.wa_direction not null,
  type             text not null,
  content          jsonb not null default '{}'::jsonb,
  text             text,          -- denormalized body for search and previews
  meta_message_id  text,
  reply_to_meta_id text,
  status           public.wa_message_status not null,
  error            jsonb,
  sender           public.wa_sender not null,
  sender_ref       text,          -- agent name or user ID
  metadata         jsonb not null default '{}'::jsonb,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint wa_messages_placeholder_check
    check (conversation_id is not null or type = 'status_placeholder')
);

create table if not exists public.wa_media (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid,
  message_id      uuid not null references public.wa_messages (id) on delete cascade,
  meta_media_id   text,
  mime_type       text,
  size_bytes      bigint,
  sha256          text,
  storage_path    text,
  download_status public.wa_download_status not null default 'pending',
  created_at      timestamptz not null default now()
);

create table if not exists public.wa_templates (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid,
  account_id     uuid not null references public.wa_accounts (id) on delete cascade,
  name           text not null,
  language       text not null,
  category       text not null,
  status         text not null,
  components     jsonb not null default '[]'::jsonb,
  variable_count int not null default 0,
  active         boolean not null default true, -- false once the template disappears from Meta
  synced_at      timestamptz not null default now(),
  constraint wa_templates_account_id_name_language_key unique (account_id, name, language)
);

-- Raw webhook payloads (retention: 30 days, see wa_prune_events).
create table if not exists public.wa_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  received_at  timestamptz not null default now(),
  payload      jsonb not null,
  status       public.wa_event_status not null default 'received',
  error        text,
  processed_at timestamptz
);

-- Distributed locks (agent burst loop, per-conversation serialization).
create table if not exists public.wa_locks (
  key        text primary key,
  expires_at timestamptz not null
);

-- Installed schema version. The package warns when it is older than it expects.
create table if not exists public.wa_schema_meta (
  version    int primary key,
  applied_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- At most one non-closed conversation per contact.
create unique index if not exists wa_conversations_open_contact_key
  on public.wa_conversations (contact_id)
  where status <> 'closed';

create index if not exists wa_conversations_tenant_status_activity_idx
  on public.wa_conversations (tenant_id, status, last_activity_at desc);

create index if not exists wa_conversations_contact_account_created_idx
  on public.wa_conversations (contact_id, account_id, created_at desc);

create index if not exists wa_messages_conversation_created_idx
  on public.wa_messages (conversation_id, created_at desc);

-- UNIQUE meta_message_id; also serves as the lookup index and the
-- `on conflict (meta_message_id)` target for inbound de-duplication.
create unique index if not exists wa_messages_meta_message_id_key
  on public.wa_messages (meta_message_id);

create index if not exists wa_media_message_id_idx
  on public.wa_media (message_id);

create index if not exists wa_events_received_at_idx
  on public.wa_events (received_at);

-- ---------------------------------------------------------------------------
-- Tenant access hook
-- ---------------------------------------------------------------------------

-- >>> THE APP MUST REPLACE THIS FUNCTION. <<<
--
-- RLS SELECT policies (and therefore Supabase Realtime) call
-- `public.wa_can_access_tenant(tenant_id)` for every row a browser client reads.
-- The default denies everything. Replace it in a later migration of your app with
-- the same signature, e.g. for a multi-tenant app:
--
--   create or replace function public.wa_can_access_tenant(tenant_id uuid)
--   returns boolean language sql stable security definer set search_path = '' as $fn$
--     select exists (
--       select 1 from public.memberships m
--       where m.user_id = auth.uid() and m.tenant_id = wa_can_access_tenant.tenant_id
--     );
--   $fn$;
--
-- Single-tenant apps (tenant_id is null) can return `auth.uid() is not null` after
-- their own staff check. Keep the parameter name `tenant_id`.
create or replace function public.wa_can_access_tenant(tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

comment on function public.wa_can_access_tenant(uuid) is
  'wa-li RLS hook. Returns false by default; the app must replace it to grant browser clients read access to wa_* rows.';

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.wa_accounts      enable row level security;
alter table public.wa_contacts      enable row level security;
alter table public.wa_conversations enable row level security;
alter table public.wa_messages      enable row level security;
alter table public.wa_media         enable row level security;
alter table public.wa_templates     enable row level security;
alter table public.wa_events        enable row level security;
alter table public.wa_locks         enable row level security;
alter table public.wa_schema_meta   enable row level security;

-- Read-only policies for signed-in users. There are no write policies: all writes
-- go through the package with the service role. wa_events, wa_locks and
-- wa_schema_meta have no policies at all (service role only).
drop policy if exists wa_accounts_select on public.wa_accounts;
create policy wa_accounts_select on public.wa_accounts
  for select to authenticated
  using (public.wa_can_access_tenant(tenant_id));

drop policy if exists wa_contacts_select on public.wa_contacts;
create policy wa_contacts_select on public.wa_contacts
  for select to authenticated
  using (public.wa_can_access_tenant(tenant_id));

drop policy if exists wa_conversations_select on public.wa_conversations;
create policy wa_conversations_select on public.wa_conversations
  for select to authenticated
  using (public.wa_can_access_tenant(tenant_id));

drop policy if exists wa_messages_select on public.wa_messages;
create policy wa_messages_select on public.wa_messages
  for select to authenticated
  using (conversation_id is not null and public.wa_can_access_tenant(tenant_id));

drop policy if exists wa_media_select on public.wa_media;
create policy wa_media_select on public.wa_media
  for select to authenticated
  using (public.wa_can_access_tenant(tenant_id));

drop policy if exists wa_templates_select on public.wa_templates;
create policy wa_templates_select on public.wa_templates
  for select to authenticated
  using (public.wa_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wa_conversations'
    ) then
      alter publication supabase_realtime add table public.wa_conversations;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wa_messages'
    ) then
      alter publication supabase_realtime add table public.wa_messages;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Service-role RPC functions (used by the Supabase adapter)
-- ---------------------------------------------------------------------------

-- Deletes webhook events older than `days` days. Returns the number deleted.
create or replace function public.wa_prune_events(days int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted int;
begin
  if wa_prune_events.days is null or wa_prune_events.days < 0 then
    raise exception 'wa_prune_events: days must be >= 0 (got %)', wa_prune_events.days;
  end if;
  delete from public.wa_events e
  where e.received_at < now() - wa_prune_events.days * interval '1 day';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- Atomically acquires `key` for `ttl_ms` milliseconds when it is free or expired.
-- Returns true when acquired, false when another holder has an unexpired lock.
create or replace function public.wa_acquire_lock(key text, ttl_ms int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  acquired boolean;
begin
  if wa_acquire_lock.ttl_ms is null or wa_acquire_lock.ttl_ms <= 0 then
    raise exception 'wa_acquire_lock: ttl_ms must be > 0 (got %)', wa_acquire_lock.ttl_ms;
  end if;
  insert into public.wa_locks as l (key, expires_at)
  values (wa_acquire_lock.key, clock_timestamp() + wa_acquire_lock.ttl_ms * interval '1 millisecond')
  on conflict on constraint wa_locks_pkey do update
    set expires_at = excluded.expires_at
    where l.expires_at <= clock_timestamp()
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

-- Releases `key` (no-op when it is not held).
create or replace function public.wa_release_lock(key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.wa_locks l where l.key = wa_release_lock.key;
end;
$$;

-- Atomically adds `amount` to a conversation's unread_count (clamped at 0).
-- Returns the new count, or null when the conversation does not exist.
create or replace function public.wa_increment_unread(conversation_id uuid, amount int default 1)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_count int;
begin
  update public.wa_conversations c
  set unread_count = greatest(0, c.unread_count + coalesce(wa_increment_unread.amount, 0))
  where c.id = wa_increment_unread.conversation_id
  returning c.unread_count into new_count;
  return new_count;
end;
$$;

-- RPC functions are server-only: browser roles must not prune, lock or count.
revoke execute on function public.wa_prune_events(int) from public;
revoke execute on function public.wa_acquire_lock(text, int) from public;
revoke execute on function public.wa_release_lock(text) from public;
revoke execute on function public.wa_increment_unread(uuid, int) from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function public.wa_prune_events(int) from %I', r);
      execute format('revoke execute on function public.wa_acquire_lock(text, int) from %I', r);
      execute format('revoke execute on function public.wa_release_lock(text) from %I', r);
      execute format('revoke execute on function public.wa_increment_unread(uuid, int) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.wa_prune_events(int) to service_role;
    grant execute on function public.wa_acquire_lock(text, int) to service_role;
    grant execute on function public.wa_release_lock(text) to service_role;
    grant execute on function public.wa_increment_unread(uuid, int) to service_role;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Retention: daily prune when pg_cron is installed. Otherwise call
-- `wa.maintenance.prune()` from your own cron job (e.g. a Vercel Cron route).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('wa_prune_events_daily', '17 3 * * *', 'select public.wa_prune_events(30)');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Schema version
-- ---------------------------------------------------------------------------
insert into public.wa_schema_meta (version) values (1)
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- Message status RPCs (used by the Supabase adapter)
--
-- Status webhooks and `markSent` race each other: Meta can report `delivered`
-- before the send call returns the message id. Both paths take a transaction-level
-- advisory lock on the Meta id so they serialize, and a status that arrives first
-- is parked in a `status_placeholder` row (conversation_id null, never shown).
-- ---------------------------------------------------------------------------

-- Forward-only rule (mirrors `canTransition` in @quami/wa-li):
-- pending 0 < sent 1 < delivered 2 = failed 2 < read 3; failed and read are final;
-- `received` (inbound) never changes.
create or replace function public.wa_can_transition(
  from_status public.wa_message_status,
  to_status public.wa_message_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when wa_can_transition.from_status = 'received' or wa_can_transition.to_status = 'received' then false
    when wa_can_transition.from_status = 'failed' or wa_can_transition.to_status = 'pending' then false
    else
      (case wa_can_transition.to_status
         when 'sent' then 1 when 'delivered' then 2 when 'failed' then 2 when 'read' then 3 else 0 end)
      >
      (case wa_can_transition.from_status
         when 'sent' then 1 when 'delivered' then 2 when 'failed' then 2 when 'read' then 3 else 0 end)
  end;
$$;

-- Applies a delivery status (sent | delivered | read | failed) to the message with
-- `meta_message_id`, forward-only. `error` is stored on `failed`; `at` sets sent_at
-- on `sent` when it is still null. Returns:
--   'updated'     the message moved forward
--   'ignored'     the message exists but the transition is not allowed
--   'placeholder' no message has that id yet; a placeholder holds the highest status
create or replace function public.wa_update_message_status(
  meta_message_id text,
  status text,
  error jsonb default null,
  at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  target public.wa_message_status;
  row_id uuid;
  row_type text;
  row_status public.wa_message_status;
  attempt int := 0;
begin
  if wa_update_message_status.status is null
     or wa_update_message_status.status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'wa_update_message_status: invalid status %', wa_update_message_status.status;
  end if;
  target := wa_update_message_status.status::public.wa_message_status;

  perform pg_advisory_xact_lock(hashtextextended('wa_meta:' || wa_update_message_status.meta_message_id, 0));

  loop
    attempt := attempt + 1;

    select m.id, m.type, m.status into row_id, row_type, row_status
    from public.wa_messages m
    where m.meta_message_id = wa_update_message_status.meta_message_id
    for update;

    if found then
      if public.wa_can_transition(row_status, target) then
        update public.wa_messages m
        set status = target,
            error = case when target = 'failed' then wa_update_message_status.error else m.error end,
            sent_at = case
              when target = 'sent' and row_type <> 'status_placeholder'
                then coalesce(m.sent_at, wa_update_message_status.at, now())
              else m.sent_at
            end
        where m.id = row_id;
        return case when row_type = 'status_placeholder' then 'placeholder' else 'updated' end;
      end if;
      return case when row_type = 'status_placeholder' then 'placeholder' else 'ignored' end;
    end if;

    insert into public.wa_messages as m
      (conversation_id, direction, type, content, meta_message_id, status, error, sender)
    values (
      null, 'out', 'status_placeholder', '{}'::jsonb, wa_update_message_status.meta_message_id,
      target, case when target = 'failed' then wa_update_message_status.error end, 'system'
    )
    on conflict (meta_message_id) do nothing
    returning m.id into row_id;

    if row_id is not null then
      return 'placeholder';
    end if;
    if attempt >= 3 then
      raise exception 'wa_update_message_status: could not apply status to %',
        wa_update_message_status.meta_message_id;
    end if;
  end loop;
end;
$$;

-- Marks an outbound message as accepted by Meta in one transaction: deletes the
-- placeholder holding `meta_message_id` (if any) BEFORE writing the id to the real
-- row (the id is unique), then applies `sent` and the placeholder's status/error with
-- the forward-only rule. Returns the updated row, or no row when `message_id` is unknown.
create or replace function public.wa_mark_sent(message_id uuid, meta_message_id text)
returns setof public.wa_messages
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  msg public.wa_messages%rowtype;
  ph_status public.wa_message_status;
  ph_error jsonb;
  new_status public.wa_message_status;
  new_error jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('wa_meta:' || wa_mark_sent.meta_message_id, 0));

  select * into msg
  from public.wa_messages m
  where m.id = wa_mark_sent.message_id and m.conversation_id is not null
  for update;
  if not found then
    return;
  end if;

  delete from public.wa_messages m
  where m.meta_message_id = wa_mark_sent.meta_message_id and m.type = 'status_placeholder'
  returning m.status, m.error into ph_status, ph_error;

  new_status := case
    when public.wa_can_transition(msg.status, 'sent') then 'sent'::public.wa_message_status
    else msg.status
  end;
  new_error := msg.error;
  if ph_status is not null and public.wa_can_transition(new_status, ph_status) then
    new_status := ph_status;
    if ph_status = 'failed' then
      new_error := ph_error;
    end if;
  end if;

  update public.wa_messages m
  set meta_message_id = wa_mark_sent.meta_message_id,
      status = new_status,
      error = new_error,
      sent_at = coalesce(m.sent_at, now())
  where m.id = wa_mark_sent.message_id
  returning * into msg;

  return next msg;
end;
$$;

-- Shallow-merges `patch` into a message's metadata atomically. Returns the updated
-- row, or no row when `message_id` is unknown.
create or replace function public.wa_merge_message_metadata(message_id uuid, patch jsonb)
returns setof public.wa_messages
language sql
security definer
set search_path = ''
as $$
  update public.wa_messages m
  set metadata = m.metadata || coalesce(wa_merge_message_metadata.patch, '{}'::jsonb)
  where m.id = wa_merge_message_metadata.message_id and m.conversation_id is not null
  returning m.*;
$$;

revoke execute on function public.wa_can_transition(public.wa_message_status, public.wa_message_status) from public;
revoke execute on function public.wa_update_message_status(text, text, jsonb, timestamptz) from public;
revoke execute on function public.wa_mark_sent(uuid, text) from public;
revoke execute on function public.wa_merge_message_metadata(uuid, jsonb) from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke execute on function public.wa_can_transition(public.wa_message_status, public.wa_message_status) from %I', r);
      execute format('revoke execute on function public.wa_update_message_status(text, text, jsonb, timestamptz) from %I', r);
      execute format('revoke execute on function public.wa_mark_sent(uuid, text) from %I', r);
      execute format('revoke execute on function public.wa_merge_message_metadata(uuid, jsonb) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.wa_can_transition(public.wa_message_status, public.wa_message_status) to service_role;
    grant execute on function public.wa_update_message_status(text, text, jsonb, timestamptz) to service_role;
    grant execute on function public.wa_mark_sent(uuid, text) to service_role;
    grant execute on function public.wa_merge_message_metadata(uuid, jsonb) to service_role;
  end if;
end
$$;
