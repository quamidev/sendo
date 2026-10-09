---
"@quami/sendo": minor
---

Drizzle adapter: run Sendo on any Postgres 15+ (Neon, RDS, Cloud SQL, self-hosted) without Supabase. `drizzleAdapter({ db, media? })` from `@quami/sendo/adapters/drizzle` takes a `drizzle-orm/node-postgres` or `drizzle-orm/postgres-js` database (optional peer `drizzle-orm`) and implements the whole `SendoAdapter`, including snippets, tags, rules, broadcasts and `metrics.*` (through `METRICS_SQL`). It passes the adapter contract suite on both drivers.

- Plain SQL over the `sendo_*` tables; what the Supabase functions do (forward-only status updates and placeholders, `markSent` merges, locks, unread increments, the default-number swap, metadata and rule-state merges) runs as single statements or transactions with the same advisory locks, so no function grants are needed.
- Unmapped database failures throw `DrizzleAdapterError` (`operation`, `code`, `constraint`, `detail`); the documented constraints still map to `ConstraintViolationError`.
- There is no default media store: pass `media` (e.g. `s3Storage`) here or to `createSendo`.
- On this adapter, access control is the package's role checks only (RLS applies to Supabase browser clients).

Setup: install the `sendo-schema` and `sendo-drizzle-schema` registry items; on plain Postgres run `lib/db/sendo-postgres-prelude.sql` once, then apply `20261010000000_sendo_v1.sql`, `20261011000000_sendo_v2.sql` and `20261013000000_sendo_v3.sql` in order. See https://sendo.dev/docs/adapters#drizzle.
