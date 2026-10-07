-- wa-li playground: RLS access rule for the wa_* tables (app-specific, not part of the
-- wa-li-schema registry item). Canonical copy: apps/playground/supabase/migrations/.
-- The root Supabase project (supabase/migrations/) holds a byte-identical copy, asserted
-- by apps/playground/test/migrations.test.ts.
--
-- A signed-in user can read the wa_* rows of the tenant stored in their JWT
-- app_metadata.tenant_id (set with the service role, e.g. by `pnpm --filter playground
-- seed`; users cannot change app_metadata themselves). Rows without a tenant stay hidden.
create or replace function public.wa_can_access_tenant(tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select wa_can_access_tenant.tenant_id is not null
    and (select auth.role()) = 'authenticated'
    and wa_can_access_tenant.tenant_id::text = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id');
$$;

comment on function public.wa_can_access_tenant(uuid) is
  'Playground: true when the tenant matches auth.jwt() -> app_metadata ->> tenant_id.';
