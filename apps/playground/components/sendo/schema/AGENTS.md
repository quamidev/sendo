# schema — notes for agents

The Supabase migrations for every `sendo_*` table, RLS policy, lock and helper function the package uses.
Installed by `npx shadcn add @sendo/schema` into `supabase/migrations/`. Each file is one schema
version; `@quami/sendo` checks the version at runtime and `sendo doctor` lists the files still missing.

## Files

| File                                              | What it is                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261010000000_sendo_v1.sql` | Accounts, contacts, conversations, messages, media, templates, events, locks, schema meta; RLS hooks; status-ordering and lock functions; `sendo-media` bucket. |
| `supabase/migrations/20261011000000_sendo_v2.sql` | Team inbox: snippets, tags, conversation tags, rules; `sendo_current_user_id()` hook; tick and count helpers.                                                   |
| `supabase/migrations/20261013000000_sendo_v3.sql` | Broadcasts and recipients; read-only metrics views (`security_invoker`).                                                                                        |

Apply them in file-name order. Later versions only add; nothing in an earlier file changes.

## Don't touch

- **Don't edit these files after copying them.** The package expects exactly these tables, columns, constraints
  and functions (`sendo_update_message_status`, `sendo_acquire_lock`, `sendo_set_default_account`, …), and
  `sendo_schema_meta` must report the version the package was built for. Changes go in **your own later
  migration**, never in a Sendo file, so the next Sendo version applies cleanly.
- **Don't write to `sendo_*` tables from browser clients.** All writes go through the package with the service
  role; RLS only grants reads, and only through the hooks below.
- **Don't drop the `sendo_` prefix or rename columns**: the Supabase adapter and the metrics SQL use them as-is.

## Connects to

- **RLS hooks you replace** (same signature, in a later migration of your app):
  - `public.sendo_can_access_tenant(tenant_id uuid)`: **returns `false` until you replace it**, so browser
    clients (inbox realtime) see nothing. Return whether `auth.uid()` belongs to that tenant.
  - `public.sendo_can_access_internal(tenant_id uuid)` (internal notes) and
    `public.sendo_can_access_conversation(conversation_id uuid)` (per-conversation reads): optional, permissive defaults.
  - `public.sendo_current_user_id()` (v2): the app user id stored in personal snippets; default `auth.uid()::text`.
- **Storage:** v1 creates the private `sendo-media` bucket when the `storage` schema exists. Using another name?
  Create it private and set `SENDO_STORAGE_BUCKET`.
- **Package:** `SENDO_SCHEMA_VERSION` in `@quami/sendo` must match `sendo_schema_meta`. After `npm update`,
  run `npx shadcn add @sendo/schema` again to copy new versions, then apply them.
- **Other items** with their own migrations (e.g. `numbers`' Vault functions) run after these.

## Verify

1. `supabase migration up` (or `supabase db push`; locally `supabase db reset`).
2. `npx @quami/sendo doctor`: `tables`, `schema-version` and `storage` are `OK`. Behind? The `schema-version`
   fix names the exact files to apply, in order.
3. Signed in as an operator, a browser `select` on `sendo_conversations` returns that tenant's rows (after you
   replaced `sendo_can_access_tenant`) and nothing for other tenants.
