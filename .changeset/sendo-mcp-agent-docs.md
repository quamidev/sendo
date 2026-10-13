---
"@quami/sendo": minor
---

`sendo mcp`: an MCP server for coding agents, bundled with the installed version.

- `npx -y @quami/sendo mcp` serves, over stdio, `search_docs` (BM25 over the docs), `read_doc` (a page or `slug#anchor` section), `api_reference` (declaration, JSDoc and import path of any export, e.g. `createSendo`, `InboxApi.reply`, `sendo.inbox.reply`), `list_registry_items`, `get_registry_item` (files, env vars and the item's `AGENTS.md`) and `run_doctor` (the same JSON as `sendo doctor --json`, read-only). Setup for Claude Code: `claude mcp add --transport stdio --scope project sendo -- npx -y @quami/sendo mcp`; Cursor: see https://sendo.dev/docs/agents-docs.
- The package now ships `docs/docs.json`, and the build writes `dist/api.json` (from the published `.d.ts`) and `dist/registry.json` (registry manifest plus every item's `AGENTS.md`).
- `sendo doctor --config <path>` and `sendo mcp --config <path>` use the `adapter` exported by that module instead of the Supabase adapter built from env (for Drizzle, Prisma or custom adapters).
- `@modelcontextprotocol/sdk` is a new runtime dependency, loaded only by the CLI (the library entry never imports it).
- Clearer `FORBIDDEN` and `ACCOUNT_STATE` messages: each now says what to do next (configure `resolveRole`, check `can(actor, …)`, reconnect the number).

No schema change.
