-- =============================================================================
-- @quami/sendo — prelude for plain Postgres (Neon, RDS, Cloud SQL, self-hosted...)
--
-- Run this ONCE, before the `sendo-schema` migrations (v1, v2, v3), on a Postgres 15+
-- database that is NOT Supabase. The migrations reference three Supabase roles (in
-- their read-only RLS policies) and `auth.uid()` (the personal-snippet hook); this
-- creates stand-ins that grant nothing:
--
-- * roles `anon`, `authenticated` and `service_role`, NOLOGIN (nobody can connect as them);
-- * `auth.uid()`, which always returns null.
--
-- Your app connects with its own role (the one that owns the tables) through the
-- Drizzle or Prisma adapter. RLS policies don't apply to the table owner, so access
-- control is the package's role checks (`sendo.actor()` + capabilities).
--
-- Safe to run more than once. On Supabase it changes nothing (everything exists).
-- Creating roles needs CREATEROLE; if your provider refuses, ask for the three roles
-- or create them from its console.
-- =============================================================================

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end
$$;

create schema if not exists auth;

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable
      as 'select null::uuid'
    $fn$;
  end if;
end
$$;
