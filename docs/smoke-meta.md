# Real-Meta smoke run (`pnpm smoke:meta`)

A manual end-to-end run against a real Meta app and a real WhatsApp number. It proves what the automated suites can't: that Meta's live payloads, statuses, media downloads and errors still match what `@quami/sendo` expects. It covers AC-SM-1 and AC-SM-2.

- **Manual only.** It needs real credentials and a person with a phone. It never runs in CI; the script refuses to start when `CI` is set.
- **Output:** `test-results/smoke-meta.json` at the repo root (git-ignored). Attach it to the PR or the build log of the work it validates.
- **Run it** before a release, after a Graph API version bump, and whenever Meta announces webhook or payload changes.

## What it checks

| #   | Step id         | You do                                                     | Passes when                                                                                                         |
| --- | --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | `doctor`        | nothing                                                    | `sendo doctor --url <tunnel> --account <id> --json` reports every check ok, including the webhook challenge         |
| 2   | `template`      | confirm the template arrived                               | templates sync from the WABA, the template sends outside the 24-hour window, and Meta returns a message id          |
| 3   | `inbound-text`  | send `hola` from your phone                                | the inbound text is stored, the agent replies with the real model, and the read receipt for the inbound is accepted |
| 4   | `status-read`   | open the chat on your phone                                | the last outbound message reaches status `read` through the status webhooks                                         |
| 5   | `inbound-image` | send a photo                                               | the image is downloaded to storage (`download_status = done`) and the stored file can be read back                  |
| 6   | `handoff`       | send `quiero hablar con una persona`, then `hola de nuevo` | the agent hands off (status `human`), the script returns the conversation to the agent, and the agent replies again |

