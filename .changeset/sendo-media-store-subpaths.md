---
"@quami/sendo": minor
---

Pluggable media storage. `createSendo({ media })` takes a `MediaStore` (`put`, `get`, `signedUrl`, `delete`, optional `exists`); the pipeline's media download, the signed URLs of `sendo.inbox.thread`, agent vision, `sendo.accounts.purge` and `sendo doctor`'s bucket check all go through it. Without `media` the adapter's default store is used (`supabaseAdapter` keeps its bucket, `memoryAdapter` its in-memory map); with neither, inbound media is stored as `failed` and doctor reports a `config` fix.

New subpaths:

- `@quami/sendo/storage/supabase`: `supabaseStorage({ client, bucket })`, the store `supabaseAdapter` now uses.
- `@quami/sendo/storage/s3`: `s3Storage({ client, bucket })` for AWS S3, Cloudflare R2 and other S3-compatible stores (optional peers `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`), with `S3StorageError`.
- `@quami/sendo/snippets` and `@quami/sendo/rules`: client-safe helpers (snippet search and variables, `SNIPPET_BODY_MAX_LENGTH`, `TAG_NAME_MAX_LENGTH`, `SNIPPET_VARIABLE`; rule schemas and types) that don't pull the server runtime into browser bundles.
- `@quami/sendo/adapters/drizzle` and `@quami/sendo/adapters/prisma`: reserved, they throw `NotImplementedError` until the Drizzle and Prisma adapters land (optional peers `drizzle-orm`, `@prisma/client`).

`@quami/sendo/adapters/contract` adds `runMediaStoreContract`, and the main entry exports `metricsFromSql`, `metricsViewStatements` and the `MediaStore` type. `sendo doctor --config` reads an optional `media` export next to `adapter`.

**Breaking for custom adapters:** `SendoAdapter.storage` is now an optional `MediaStore`: rename `remove` to `delete` and `bucketExists` to `exists`. Adapters without media storage can omit it and rely on `createSendo({ media })`.

The Supabase adapter now stamps broadcast recipients' `updated_at` with one clock on insert and update, so `nextPending` ordering no longer mixes the database and app clocks.
