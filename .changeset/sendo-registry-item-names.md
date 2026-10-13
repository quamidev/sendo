---
"@quami/sendo": patch
---

Registry items drop the `sendo-` prefix: `npx shadcn add @sendo/webhook @sendo/schema`, then `npx shadcn add @sendo/inbox` (also `numbers`, `workflows`, `broadcasts`, `metrics`, `widgets`, `drizzle-schema`, `prisma-schema`). Installed files keep their paths (`components/sendo/…`, `lib/sendo.ts`, `supabase/migrations/…`), so apps that already installed the items change nothing. registry.sendo.dev still serves the old `sendo-*` names until `0.2.0`.

- `sendo doctor` and the schema-version warnings point to `npx shadcn add @sendo/schema`.
- `sendo mcp`: `list_registry_items` returns `npx shadcn add @sendo/<name>`; `get_registry_item` accepts `inbox`, `@sendo/inbox` and the old `sendo-inbox`.
- `package.json` gains `repository`, `homepage` and `bugs` (github.com/quamidev/sendo, sendo.dev).
