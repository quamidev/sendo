---
"@quami/sendo": minor
---

Broadcasts and marketing opt-in.

- `sendo.broadcasts.preview/create/get/list/recipients/cancel({ actor })` (needs `broadcasts.manage`): send one APPROVED template to many contacts. MARKETING templates go only to contacts with `marketingOptIn = true`; UTILITY and AUTHENTICATION templates go to every contact who hasn't explicitly opted out. Ineligible recipients are stored `skipped` with `no_opt_in` / `opted_out` / `invalid_phone`; phones become contacts. `ratePerMinute` defaults to 60.
- `sendo.maintenance.tick()` now sends broadcasts: up to `ratePerMinute` recipients per broadcast and tick, with `metadata.broadcastId` on the stored message. Status webhooks move recipients forward (sent → delivered → read, or failed with Meta's error). Meta 131042 pauses the broadcast (`pauseReason: "billing"`) and marks the number `billingReady = false`; the tick resumes it once `billingReady` is true. A rate limit (130429) stops the pass and leaves recipients `pending`. Broadcast messages never move a conversation to `human` or run the agent.
- `sendo.contacts.setOptIn(contactId, optIn, { source? })` records an explicit decision and emits the new `contact.opt_in` event.
- Inbound opt-out keywords (`optOut: { keywords?, confirmation? }`, default `BAJA`, `STOP`, `ALTO`, `CANCELAR`): an exact match after trimming and ignoring case and accents opts the contact out, emits `contact.opt_in`, sends the confirmation inside the 24-hour window and skips rules and the agent turn.
- Adapter: `contacts.getByPhone(accountId, phone)`, `contacts.setOptIn(id, { marketingOptIn, optInAt })` and `broadcasts.listRecipients({ broadcastId, status?, cursor?, limit })`. Custom adapters must implement them (covered by `runAdapterContract`).

No schema change (uses the v3 tables).
