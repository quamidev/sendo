---
"@quami/sendo": minor
---

The package speaks English to developers.

- **Breaking (minor while 0.x): `sendo --help`, every CLI message and prompt, `sendo doctor` check labels, details and `fix.detail`, the `accounts list` table headers, `rules sync` output and every thrown package error are now English.** The doctor table uses `OK` / `FAIL` / `WARN` and `-> Fix:`. Error `code`s, check `id`s and `fix.kind`s are unchanged, so code that branches on them keeps working; code that matched Spanish message text must switch to the codes.
- Rule validation messages (`@quami/sendo/rules` schemas and `sendo rules sync`) and `schemaDriftMessage` ("Your database is at schema version N and Sendo expects M. Run these migrations: …") are English. The registry rules screen shows the schema-declared messages as they are, so they are English there too.
- The agent system prompt is English and tells the model to reply in the contact's language. The handoff tool keeps its name (`transferir_a_humano`) and `motivo` input; its description is English and its result is `{ handedOff, status, assignees }`. History labels the model reads are English (`[operator] `, `[voice note]`, `[untranscribed voice note]`, `[image]`, …; `HUMAN_PREFIX` and `UNTRANSCRIBED_VOICE_NOTE` hold the new values), and the current date is formatted neutrally (`en-US`) with the IANA time zone.
- `sendo mcp` search drops the Spanish stop words (the docs are English).
- End-customer WhatsApp text is unaffected here; it follows `createSendo({ locale })`.
