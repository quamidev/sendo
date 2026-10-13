# Real-Meta run (`pnpm smoke:meta`)

A manual end-to-end run against a real Meta app and a real WhatsApp number. It proves what the automated suites can't: that someone who only reads `sendo.dev` can install Sendo, and that Meta's live payloads, statuses, media, errors and billing still match what `@quami/sendo` expects.

- **Covers:** AC-RM-1 (Path A, own Meta app) and AC-RM-2 (Path B, via Connect). It also covers AC-SM-1/2 from the earlier smoke-run spec.
- **Manual only.** It needs real credentials and a person with a phone. It never runs in CI: the script refuses to start when `CI` is set.
- **Who runs it:** Javier. The code was written by agents, so the "didn't write the code" rule holds. The tester follows **only the site's quickstart**, with no shortcuts, no monorepo paths and no help from whoever wrote the code. **Every point where they get stuck is a finding.**
- **What it runs against:** the **deployed site** and the **published package**, not an intermediate version. Run it last.
- **Output:**
  - the filled-in report, `purple/documentation/261012-new-session-2/completed-tickets-documentation/meta-smoke-report.md` (a copy of the template, one per run)
  - the script's JSON for each path (`--out`), attached to the report
  - one GitHub issue per failure or finding

## When to run each path

| Path                     | Required for              | Run it after                                                                                                                                            |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A: own Meta app**      | Launch (AC-RM-1)          | `@quami/sendo@0.1.0` is on npm ([release.md](release.md)) and `sendo.dev` is deployed from `main` ([deploy.md](deploy.md))                              |
| **B: via Sendo Connect** | Connect go-live (AC-RM-2) | Path A passed, Meta approved Quami's app as a Tech Provider, Connect is deployed at `connect.sendo.dev` / `app.sendo.dev` with `CONNECT_EARLY_ACCESS=0` |

**Leave time after the run before announcing anything.** Plan for a few days between the run and the announcement. The likeliest failures are real Meta error codes, the billing status and webhook ordering, and each needs a fix, a patch release and a re-run of the affected checks.

## What you need

- **A Meta app with a test number.** WhatsApp product added, a WhatsApp Business Account (WABA) and the free test number. Add the tester's phone as a recipient (WhatsApp → API Setup → "To").
- **A verified business** in Meta Business Manager. Embedded Signup (check 5) and real numbers need it.
- **A model API key.** An AI Gateway key (`AI_GATEWAY_API_KEY`) and a model id in `SENDO_AGENT_MODEL` (for example `openai/gpt-5-mini`). The mock model isn't allowed.
- **A spare phone with WhatsApp** that isn't anyone important's. It receives test messages, templates and possibly marketing.
- **A second number** to connect with the Embedded Signup button (check 5). Its WABA should have **no payment method**, so it doubles as the number for the billing check (check 6).
- **A number used in the WhatsApp Business app** for coexistence (check 7). It can be the second number if you pick the WhatsApp Business app option during Embedded Signup.
- **A Supabase project** (hosted, or local with Docker / `colima start`).
- **A public HTTPS URL** for the app: a Vercel preview, or a tunnel (`cloudflared tunnel --url http://localhost:3000`, or `ngrok http 3000`).
- **Node 20+ and pnpm.**
- **A clone of `quamidev/sendo`**, only to run `scripts/smoke-meta.mjs`. It needs no install or build in app mode. Nothing in the app may point at this clone.
- **A screen recorder or screenshots**, saved in one folder per run (`smoke-<date>-path-a/`), named after the check (`3-template-rejected.png`).

## Before you start

1. Copy the report template to a new file named for the date and path, then fill in the **Environment** section:
   - package version
   - site URL and the deploy's commit
   - Meta app id and the numbers
2. Start a timer. The report records how long each part took, and "how long until the first reply" is part of the result.

## Step 1: from sendo.dev to a working app (both paths)

Follow the site, not this file. This section only lists what to record.

