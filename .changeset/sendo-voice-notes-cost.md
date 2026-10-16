---
"@quami/sendo": minor
---

Voice-note transcription and conversation cost.

- `createSendo({ transcribe: { model, timeoutMs? } })` transcribes inbound `audio` with `experimental_transcribe` from `ai` right after the media download and before the opt-out check, rules, `message` event and agent turn (30 s limit, 25 MB max). The transcript goes into the message `text` with `metadata.transcription = { model, ms }`; on failure `text` stays `null` and `metadata.transcription.error` is `too_large`, `timeout`, `no_audio`, `empty` or `failed`. An invalid `transcribe` throws `ConfigError`. Exports `TRANSCRIBE_TIMEOUT_MS`, `TRANSCRIBE_MAX_BYTES`, `TranscriptionError`, `UNTRANSCRIBED_VOICE_NOTE`.
- Agent history: inbound voice notes read as `[nota de voz] <transcript>`, or `[nota de voz sin transcribir]` (previously `[audio]`).
- `InboxMessage.transcription: { model, ms, error } | null`.
- New `sendo.inbox.cost(conversationId, { actor })` → `{ turns, tokensIn, tokensOut, costCents, unpricedTurns }` for the whole conversation (agent replies and drafts); needs `costs.view` (admins).
- Re-copy the `inbox` registry item: agent replies show their cost and tokens on hover for admins, "Costo del agente" totals the whole conversation, and voice notes show their transcript or "Sin transcripción".
