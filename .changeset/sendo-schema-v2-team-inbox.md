---
"@quami/sendo": minor
---

Schema v2: storage for the team inbox (snippets, tags and rules).

**Migration:** copy `20261011000000_sendo_v2.sql` from the `sendo-schema` registry item into `supabase/migrations/` and run it (`supabase db push`, or `supabase db reset` locally). Re-installing the item (`npx shadcn add @sendo/sendo-schema`) adds the file too. It is additive: it creates `sendo_snippets`, `sendo_tags`, `sendo_conversation_tags` and `sendo_rules` with RLS select policies through `sendo_can_access_tenant`, the optional hook `sendo_current_user_id()` (personal snippets are only readable by their owner; defaults to `auth.uid()::text`, replace it if your app's user ids are not Supabase Auth ids), the service-role functions `sendo_merge_rule_state`, `sendo_escalation_candidates` and `sendo_count_by_source`, and sets schema version 2. Until it runs, `sendo doctor` and the startup check report the drift.

- New entities `Snippet`, `Tag` and `StoredRule`, and enums `SNIPPET_VISIBILITIES`, `TAG_COLORS`, `RULE_TYPES` and `RULE_ORIGINS`.
- `SendoAdapter` gains the `snippets`, `tags` and `rules` namespaces, `conversations.count`, `countBySource`, `countByAssignee` and `findForTick`, `messages.update` and `messages.deleteDrafts`. `conversations.list` accepts `tagIds` (any match), `queue`, `visibleTo` and `search`. Custom adapters must implement them and pass the contract suite.
- `SENDO_TABLES` (checked by `healthCheck` and `sendo doctor`) includes the four new tables.