1. Open **https://sendo.dev** in a fresh browser profile. It should redirect to `/en` (or `/es`). Screenshot the home page.
2. Go from the home page to the quickstart (**https://sendo.dev/docs/quickstart**) using only links on the site. If you can't find it, that's a finding.
3. Create a **fresh** Next.js app in an empty folder outside any monorepo:

   ```bash
   mkdir ~/sendo-smoke && cd ~/sendo-smoke
   pnpm create next-app@latest smoke-app --yes
   cd smoke-app
   ```

   The quickstart starts from "an existing Next.js App Router + Supabase app". Anything you had to do that it doesn't say, such as creating the app, adding Supabase or `supabase init`, goes in the report as a deviation.

4. Install exactly what the quickstart says:

   ```bash
   pnpm add @quami/sendo ai zod
   npx shadcn add @sendo/webhook @sendo/schema @sendo/inbox
   ```

   - `pnpm list @quami/sendo` must show the published version (`0.1.0` or later), with no `link:`, `file:` or `workspace:` path. The script warns and records a finding if the app resolves the package from the Sendo repo.
   - If shadcn answers that it doesn't know `@sendo`, use the `components.json` fallback from the quickstart. Record that you needed it, and whether the quickstart told you how.
   - Record every warning: unmet peers, React or Next version mismatches, or prompts that the quickstart didn't mention.

5. Do the remaining quickstart steps in order:
   - migrations and `sendo_can_access_tenant`
   - env vars and `lib/sendo.ts`
   - `accounts add`
   - the Meta webhook
   - `doctor`
   - "hola"

   Use the path-specific notes below for the webhook and the number. For each step, note the time spent and anything unclear.

6. Start the app (`pnpm dev` plus the tunnel, or deploy it) and keep its terminal visible. Webhook errors show up there.

Every point where you got stuck, guessed, or read source code instead of the site is a **finding**. Write it in the report's "Quickstart deviations" table with the quickstart step id (`#install`, `#add-items`, `#add-inbox`, `#migration`, `#env`, `#account`, `#webhook`, `#doctor`, `#hola`) and the time it cost.

## Path A: own Meta app (required for launch)

The quickstart path, with your own Meta app:

- `.env.local` per quickstart `#env`: `SENDO_META_APP_SECRET`, `SENDO_VERIFY_TOKEN`, `SENDO_TOKEN_MAIN`, `SENDO_AGENT_MODEL`, `AI_GATEWAY_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (optionally `SENDO_META_APP_ID`).
- Register the test number with `npx sendo accounts add --phone-number-id <id> --token-env SENDO_TOKEN_MAIN`. The quickstart writes `npx @quami/sendo accounts add`, which is the same bin.
- In the Meta App Dashboard → WhatsApp → Configuration, set the Callback URL to `https://<app>/api/sendo/webhook` and the Verify token, then subscribe the `messages` field. For check 7, also subscribe `smb_message_echoes`.
- Run `npx sendo doctor --url https://<app>/api/sendo/webhook`. Every check must pass before you start the script.
- **For check 5 (Embedded Signup):** follow **https://sendo.dev/docs/embedded-signup**. It covers `npx shadcn add @sendo/numbers`, the Facebook Login for Business configuration id, `meta.appId` / `configId` and the `storeToken` hook. The quickstart doesn't cover this, so record what was missing.

## Path B: via Sendo Connect (after Meta approval)

Run it in a **second fresh app** (repeat Step 1). Reusing the Path A app hides setup gaps.

1. On **https://sendo.dev/en/pricing**, click **Start trial**. It must land on **https://app.sendo.dev**. Screenshot both pages.
2. Sign up with the email magic link and create a project.
3. Copy `SENDO_CONNECT_API_KEY` and `SENDO_CONNECT_SIGNING_SECRET` into the app's `.env.local`. The panel shows them **once**, so record whether that was clear.
4. In the panel, register the webhook URL: `https://<app>/api/sendo/webhook`. Don't configure a webhook in Meta for this path.
5. In `lib/sendo.ts`, remove `appSecret` and add `connect: { apiKey, signingSecret }`, following **https://sendo.dev/docs/sendo-connect**. Keep `SENDO_VERIFY_TOKEN`. Use Quami's `meta.appId` / `configId` from the panel for the connect button.
6. Run `npx sendo doctor --url https://<app>/api/sendo/webhook`. The `connect:key`, `connect:webhook` and `connect:delivery` checks must pass. `connect:delivery` warns until the first delivery, and that's fine.
7. Connect the first number **from the app's numbers screen** (`@sendo/numbers` → Embedded Signup with Quami's app), not from the panel. The token is stored by the app's `storeToken`. For the script's `template` and `billing` steps, also export it under the env var named in that number's `sendo_accounts.token_ref`; if you can't, the script falls back to asking you.
8. Check that the panel lists the number, its status and its billing status. Screenshot it.

