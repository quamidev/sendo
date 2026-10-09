---
"@quami/sendo": minor
---

Schema v3: storage for broadcasts and the metrics views.

**Migration:** copy `20261013000000_sendo_v3.sql` from the `sendo-schema` registry item into `supabase/migrations/` and run it (`supabase db push`, or `supabase db reset` locally). Re-installing the item (`npx shadcn add @sendo/sendo-schema`) adds the file too. It is additive: it creates `sendo_broadcasts` and `sendo_broadcast_recipients` with RLS select policies through `sendo_can_access_tenant` (no write policies; deleting an account deletes its broadcasts), the five read-only `security_invoker` views `sendo_metrics_daily`, `sendo_metrics_by_assignee`, `sendo_metrics_first_response`, `sendo_metrics_ai_resolution` and `sendo_metrics_by_source`, and sets schema version 3. Until it runs, `sendo doctor` and the startup check report the drift.

- New entities `Broadcast` and `BroadcastRecipient`, and enums `BROADCAST_STATUSES` and `BROADCAST_RECIPIENT_STATUSES`.
- `SendoAdapter` gains the `broadcasts` namespace (`insert`, `get`, `list`, `update`, `insertRecipients`, `nextPending`, `updateRecipient`, `recipientByMessageId`, `cancelPending`, `counts`), the read-only `metrics` namespace (`daily`, `byAssignee`, `firstResponse`, `aiResolution`, `bySource`, `cost`, all taking `{ tenantId, from, to, accountId?, tagIds? }`) and `messages.pendingDraftConversations`. Custom adapters must implement them and pass the contract suite.
- Metrics days are calendar days in the account's timezone. First response ignores internal notes, drafts and imported history; AI resolution means the conversation was never handed off and no human wrote; cost per day and per AI agent comes from `cost_cents` (drafts included).
- `METRICS_SQL`, `METRICS_VIEWS` and `metricsSqlParams` export the same queries as parameterized SQL for Drizzle, Prisma or plain `pg` users.
- `SENDO_TABLES` (checked by `healthCheck` and `sendo doctor`) includes the two new tables.
