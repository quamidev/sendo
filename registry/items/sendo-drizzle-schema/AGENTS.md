# sendo-drizzle-schema — notes for agents

Sendo on your own Postgres (Neon, RDS, Cloud SQL, self-hosted) through Drizzle instead of Supabase. Ships the
Drizzle schema of every `sendo_*` table (for typed reads in your app), a prelude that makes the `sendo-schema`
SQL migrations run on plain Postgres, and `lib/sendo-adapter.ts`, which builds `drizzleAdapter` from
`@quami/sendo/adapters/drizzle`. Install with `npx shadcn@latest add @sendo/sendo-drizzle-schema` (plus
`@sendo/sendo-schema` for the SQL files). Needs Postgres 15+, `drizzle-orm` and `pg` (or `postgres`), and a
`MediaStore` for media (e.g. `s3Storage`).

## Files

| File                                | What it is                                                                                                                        | Yours to edit?                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `lib/sendo-adapter.ts`              | Creates the pool, the Drizzle `db` and `adapter = drizzleAdapter({ db })`; commented `media` (S3) export.                         | Yes: reuse your own `db`, add `media`. |
| `lib/db/sendo-schema.ts`            | `pgTable`/`pgEnum` definitions of the 15 `sendo_*` tables (schema v3), plus `sendoTables`.                                        | No (regenerated with each version).    |
| `lib/db/sendo-postgres-prelude.sql` | Run once before the SQL migrations on non-Supabase Postgres: NOLOGIN roles `anon`, `authenticated`, `service_role`; `auth.uid()`. | No.                                    |

Apply the database in this order: the prelude, then `20261010000000_sendo_v1.sql`, `20261011000000_sendo_v2.sql`,
`20261013000000_sendo_v3.sql` (from `sendo-schema`), each once, with your migration tool (e.g. paste each into a
`drizzle-kit generate --custom` migration, or run them with `psql -f`).

## Don't touch

- **The SQL migrations are the source of truth**, not `sendo-schema.ts`: they also create constraints, partial
  unique indexes, functions, RLS policies and the metrics views Drizzle can't express. Keep `sendo-schema.ts` out of
  the `schema` list in `drizzle.config.ts` (or exclude `sendo_*` with `tablesFilter`) so drizzle-kit never
  generates or pushes migrations for these tables.
- **Write through `@quami/sendo`, not with these tables.** The adapter (in npm) keeps forward-only message
  statuses, status placeholders, locks, unread counts and default-number swaps consistent with transactions and
  advisory locks. Reading with your own queries is fine.
- **Access control is the package's job here.** RLS only applies to Supabase's browser roles; your app connects as
  the table owner, so every read and write must go through `sendo.actor()` and the package's capability checks
  (inbox, metrics, broadcasts). Don't expose `sendo_*` tables to clients directly.

## Connects to

- **Env:** `DATABASE_URL` (in `lib/sendo-adapter.ts`), plus your media store's settings (e.g. `SENDO_MEDIA_BUCKET`
  and AWS credentials for `s3Storage`).
- **`createSendo({ adapter, media })`** in `lib/sendo.ts` (from `sendo-webhook`): import `adapter` (and `media`)
  from `lib/sendo-adapter.ts`. Without a `media` store, inbound media is marked `failed` and doctor warns.
- **Items:** `sendo-schema` (the SQL migrations). UI items (`sendo-inbox`, …) work unchanged; without Supabase
  Realtime the inbox polls (list every 10 s, open thread every 3 s).
- **CLI:** `npx @quami/sendo doctor --config lib/sendo-adapter.ts` and `sendo mcp --config lib/sendo-adapter.ts`.

## Verify

1. `psql "$DATABASE_URL" -c "select version from sendo_schema_meta order by version desc limit 1"` returns `3`.
2. `npx @quami/sendo doctor --config lib/sendo-adapter.ts`: `tables` and `schema-version` are `OK`.
3. Send a test message to your number: a row appears in `sendo_messages` and the inbox shows it.