After the steps it reads the WABA billing field (see [Billing field check](#billing-field-check)) and asks you to type any discrepancies you noticed.

## Prerequisites

- **Meta app** with the WhatsApp product, and a WhatsApp Business Account (WABA) with a phone number. The free test number works. With a test number, add your phone as a verified recipient first (WhatsApp → API Setup → "To").
- **Access token** of a system user with `whatsapp_business_messaging` and `whatsapp_business_management`. A temporary token from API Setup works for one run but expires within 24 hours.
- **App secret** (App settings → Basic) and a **verify token** of your choice.
- **An approved template.** Test numbers come with `hello_world` (`en_US`), which is the default. For another template set `SENDO_SMOKE_TEMPLATE`, `SENDO_SMOKE_TEMPLATE_LANGUAGE` and, if it has body variables, `SENDO_SMOKE_TEMPLATE_VARIABLES` (comma-separated).
- **Your phone** with WhatsApp, on the number you put in `SENDO_SMOKE_TO`.
- **Docker** for local Supabase (`colima start` on macOS).
- **A real model** for the playground agent: an AI Gateway model id in `SENDO_AGENT_MODEL` (for example `openai/gpt-5-mini`) and `AI_GATEWAY_API_KEY`. The mock model is not allowed, so the script refuses to start without `SENDO_AGENT_MODEL`.
- **A tunnel** that gives `localhost:3000` a public HTTPS URL: `cloudflared` or `ngrok`.

## Setup

1. Install and build from the repo root.

   ```bash
   pnpm install
   pnpm build
   ```

2. Start local Supabase and load the schema.

   ```bash
   pnpm supabase start
   pnpm supabase db reset          # fresh schema + storage bucket
   pnpm supabase status -o env     # API_URL and SERVICE_ROLE_KEY for the next step
   ```

3. Create `apps/playground/.env.local`. The script and the playground both read it, so they share one configuration. Remove `SENDO_PLAYGROUND_MODE=fixtures` and `SENDO_PLAYGROUND_FAKE_META` if you copied them from `.env.example`.

   ```bash
   # Playground in Supabase mode
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   SENDO_STORAGE_BUCKET=sendo-media

   # Meta
   SENDO_META_APP_SECRET=...
   SENDO_VERIFY_TOKEN=...
   SENDO_META_APP_ID=...            # optional: lets doctor check the WABA subscription
   SENDO_TOKEN_SMOKE=...            # access token; the name must match sendo_accounts.token_ref

   # Real model
   SENDO_AGENT_MODEL=openai/gpt-5-mini
   AI_GATEWAY_API_KEY=...

   # Smoke run
   SENDO_SMOKE_TO=+50255551234
   SENDO_SMOKE_WEBHOOK_URL=https://<tunnel>/api/sendo/webhook
   SENDO_SMOKE_ACCOUNT=<phone_number_id>
   ```

4. Seed the dev user (so you can watch the run in the inbox at `/inbox`) and register the real number under the playground tenant. Run `accounts add` from `apps/playground` so it reads that `.env.local`.

   ```bash
   pnpm --filter playground seed
   cd apps/playground
   node ../../packages/sendo/dist/cli.js accounts add \
     --phone-number-id <phone_number_id> --token-env SENDO_TOKEN_SMOKE \
     --tenant-id 00000000-0000-4000-8000-00000000a001 --yes
   cd ../..
   ```

   The seed also creates the fake fixtures account, so `SENDO_SMOKE_ACCOUNT` is required to pick the real one.

5. Start the playground and the tunnel, each in its own terminal.

   ```bash
   pnpm --filter playground dev
   cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
   ```

   Put `<tunnel URL>/api/sendo/webhook` in `SENDO_SMOKE_WEBHOOK_URL`.

6. Point Meta at the tunnel. In the App Dashboard → WhatsApp → Configuration:
   - Callback URL: the value of `SENDO_SMOKE_WEBHOOK_URL`. Verify token: the value of `SENDO_VERIFY_TOKEN`.
   - Subscribe the `messages` webhook field.
   - Subscribe the app to the WABA if `doctor` reports it missing: `POST /{waba_id}/subscribed_apps` with the access token.

## Run

```bash
pnpm smoke:meta                              # every step
pnpm smoke:meta --only inbound-image,handoff # a subset (ids from the table above)
pnpm smoke:meta --timeout 300                # wait longer for each webhook-driven result
```

The script loads `.env.local` and `.env` from the repo root and from `apps/playground`, without overriding variables already set in your shell. It stops before touching Meta and exits with code 2 when something required is missing:

- the variables listed in `pnpm smoke:meta --help`
- the token variable named in `sendo_accounts.token_ref`
- a non-HTTPS webhook URL
- the playground still in fixtures or fake-Meta mode
- a missing `packages/sendo/dist`
- stdin that isn't a terminal

Exit codes: `0` all steps passed, `1` a step failed, `2` setup or usage error, `130` interrupted (Ctrl+C still writes a partial report).

Follow the prompts. Each prompt waits for Enter, then polls the shared database for up to `--timeout` seconds. Watch the playground terminal for webhook errors while it waits.

## The report

`test-results/smoke-meta.json`:

```jsonc
{
  "tool": "smoke-meta",
  "timestamp": "2026-10-09T15:04:05.000Z", // start of the run
  "finishedAt": "2026-10-09T15:12:40.000Z",
  "passed": true, // every step passed and the run was not interrupted
  "packageVersion": "0.1.0",
  "graphApiVersion": "v26.0",
  "account": { "phoneNumberId": "…", "wabaId": "…", "displayPhone": "…" },
  "tester": "+*******1234", // only the last four digits
  "webhookUrl": "https://…/api/sendo/webhook",
  "agentModel": "openai/gpt-5-mini",
  "steps": [
    {
      "id": "inbound-text",
      "status": "pass", // or "fail"
      "startedAt": "…",
      "durationMs": 8123,
      "metaIds": ["wamid.…", "wamid.…"],
      "details": {
        "inbound": { "text": "hola", "status": "received" },
        "agentReply": { "text": "…" },
      },
      "error": null,
    },
  ],
  "fieldChecks": {
    "billing": {
      "request": "GET /{waba_id}?fields=primary_funding_id",
      "status": 200,
      "result": "present",
    },
  },
  "discrepancies": [
    {
      "step": "manual",
      "summary": "…",
      "expected": null,
      "observed": null,
      "link": "https://github.com/…/issues/12",
    },
  ],
}
```

The whole report goes through the package's redaction utility (`redactLogValue`) before it's written. That removes the values of every env var whose name contains `TOKEN`, `SECRET`, `KEY` or `PASSWORD`, the account's access token, `Bearer` credentials and `access_token` parameters. Console output goes through `redactText` the same way. Before you share a report, check it anyway: `grep -c "EAA" test-results/smoke-meta.json` should print `0`.

## Discrepancies

A discrepancy is anything Meta does that differs from what the package expects: a field name, a payload shape, a status order, an error code, or a step that only passed after a workaround.

- The script records some automatically: a failed read receipt, a stored image whose size differs from `size_bytes`, a handoff that had to be forced.
- At the end it asks for the ones you noticed. Type a one-line summary, then either a link to the issue you filed, or nothing if you fixed it in the same branch.

AC-SM-2 requires every discrepancy to be fixed, or filed and linked in the report. For each one, either:

- **Fix it** in the package (parser, schema, mapping), add a fixture under `packages/sendo/test/fixtures/` with the real (anonymized) payload, and extend the integration suite. Then re-run the affected step with `--only`.
- **File it** as a GitHub issue with the step id, the expected and observed values, the anonymized payload and the Graph API version. Put the issue URL in `link`.

To see the raw payload Meta sent, read the latest events from the local database (or use the SQL editor in Supabase Studio, http://127.0.0.1:55323):

```bash
psql postgresql://postgres:postgres@127.0.0.1:55322/postgres \
  -c "select received_at, status, payload from sendo_events order by received_at desc limit 5"
```

Anonymize phone numbers, names, `wa_id`s and media ids before you paste a payload into an issue or a fixture.

## Coexistence checks

Coexistence lets a business keep using the WhatsApp Business app on the same number. These facts were checked against Meta's docs on Oct 9, 2026, but the live payloads still need confirmation (AC-CX-5). Record each item that differs as a discrepancy.

1. **Webhook fields.** In App Dashboard → WhatsApp → Configuration, check that these fields exist and can be subscribed, with these exact names: `smb_message_echoes`, `history` and `smb_app_state_sync`.
2. **Embedded Signup extras.** Coexistence onboarding uses `extras: { featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }`. The older `coexistence` value is deprecated. Embedded Signup v2 is being deprecated around Oct 15, 2026, so check that v3 (or later) is what Meta's docs and your app configuration offer.
3. **Echo payload** (needs a number onboarded through coexistence). Subscribe `smb_message_echoes`, then send a message to your phone from the WhatsApp Business app. Read the newest `sendo_events` row (query above) and record:
   - the `field` value and where the message object sits in the payload
   - the sender and recipient fields
   - whether a message id (`wamid`) is present
4. **Echoes and the window.** An echo must not open or extend the 24-hour window. After the echo, `last_inbound_at` and `window_expires_at` on the conversation must be unchanged:

   ```bash
   psql postgresql://postgres:postgres@127.0.0.1:55322/postgres \
     -c "select status, last_inbound_at, window_expires_at from sendo_conversations order by last_activity_at desc limit 3"
   ```

5. **History payload** (optional). On a fresh coexistence onboarding with history sharing, record the shape of the `history` change.

If the number isn't onboarded through coexistence, do items 1 and 2 only, and add a discrepancy that says "coexistence payloads not verified" with no link, so the gap stays visible.

## Billing field check

The billing state reads the WABA's funding information. The script calls `GET /{waba_id}?fields=primary_funding_id` with the account token and records the result under `fieldChecks.billing`:

| `result`  | Meaning                                                    | Do                                                                                                                                                                                       |
| --------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `present` | The field exists and has a value: a payment method is set. | Nothing.                                                                                                                                                                                 |
| `absent`  | The request worked but the field is empty or missing.      | Check in Business Settings → Payment methods whether the WABA really has no payment method. If it does have one, file a discrepancy: the field doesn't reflect it.                       |
| `error`   | Meta rejected the request (see `error`).                   | Usually the field was renamed or needs another permission. Find the current equivalent in the Graph API reference for "WhatsApp Business Account", and file a discrepancy with the name. |

If a WABA without a payment method is available, also send a template to it (step `template`, with `SENDO_SMOKE_ACCOUNT` pointing at that number). Record whether Meta answers with error code `131042`, which the package maps to "billing not ready".

## Troubleshooting

- **`doctor` fails the webhook check.** The tunnel is down, the URL doesn't end in `/api/sendo/webhook`, or `SENDO_VERIFY_TOKEN` differs between the playground and the Meta dashboard. Restart the playground after you edit `.env.local`.
- **No inbound message within the timeout.** Check that:
  - Meta shows the callback URL as verified
  - the `messages` field is subscribed
  - the app is subscribed to the WABA
  - the playground terminal shows the POST

  Tunnels with a browser interstitial (some ngrok plans) block Meta's requests.

- **Signature errors in the playground.** `SENDO_META_APP_SECRET` isn't the secret of the app that owns the webhook.
- **The template step fails with "not on the WABA".** The template isn't approved for this WABA or the language code differs (`en_US` vs `en`).
- **The agent doesn't reply.** `SENDO_AGENT_MODEL` or `AI_GATEWAY_API_KEY` is wrong. The playground logs the model error.
- **A test number can't message your phone.** Add your phone as a recipient in API Setup and accept the verification code.
