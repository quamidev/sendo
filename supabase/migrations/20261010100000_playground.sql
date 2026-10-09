-- sendo playground: RLS access rule for the sendo_* tables (app-specific, not part of the
-- sendo-schema registry item). Canonical copy: apps/playground/supabase/migrations/.
-- The root Supabase project (supabase/migrations/) holds a byte-identical copy, asserted
-- by [CC-SCH-1] in packages/sendo/test/integration/consistency.test.ts.
--
-- A signed-in user can read the sendo_* rows of the tenant stored in their JWT
-- app_metadata.tenant_id (set with the service role, e.g. by `pnpm --filter playground
-- seed`; users cannot change app_metadata themselves). Rows without a tenant stay hidden.
create or replace function public.sendo_can_access_tenant(tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select sendo_can_access_tenant.tenant_id is not null
    and (select auth.role()) = 'authenticated'
    and sendo_can_access_tenant.tenant_id::text = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id');
$$;

comment on function public.sendo_can_access_tenant(uuid) is
  'Playground: true when the tenant matches auth.jwt() -> app_metadata ->> tenant_id.';
