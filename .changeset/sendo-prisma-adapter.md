---
"@quami/sendo": minor
---

Prisma adapter: run Sendo on any Postgres 15+ through your app's `PrismaClient`. `prismaAdapter({ prisma, media?, schema?, transaction? })` from `@quami/sendo/adapters/prisma` (optional peer `@prisma/client`; Prisma 5+, Prisma 7 with a driver adapter such as `@prisma/adapter-pg`) implements the whole `SendoAdapter`, including snippets, tags, rules, broadcasts and `metrics.*` (through `METRICS_SQL`), and passes the adapter contract suite.

- Raw SQL with bound parameters through `$queryRawUnsafe` / `$executeRawUnsafe`; what the Supabase functions do (forward-only status updates and placeholders, `markSent` merges, locks, unread increments, the default-number swap, rule reordering, purge, metadata and rule-state merges) runs as single statements or interactive `$transaction`s with the same advisory locks. Your generated models are never used, so their names don't matter.
- `schema` (default `public`) points the adapter at the Postgres schema that holds the `sendo_*` tables.
- Unmapped database failures throw `PrismaAdapterError` (`operation`, `code`); the documented constraints still map to `ConstraintViolationError`.
- There is no default media store: pass `media` (e.g. `s3Storage`) here or to `createSendo`.
- On this adapter, access control is the package's role checks only (RLS applies to Supabase browser clients).

Setup: install the `sendo-schema` and `sendo-prisma-schema` registry items; on plain Postgres run `prisma/sendo-postgres-prelude.sql` once, then apply `20261010000000_sendo_v1.sql`, `20261011000000_sendo_v2.sql` and `20261013000000_sendo_v3.sql` in order (each as its own Prisma migration), and include `prisma/sendo.prisma` in your Prisma schema. See https://sendo.dev/docs/adapters#prisma.
