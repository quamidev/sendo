# webhook — notes for agents

The WhatsApp webhook route and the Sendo client config (`lib/sendo.ts`) every other Sendo item imports.
Installed by `npx shadcn add @sendo/webhook`. Needs the database from `@sendo/schema`.
Meta calls `GET /api/sendo/webhook` once to verify it and then `POST`s every message and status update to it.
With Sendo Connect (Quami's Meta app, opt-in) the Connect relay `POST`s them instead, signed with `X-Sendo-Signature`.

## Files

| File                             | What it is                                                                                                                                                                                                                                         | Edit it?                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `lib/sendo.ts`                   | `export const sendo = createSendo({ ... })`: Supabase adapter (service role), app secret, verify token, `resolveToken`, and the app hooks (`linkContact`, `resolveHandoffTargets`, commented `resolveRole`, Vault token store, `meta`, `connect`). | **Yes, it's yours.** Fill the TODO hooks, add agents with `sendo.agent({...})`.                |
| `app/api/sendo/webhook/route.ts` | `export const { GET, POST } = toNextHandlers(sendo)`, `runtime = "nodejs"`, `maxDuration = 60`.                                                                                                                                                    | Rarely: the path (keep it in sync with Meta), `maxDuration`. Don't add logic here (see below). |

Server only: `lib/sendo.ts` holds the service-role Supabase client. Never import it from a client component.

## Don't touch

These live in `@quami/sendo` on purpose, so they get security fixes with `npm update` instead of drifting in
copied code. Don't reimplement them in the route or in `lib/sendo.ts`:

- **Signature checks and parsing.** `toNextHandlers` verifies `X-Hub-Signature-256` against
  `SENDO_META_APP_SECRET` (or, with `connect`, only `X-Sendo-Signature` against
  `SENDO_CONNECT_SIGNING_SECRET`, 5-minute tolerance) before anything is stored, answers the verify challenge, dedupes by Meta id and
  returns `200` fast, doing the work in `after()`. Don't read the body yourself, don't wrap the handler
  in auth middleware (Meta can't log in) and don't return non-`200` for unknown payloads (Meta retries).
- **Status ordering, locks, retries and storage writes.** Everything goes through the adapter in the package.
- **Token handling.** Tokens are resolved per call by `resolveToken(account)` and never stored or logged.
  `token_ref` stores the env var name (or `vault:<id>`), never the token. Keep `resolveAccountToken` as a
  lookup; don't cache tokens anywhere persistent or put them in error messages.

## Connects to

- **Env vars:** `SENDO_META_APP_SECRET` (Meta app secret), `SENDO_VERIFY_TOKEN` (any random string, the same
  value in Meta's webhook settings), `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SENDO_STORAGE_BUCKET` (default `sendo-media`), one env var per number named by its `token_ref`
  (e.g. `SENDO_TOKEN_MAIN`), and `SENDO_AGENT_MODEL` if you enable the example agent.
- **Sendo Connect (optional):** `SENDO_CONNECT_API_KEY` and `SENDO_CONNECT_SIGNING_SECRET` from the Connect
  panel; delete the `appSecret` line and uncomment `connect` in `lib/sendo.ts`, set `meta.appId`/`configId`
  to Quami's values, and register `https://<your-domain>/api/sendo/webhook` in the Connect panel (not in Meta).
  Leave both vars empty when you use your own Meta app. Docs: https://sendo.dev/docs/sendo-connect.
- **Meta:** App Dashboard → WhatsApp → Configuration: Callback URL `https://<your-domain>/api/sendo/webhook`,
  Verify token = `SENDO_VERIFY_TOKEN`, subscribe the `messages` field (coexistence numbers also
  `smb_message_echoes`, `history`, `smb_app_state_sync`).
- **Numbers:** register each one with `npx @quami/sendo accounts add` (manual tokens) or connect them from the
  numbers screen (`@sendo/numbers`, Embedded Signup + Vault: uncomment `createVaultTokenStore` and `meta`).
- **Hooks in `createSendo`:** `linkContact` (contact → your entity id), `resolveHandoffTargets` /
  `resolveAssignees` (who gets a handed-off conversation), `resolveRole` (required by the inbox, numbers, rules,
  metrics and links screens; they fail closed without it), `resolveUsers` (names and avatars).
- **Other items** import `sendo` from `@/lib/sendo`: keep the export name and path.

## Verify

1. `npx @quami/sendo doctor --url https://<your-domain>/api/sendo/webhook`: every line `OK` (`--json` for
   machine-readable output; each failing check has a `fix`). With Connect env vars set it also checks the
   Connect key, the webhook URL registered in Connect and the relay's last delivery (`connect:*`).
2. Send a WhatsApp message to the number: a row appears in `sendo_events` (status `processed`) and the message
   in `sendo_messages`. A `401` in your logs means the app secret doesn't match the Meta app (with Connect:
   `SENDO_CONNECT_SIGNING_SECRET` doesn't match the Connect panel, or the server clock is off by > 5 minutes).
3. `tsc --noEmit` in the app: `lib/sendo.ts` must type-check against the installed `@quami/sendo`.