If anything answers `EARLY_ACCESS`, Connect still has `CONNECT_EARLY_ACCESS=1`. Stop: Path B isn't ready.

## Running the script

From the clone of `quamidev/sendo` (no `pnpm install` needed for app mode):

```bash
node scripts/smoke-meta.mjs --app ~/sendo-smoke/smoke-app --out test-results/smoke-meta-path-a.json
# or, with the repo installed
pnpm smoke:meta --app ~/sendo-smoke/smoke-app --out test-results/smoke-meta-path-a.json

pnpm smoke:meta --app <dir> --only billing,coexistence   # re-run some steps
pnpm smoke:meta --app <dir> --timeout 300                # wait longer for each webhook-driven result
node scripts/smoke-meta.mjs --help                       # every option and env var
```

- `--app <dir>` (or `SENDO_SMOKE_APP`) loads the app's `node_modules/@quami/sendo`, its entry points (from the package's `exports` map) and its bin. It reads the app's `.env.local` and `.env` without overriding your shell. Relative paths resolve from the folder you ran the command in.
- **Path B is picked automatically** when `SENDO_CONNECT_API_KEY` or `SENDO_CONNECT_SIGNING_SECRET` is set. Then both are required and `SENDO_META_APP_SECRET` isn't. The report records `path: "A" | "B"`.
- Add the script-only variables to the app's `.env.local` (or your shell):

  ```bash
  SENDO_SMOKE_TO=+50255551234                          # the spare phone, E.164
  SENDO_SMOKE_WEBHOOK_URL=https://<app>/api/sendo/webhook
  SENDO_SMOKE_ACCOUNT=<phone_number_id>                # when more than one number is active
  SENDO_SMOKE_BILLING_ACCOUNT=<phone_number_id>        # optional; default: the number connected in check 5
  SENDO_SMOKE_COEXISTENCE_ACCOUNT=<phone_number_id>    # optional; default: a coexistence number in sendo_accounts
  ```

