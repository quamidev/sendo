---
"@quami/sendo": minor
---

First public release of `@quami/sendo` (0.1.0), MIT licensed and published with public access.

The package was previously developed under a different name. Apps that used the earlier copy need these changes:

- Install `@quami/sendo` and import from `@quami/sendo` and its subpaths (`/adapters/memory`, `/adapters/supabase`, `/adapters/contract`, `/next`). The CLI is `npx @quami/sendo doctor`.
- Rename environment variables to the `SENDO_*` names. The app secret is `SENDO_META_APP_SECRET`.
- Re-install the registry items from the `@sendo` namespace: `npx shadcn add @sendo/webhook @sendo/schema @sendo/inbox`. The items dropped their `sendo-` prefix (`sendo-inbox` is now `inbox`); the files they copy keep their paths (`components/sendo/…`, `lib/sendo.ts`), and the old names keep resolving on registry.sendo.dev until `0.2.0`.

**Migration:** copy `20261010000000_sendo_v1.sql` from the `@sendo/schema` registry item into `supabase/migrations/` and run it (`supabase db push`, or `supabase db reset` locally). It creates the `sendo_*` tables (multichannel and team columns included), RLS policies and hooks (`sendo_can_access_internal`, `sendo_can_access_conversation`), functions (including the `sendo_set_default_account` RPC) and the private `sendo-media` storage bucket, at schema version 1. Then run `npx @quami/sendo doctor` to confirm the schema version.
