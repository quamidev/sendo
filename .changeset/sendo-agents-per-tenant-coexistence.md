---
"@quami/sendo": minor
---

Agents per tenant, agent pause and WhatsApp Business app coexistence.

- `AgentDefinition` gains `tenants?` (tenant ids, `null` for no tenant, or `(tenantId) => boolean`), ANDed with `accounts`, so one definition serves many organizations; the registration overlap check considers both lists. `mode?: "auto" | "draft"` is declared (draft behaviour lands with the team inbox).
- No agent turn runs while the number (`accounts.pauseAgent`) or the conversation is paused, or while a rule holds the agent. Checked when the conversation lock is taken, so a running turn finishes. Inbound messages are still stored and still bump unread and the window.
- The webhook parser handles `smb_message_echoes` (`ParsedEcho`, `kind: "echo"`) and `history` (`ParsedHistory`, `kind: "history"`); new `parseChanges(body)` returns every handled change (`parseWebhook` still returns only `messages` changes).
- Echoes are stored as sent outbound messages (`sender: "human"`, `senderRef` and `metadata.origin` `"business_app"`), deduplicated by Meta id, update activity but never the 24-hour window, and pause the agent on `agent` conversations (`coexistence.pauseAgentOnPhoneReply`, default true) with a `conversation.agent_paused` event by `"business_app"`.
- With `coexistence.importHistory`, `history` messages are stored with `metadata.imported = true` and never trigger the agent; otherwise they are acknowledged and ignored.

Subscribe your Meta app to the `smb_message_echoes`, `history` and `smb_app_state_sync` webhook fields for coexistence numbers. No schema change.
