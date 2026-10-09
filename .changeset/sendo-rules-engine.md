---
"@quami/sendo": minor
---

Rules engine, `sendo.maintenance.tick()`, source attribution and `sendo rules sync`.

- Five rule types (`business_hours`, `route`, `auto_assign`, `escalate`, `auto_close`) with zod schemas exported from the main entry (`ruleParamsSchemas`, `ruleDefinitionSchema`, `parseRuleParams`, ...). Rules live in `sendo_rules`; the engine reads them per tenant (cached 30 s, refreshed on writes through `sendo.rules`).
- `sendo.rules.list/upsert/toggle/reorder/delete({ actor })` need `rules.manage` and record `updatedBy`; `list` flags stored rules whose params no longer validate (`valid`, `error`).
- Pipeline: the first message of a new or reopened conversation sets `conversation.source` and `message.metadata.source` from a trailing `[#code]` or a Click-to-WhatsApp `referral` (`ad:<source_id>`), then `route` rules run (first match wins). Inbound messages outside business hours get the after-hours message once per closed period, only inside the 24-hour window. `appliesTo: "all"` holds the agent.
- `sendo.maintenance.tick({ now?, budgetMs? })` (lock `tick`, 120 s) hands held conversations back to the agent when hours open, escalates, auto-closes, re-checks billing hourly for accounts with `billingReady = false`, and prunes events once a day. It returns a `TickReport` with per-step counts. Call it every minute from a cron route.
- Every rule action writes a system line in the thread and emits `rule.applied` (plus `conversation.status`, `conversation.assigned` or `escalation`) with `by: "rule:<key>"`.
- CLI: `sendo rules sync --config <path> [--force] [--tenant <id>]` loads `rules` from a JS/TS module and inserts missing rules with origin `code`; existing rules are only overwritten with `--force`. `jiti` is a new runtime dependency, loaded only by the CLI.

No schema change (uses the v2 tables).
