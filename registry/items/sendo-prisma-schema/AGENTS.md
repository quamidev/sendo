# sendo-prisma-schema — notes for agents

Prisma models for the `sendo_*` tables, for apps on their own Postgres (Neon, RDS, Cloud SQL, self-hosted…) that
use Prisma instead of Supabase. Installed by `npx shadcn@latest add @sendo/sendo-prisma-schema` into `prisma/`. It
needs Postgres 15+, Prisma 5+ (7 recommended, with a driver adapter such as `@prisma/adapter-pg`) and the
`sendo-schema` SQL migrations (`npx shadcn@latest add @sendo/sendo-schema`), which create the tables. Sendo talks to
the database through `prismaAdapter` from `@quami/sendo/adapters/prisma`, which runs raw SQL with bound parameters
on your `PrismaClient`; it never uses these models, so their names are yours to change.

## Files

| File                                | What it is                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/sendo.prisma`               | Models and enums only (no `generator` / `datasource`). Use Prisma's multi-file schema (`schema: "prisma"` in `prisma.config.ts`, or `--schema prisma`) or paste the blocks into your `schema.prisma`. You may rename models and fields, and add relations to your own models. |
| `prisma/sendo-postgres-prelude.sql` | Run once before the `sendo-schema` migrations on plain Postgres: creates `NOLOGIN` stand-ins for the Supabase roles the RLS policies name, and `auth.uid()` (returns null). Not needed on Supabase.                                                                           |

Wire the adapter yourself, e.g. in `lib/sendo-adapter.ts` (also what `sendo doctor --config` / `sendo mcp --config`
read):

```ts
import { prismaAdapter } from "@quami/sendo/adapters/prisma";
import { prisma } from "@/lib/prisma"; // your PrismaClient

export const adapter = prismaAdapter({ prisma });
// export const media = s3Storage({ client: new S3Client({}), bucket: process.env.SENDO_MEDIA_BUCKET! });
```

then `createSendo({ adapter, media, ... })` in `lib/sendo.ts`. Tables live in another Postgres schema? Pass
`prismaAdapter({ prisma, schema: "sendo" })`.

## Don't touch

- **Don't change table names, column names, types or `@map`s.** The adapter and the metrics SQL use the SQL names
  as-is; the package's tests check these models against the SQL migrations.
- **Don't create or change `sendo_*` tables with Prisma Migrate.** The SQL migrations own them, including what
  Prisma can't express: CHECK constraints, partial and expression indexes (`sendo_accounts_default_per_tenant`,
  `sendo_conversations_open_contact_key`, `sendo_snippets_shortcut_key`, `sendo_tags_name_key`, the draft, tick
  and broadcast indexes), `unique nulls not distinct` on `sendo_rules`, RLS, functions and the `sendo_metrics_*`
  views. Put each Sendo file in its own Prisma migration (`npx prisma migrate dev --create-only --name sendo_v1`,
  paste the SQL, then `npx prisma migrate dev`). With these models unchanged, `prisma migrate diff` against the
  migrated database is empty (Sendo's tests check it), so Migrate generates nothing for `sendo_*`. If a later
  migration ever touches a `sendo_*` table or index, you changed a model: undo that change instead.
- **Don't write to `sendo_*` tables from your app** except through `@quami/sendo` (it keeps status ordering,
  locks and counters consistent). Reading them with the models is fine.
- **Access control is the package's role checks** (`sendo.actor()` + capabilities), not RLS: your app connects
  as the table owner, so the policies don't apply. Never expose these tables to a browser client.

## Connects to

- **Package:** `prismaAdapter({ prisma, media?, schema?, transaction? })` from `@quami/sendo/adapters/prisma`
  (optional peer `@prisma/client`). Needs `$queryRawUnsafe`, `$executeRawUnsafe` and interactive `$transaction`.
- **Media:** no Supabase Storage here: pass a `MediaStore`, e.g. `s3Storage()` from `@quami/sendo/storage/s3`
  (`npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`), as `createSendo({ media })` or `prismaAdapter({ media })`.
- **Inbox:** without Supabase Realtime the `sendo-inbox` item polls (list every 10 s, open thread every 3 s).
- **Env:** your Prisma connection string (e.g. `DATABASE_URL`), read by your `PrismaClient`, not by Sendo.
- **Other items:** `sendo-schema` (the SQL migrations, required); `sendo-drizzle-schema` is the Drizzle equivalent.

## Verify

1. `psql "$DATABASE_URL" -f prisma/sendo-postgres-prelude.sql` (plain Postgres only), then apply the `sendo-schema`
   migrations in file-name order (as Prisma migrations or with `psql`).
2. `npx prisma validate` and `npx prisma generate` succeed with `prisma/sendo.prisma` included.
3. `npx @quami/sendo doctor --config lib/sendo-adapter.ts`: `tables` and `schema-version` are `OK`.
4. Send a test message to your number: a row appears in `sendo_messages`
   (`await prisma.sendoMessage.findMany({ take: 1, orderBy: { createdAt: "desc" } })`).
