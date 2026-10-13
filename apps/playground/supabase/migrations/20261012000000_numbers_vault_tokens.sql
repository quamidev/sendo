-- sendo-numbers: Supabase Vault reference store for Embedded Signup business tokens.
--
-- `lib/sendo-token-store.ts` stores each token with `sendo_vault_store_token` and saves
-- `vault:<secret id>` as the account's `token_ref`; `lib/sendo.ts` reads it back with
-- `sendo_vault_read_token`; `disconnect` deletes it with `sendo_vault_delete_token`.
-- The functions run as their owner (security definer) and only the service role may call
-- them: the browser roles (`anon`, `authenticated`) can never store, read or delete a token.
-- Not part of the sendo_* schema version: apps that keep tokens elsewhere skip this file.

create extension if not exists supabase_vault with schema vault;

create or replace function public.sendo_vault_store_token(
  token text,
  token_name text default null,
  token_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if token is null or length(token) = 0 then
    raise exception 'sendo_vault_store_token: token is required';
  end if;
  return vault.create_secret(token, token_name, coalesce(token_description, ''));
end;
$$;

create or replace function public.sendo_vault_read_token(secret_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.id = sendo_vault_read_token.secret_id;
$$;

create or replace function public.sendo_vault_delete_token(secret_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets s where s.id = sendo_vault_delete_token.secret_id;
  return found;
end;
$$;

revoke all on function public.sendo_vault_store_token(text, text, text) from public, anon, authenticated;
revoke all on function public.sendo_vault_read_token(uuid) from public, anon, authenticated;
revoke all on function public.sendo_vault_delete_token(uuid) from public, anon, authenticated;

grant execute on function public.sendo_vault_store_token(text, text, text) to service_role;
grant execute on function public.sendo_vault_read_token(uuid) to service_role;
grant execute on function public.sendo_vault_delete_token(uuid) to service_role;
