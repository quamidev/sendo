-- supabase/migrations/<timestamp>_sendo_can_access_tenant.sql
-- #region multi
-- Multi-tenant: a user sees the sendo_* rows of the tenants they belong to.
create or replace function public.sendo_can_access_tenant(tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.tenant_id = sendo_can_access_tenant.tenant_id
  );
$fn$;
-- #endregion multi

-- #region single
-- Single tenant (tenant_id is null): only signed-in staff.
create or replace function public.sendo_can_access_tenant(tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from public.staff s where s.user_id = auth.uid()
  );
$fn$;
-- #endregion single