- Without `--app`, the script runs in **monorepo development mode** ([below](#monorepo-development-mode)). That mode doesn't count for AC-RM-1/2.

The script stops before touching Meta, with exit code 2, when something required is missing:

- the variables in `--help`
- the token variable named in `sendo_accounts.token_ref`
- a non-HTTPS webhook URL
- `@quami/sendo` not installed in the app, or an incomplete package
- stdin that isn't a terminal

Exit codes:

- `0`: all steps passed
- `1`: a step failed or was blocked
- `2`: setup or usage error
- `130`: interrupted (Ctrl+C still writes a partial report)

Each prompt waits for Enter, then polls the app's database for up to `--timeout` seconds. Some steps end with a question: answer `p` (pass), `f` (fail) or `b` (blocked), then add notes such as the screenshot file or the error code you saw.

### Steps and checks

| Step                | Check | You do                                                                                         |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `doctor`            | –     | nothing (runs the app's `sendo doctor --json --account <id> --url <webhook>`)                  |
| `template`          | 3     | confirm the template arrived                                                                   |
| `template-rejected` | 3     | judge whether the error is clear                                                               |
| `inbound-text`      | 1, 2  | send `hola`                                                                                    |
| `status-read`       | 2, 8  | open the chat on the phone                                                                     |
| `inbound-image`     | 4     | send a photo                                                                                   |
| `handoff`           | –     | send `I want to talk to a person`, then `hello again` (quickstart `#hola`: handoff and return) |
| `embedded-signup`   | 5     | connect the second number from the app's numbers screen                                        |
| `billing`           | 6     | nothing, or send from the inbox when the number's token isn't in the env                       |
| `coexistence`       | 7     | send from the WhatsApp Business app, then reply from the spare phone                           |

The script runs `template` before any inbound on purpose. A template only proves "outside the window" when the spare phone hasn't written to the number in the last 24 hours. The script records `windowOpenBeforeSend` and prints a note when the window was open.

## The eight checks

Record each one in the report, per path: result, timestamp, screenshots, raw Meta error codes (`code`, `subcode`, `fbtrace_id`), timings and quickstart deviations. The script's JSON has the ids, codes and timings for the steps it automates.

### 1. Receive

A "hola" from a real phone arrives through the webhook with a valid signature and appears in the inbox.

- **Pass:** `inbound-text` stores the text (`details.inbound`, `timings.inboundStoredMs`), and the message shows in the app's `/inbox`. A message is stored only after the signature check passes: Meta's `X-Hub-Signature-256` on Path A, the relay's `X-Sendo-Signature` on Path B.
- **Fail:** nothing stored within the timeout; a `401` in the app's terminal; a `sendo_events` row with status `unrouted` or `failed`.
- **Screenshot:** the phone chat and the inbox showing the message.
- **Likely failures:**
  - `401`, Path A: `SENDO_META_APP_SECRET` isn't the secret of the app that owns the webhook.
  - `401`, Path B: `SENDO_CONNECT_SIGNING_SECRET` is wrong, or the server clock is more than 5 minutes off.
  - `unrouted`: the `phone_number_id` isn't in `sendo_accounts`.
  - Nothing at all: the `messages` field isn't subscribed, the app isn't subscribed to the WABA (`POST /{waba_id}/subscribed_apps`), or a tunnel shows a browser interstitial.
  - Path B only: the panel's last delivery shows a non-2xx.

### 2. Free-form reply

The agent replies inside the 24-hour window and the status reaches _read_.

- **Pass:** `inbound-text` sees an agent reply (`timings.agentReplyMs`), and `status-read` sees the reply reach `read`.
- **Fail:** no reply within the timeout; the reply stuck at `sent` or `delivered`; the reply `failed` with a Meta error.
- **Screenshot:** the reply on the phone (blue ticks) and the inbox thread.
- **Likely failures:**
  - Wrong model id or key: the app logs the model error.
  - `131047`: the window is closed (re-engagement). A free-form reply needs an inbound in the last 24 hours.
  - `131026`: message undeliverable. The recipient isn't on WhatsApp or isn't an allowed test recipient.
  - `190`: the token expired. Temporary API Setup tokens last about 24 hours.
  - Never reaches `read`: read receipts are off in the phone's WhatsApp privacy settings.

### 3. Template

Outside the window, a message goes out only with an approved template, and a template that isn't approved fails with a clear error.

- **Pass:**
  - `template` syncs the templates, sends the approved one (default `hello_world` / `en_US`) and gets a `wamid`, and the phone receives it.
  - `template-rejected` sends `SENDO_SMOKE_BAD_TEMPLATE` (default `sendo_smoke_not_approved`). Meta rejects it with a code, and you judge the error clear enough to act on.
- **Fail:**
  - the approved template is missing after sync
  - Meta rejects the approved template
  - the rejected template is accepted
  - the error has no Meta code, or the message doesn't say what to do
- **Screenshot:** the template on the phone; the terminal line with the rejection.
- **Likely failures:**
  - `132001`: the template doesn't exist in that language (for example `en` vs `en_US`).
  - `132000`: the number of variables doesn't match (`SENDO_SMOKE_TEMPLATE_VARIABLES`).
  - `132015` / `132016`: the template is paused or disabled.
  - `131047` / `WindowClosedError`: a free-form send was attempted outside the window.
  - `windowOpenBeforeSend: true`: the template wasn't sent outside the window, so check 3 isn't proven. Re-run `--only template,template-rejected` 24 hours after the last message from the spare phone.

### 4. Media

A photo comes in, is downloaded from Meta and lands in the app's storage.

- **Pass:** `inbound-image` sees `download_status = done`, reads the stored file back (`details.storageFetch`), and the size matches `size_bytes`. The image shows in the inbox.
- **Fail:** `download_status` stays `pending` or ends `failed`; the stored URL returns a non-200; the sizes differ (recorded as a discrepancy).
- **Screenshot:** the photo in the inbox; the object in the Supabase Storage bucket.
- **Likely failures:**
  - The private `sendo-media` bucket is missing: the migration wasn't applied.
  - Meta's media URL has expired. It's short-lived, so a delayed download fails.
  - The token can't read the media id (`190`, or `10` for permissions).
  - Storage permissions.

### 5. Embedded Signup

Connecting a second number from the button works end to end.

- **Pass:**
  - `embedded-signup` sees a newly active row in `sendo_accounts`, with `onboarded_via = embedded_signup` on Path A or `connect` on Path B.
  - The numbers screen shows it as connected with no error, and you answer `p`.
  - On Path B, the panel lists the number too.
- **Fail:** the popup closes without a result; the numbers screen shows an error; no new row appears; `onboarded_via` is unexpected (recorded as a discrepancy).
- **Screenshot:** each popup screen; the numbers screen after connecting; on Path B, the panel's number list.
- **Likely failures:** errors carry the failed `step` and Meta's codes.
  - `SIGNUP_CODE_EXPIRED`: the code from the popup is short-lived, so a slow server exchange fails.
  - `META_PERMISSION_MISSING`: the app lacks `whatsapp_business_management` / `whatsapp_business_messaging`. On Path B, this means Meta's review isn't approved.
  - `PIN_CONFLICT`: the number has a two-step verification PIN.
  - `SIGNUP_FAILED` with a `step`.
  - Path B only: `NUMBER_IN_USE`, `EARLY_ACCESS`, `PROJECT_SUSPENDED`.
  - The configuration id or `featureType` is wrong. Coexistence uses `whatsapp_business_app_onboarding`, and Embedded Signup v2 is being deprecated, so check that v3 is configured.

### 6. Billing status

A newly connected number with no card on file reports `billingReady: false`, and sending fails with an error that explains why. **This is the riskiest check: it's the only path that can't be simulated honestly.**

- **Pass:**
  - `billing` reads `billingReady === false` for the number from check 5 (or `SENDO_SMOKE_BILLING_ACCOUNT`). It refreshes it from Meta when the number's token is in the env.
  - A template send from that number fails with Meta `131042`. If the token isn't in the env, you send from the inbox and confirm the error says there's no payment method.
- **Fail:**
  - `billingReady` is `true` or `null`
  - Meta accepts the send
  - a different error code
  - an error that doesn't explain the payment method
- **Screenshot:** the numbers screen showing the billing state; the inbox error; Business Settings → Payment methods for that WABA (empty). On Path B, also the panel's billing readiness.
- **Likely failures:**
  - The WABA inherits a payment method or credit line from the business, so it isn't really "no card".
  - The `primary_funding_id` field is renamed or needs another permission: see [Billing field check](#billing-field-check).
  - Meta lets some sends through without a payment method (for example free service conversations), so `131042` never comes back. Record exactly what Meta returned.

### 7. Coexistence

The number keeps working in the phone app while it's connected to the API.

- **Pass:**
  - `coexistence` sees the WhatsApp Business app message stored as an outbound echo (`sender_ref = business_app`), and the echo doesn't move `last_inbound_at`.
  - The reply from the spare phone is stored.
  - You confirm both messages also show in the WhatsApp Business app, with no logout or warning.
- **Fail:** no echo stored (`smb_message_echoes` not subscribed or not delivered); the phone app logs out or shows a warning; the echo moved the window (recorded as a discrepancy).
- **Screenshot:** the WhatsApp Business app chat; the same conversation in the inbox.
- **Likely failures:**
  - The number wasn't onboarded with the WhatsApp Business app option.
  - `smb_message_echoes` / `history` aren't subscribed. Path B: the relay doesn't forward them.
  - The app version or country isn't supported for coexistence.
  - Also do the [coexistence field checks](#coexistence-field-checks) below.

### 8. Delivery and read

Statuses arrive in order and never go backwards.

- **Pass:** `status-read` records `statusesSeen` (polled every second) moving only forward: `sent → delivered → read`. Statuses can be skipped, but never go backwards. `regressed` is `false`.
- **Fail:** a stored status goes backwards (the step fails and records a discrepancy), or never reaches `read`.
- **Also check webhook order:** Meta may deliver `read` before `delivered`, or send duplicates. Read the raw status webhooks for the message's `wamid` and record their order, so the report shows the package held its ground:

  ```sql
  select received_at, status, payload->'entry'->0->'changes'->0->'value'->'statuses' as statuses
  from sendo_events
  where payload::text like '%<wamid>%'
  order by received_at;
  ```

  Run it in the Supabase SQL editor, or with `psql` against the app's database.

- **Screenshot:** the query result; the message ticks on the phone.
- **Likely failures:** out-of-order webhooks (expected: the package ignores regressions); a status `failed` with an error after `delivered`; Path B: the relay reordering deliveries for one number.

## Coexistence field checks

These facts were checked against Meta's docs on Oct 9, 2026, but the live payloads still need confirmation (AC-CX-5). Record each item that differs as a finding.

1. **Webhook fields.** In App Dashboard → WhatsApp → Configuration, check that these fields exist and can be subscribed, with these exact names: `smb_message_echoes`, `history` and `smb_app_state_sync`.
2. **Embedded Signup extras.** Coexistence onboarding uses `extras: { featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" }`. The older `coexistence` value is deprecated. Embedded Signup v2 is being deprecated around Oct 15, 2026, so check that v3 (or later) is what Meta's docs and your app configuration offer.
3. **Echo payload.** After check 7, read the newest `sendo_events` row and record:
   - the `field` value and where the message object sits in the payload
   - the sender and recipient fields
   - whether a message id (`wamid`) is present
4. **History payload** (optional). On a fresh coexistence onboarding with history sharing, record the shape of the `history` change.

If no number could be onboarded through coexistence, do items 1 and 2 only, mark check 7 **blocked**, and add a finding that says "coexistence payloads not verified", so the gap stays visible.

## Billing field check

After the steps, the script calls `GET /{waba_id}?fields=primary_funding_id` for the main account and records the result under `fieldChecks.billing`:

| `result`  | Meaning                                                    | Do                                                                                                                                                                                   |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `present` | The field exists and has a value: a payment method is set. | Nothing.                                                                                                                                                                             |
| `absent`  | The request worked but the field is empty or missing.      | Check in Business Settings → Payment methods whether the WABA really has no payment method. If it does have one, file a finding: the field doesn't reflect it.                       |
| `error`   | Meta rejected the request (see `error`, `metaError`).      | Usually the field was renamed or needs another permission. Find the current equivalent in the Graph API reference for "WhatsApp Business Account", and file a finding with the name. |

## The JSON report

`--out` (default `test-results/smoke-meta.json` in the Sendo repo, git-ignored):

```jsonc
{
  "tool": "smoke-meta",
  "timestamp": "2026-10-20T15:04:05.000Z", // start of the run
  "finishedAt": "2026-10-20T15:32:40.000Z",
  "passed": false, // every step passed and the run was not interrupted
  "mode": "app", // or "monorepo"
  "path": "A", // or "B" (Connect)
  "appDir": "/Users/…/sendo-smoke/smoke-app",
  "packageDir": "/Users/…/smoke-app/node_modules/.pnpm/@quami+sendo@0.1.0…/node_modules/@quami/sendo",
  "packageVersion": "0.1.0",
  "graphApiVersion": "v26.0",
  "account": {
    "phoneNumberId": "…",
    "wabaId": "…",
    "displayPhone": "…",
    "onboardedVia": "manual",
    "coexistence": false,
  },
  "tester": "+*******1234", // only the last four digits
  "webhookUrl": "https://…/api/sendo/webhook",
  "agentModel": "openai/gpt-5-mini",
  "steps": [
    {
      "id": "billing",
      "checks": [6],
      "status": "pass", // "pass", "fail" or "blocked"
      "startedAt": "…",
      "durationMs": 8123,
      "metaIds": [],
      "metaError": {
        "status": 400,
        "code": 131042,
        "subcode": null,
        "fbtraceId": "…",
        "type": "OAuthException",
        "hint": "billing_not_ready",
        "details": "…",
      },
      "details": { "billingReady": false, "refreshed": true },
      "error": null,
    },
  ],
  "fieldChecks": {
    "billing": {
      "request": "GET /{waba_id}?fields=primary_funding_id",
      "status": 200,
      "result": "absent",
    },
  },
  "discrepancies": [
    {
      "step": "manual",
      "summary": "…",
      "expected": null,
      "observed": null,
      "link": "https://github.com/quamidev/sendo/issues/12",
    },
  ],
}
```

The whole report goes through the package's redaction utility (`redactLogValue`) before it's written. That removes:

- the values of every env var whose name contains `TOKEN`, `SECRET`, `KEY` or `PASSWORD`
- the account access tokens
- `Bearer` credentials and `access_token` parameters

Console output goes through `redactText` the same way. Check before you share a report anyway: `grep -c "EAA" <report>.json` should print `0`.

## Findings and issues

A finding is:

- any point where the quickstart didn't get you through
- anything Meta does that differs from what the package expects: a field name, a payload shape, a status order, an error code
- a step that only passed after a workaround

The script records some automatically:

- a failed read receipt
- a size mismatch on stored media
- a forced handoff
- a backwards status
- an unexpected `onboarded_via`
- an echo that moved the window
- an unclear template error
- an app linked to the Sendo repo instead of npm

At the end, it asks for the rest: a one-line summary and the issue link (empty if fixed in the same branch).

**Every failure and every finding becomes a GitHub issue**, linked from the report's "Findings → issues" table. Each issue has:

- the check number and path
- the expected and observed values
- the raw Meta error (`code`, `subcode`, `fbtrace_id`)
- the anonymized payload
- the package version and Graph API version

To fix one, change the package (parser, schema, mapping) or the docs. Add a fixture under `packages/sendo/test/fixtures/` with the real, anonymized payload and extend the integration suite. Then release a patch and re-run the affected steps with `--only`.

Anonymize phone numbers, names, `wa_id`s and media ids before you paste a payload into an issue or a fixture.

## Troubleshooting

- **`doctor` fails the webhook check.**
  - Path A: the URL doesn't end in `/api/sendo/webhook`, the tunnel is down, or `SENDO_VERIFY_TOKEN` differs between the app and the Meta dashboard. Restart the app after you edit `.env.local`.
  - Path B: see `connect:*` in [the Connect docs](https://sendo.dev/docs/sendo-connect).
- **No inbound message within the timeout.** Check that:
  - Meta shows the callback URL as verified (Path A), or the panel shows a recent delivery (Path B)
  - the `messages` field is subscribed
  - the app is subscribed to the WABA
  - the app's terminal shows the POST

  Tunnels with a browser interstitial (some ngrok plans) block Meta's requests.

- **`@quami/sendo is not installed in <dir>`.** `--app` must point at the app root (the folder with its `package.json` and `node_modules`).
- **"the app resolves @quami/sendo from this repository".** The app has a `link:` / `file:` dependency or a workspace override. Reinstall from npm; the run doesn't count otherwise.
- **The template step fails with "not on the WABA".** The template isn't approved for this WABA, or the language code differs (`en_US` vs `en`).
- **The agent doesn't reply.** `SENDO_AGENT_MODEL` or `AI_GATEWAY_API_KEY` is wrong. The app logs the model error.
- **A test number can't message your phone.** Add your phone as a recipient in API Setup and accept the verification code.

## Monorepo development mode

Without `--app`, the script runs against `packages/sendo/dist` and the playground (`apps/playground`), for checking package changes before a release. It doesn't count for AC-RM-1/2.

1. Install and build from the repo root: `pnpm install && pnpm build`.
2. Start local Supabase and load the schema:

   ```bash
   pnpm supabase start
   pnpm supabase db reset          # fresh schema + storage bucket
   pnpm supabase status -o env     # API_URL and SERVICE_ROLE_KEY for the next step
   ```

3. Create `apps/playground/.env.local`. The script and the playground both read it. Remove `SENDO_PLAYGROUND_MODE=fixtures` and `SENDO_PLAYGROUND_FAKE_META` if you copied them from `.env.example`, because the script refuses to start with them.

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   SENDO_STORAGE_BUCKET=sendo-media
   SENDO_META_APP_SECRET=...
   SENDO_VERIFY_TOKEN=...
   SENDO_META_APP_ID=...            # optional: lets doctor check the WABA subscription
   SENDO_TOKEN_SMOKE=...            # access token; the name must match sendo_accounts.token_ref
   SENDO_AGENT_MODEL=openai/gpt-5-mini
   AI_GATEWAY_API_KEY=...
   SENDO_SMOKE_TO=+50255551234
   SENDO_SMOKE_WEBHOOK_URL=https://<tunnel>/api/sendo/webhook
   SENDO_SMOKE_ACCOUNT=<phone_number_id>
   ```

4. Seed the dev user and register the number under the playground tenant:

   ```bash
   pnpm --filter playground seed
   cd apps/playground
   node ../../packages/sendo/dist/cli.js accounts add \
     --phone-number-id <phone_number_id> --token-env SENDO_TOKEN_SMOKE \
     --tenant-id 00000000-0000-4000-8000-00000000a001 --yes
   cd ../..
   ```

   The seed also creates the fake fixtures account, so `SENDO_SMOKE_ACCOUNT` is required to pick the real one.

5. Start the playground (`pnpm --filter playground dev`) and a tunnel (`cloudflared tunnel --url http://localhost:3000`). Point Meta's webhook at `<tunnel>/api/sendo/webhook`.
6. Run `pnpm smoke:meta`, or pass `--only` with the steps you need.

In this mode, the script reads `.env.local` and `.env` from the repo root and from `apps/playground`, runs `doctor` from the repo root, and fails with "packages/sendo/dist is missing" until you build.
