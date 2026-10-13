---
"@quami/sendo": minor
---

Disconnected numbers leave the default inbox, and a number's history can be exported.

- **Behaviour change (minor while 0.x):** `sendo.inbox.list` and `sendo.inbox.count` now leave out the conversations of disconnected numbers. Pass `includeInactiveAccounts: true` to include them; a query with that number's `accountId` or a non-blank `search` still finds them.
- New `sendo.accounts.export(id, { actor })`: an `AsyncIterable<string>` with the chunks of one JSON document (`SendoExportDocumentV1`, `format: "sendo-export"`, `version: 1`) holding the number's contacts, tags, conversations, messages, internal notes, assignments, system events (with their `metadata`) and media references (`storageKey`, a URL signed for 7 days, `missing`). It works on connected and disconnected numbers, streams page by page, and is a snapshot as of `exportedAt`. Admins only (`numbers.manage`): any other actor gets `ForbiddenError` when calling it, before any chunk.
- New `exportFileName(displayPhone, exportedAt)` → `sendo-export-50222345600-2026-10-12.json`, and the `SendoExport*` types.
- New CLI command `sendo accounts export <id> [--out <file>]`: writes the same document to the file (or stdout), with progress on stderr.
- `ConversationFilter` gains `excludeAccountIds` (memory, Supabase, Drizzle and Prisma adapters; covered by the adapter contract suite, which also gains an export case). Custom adapters should implement it.
