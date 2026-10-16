# numbers — notes for agents

The numbers screen ("Numbers" / "Números"): connect WhatsApp numbers with Meta's Embedded Signup, label
them, choose the default, pause the AI agent, switch it to drafts, re-check the payment method, disconnect,
export a number's conversations and, when the app opts in, delete a disconnected number's history.
Installed by `npx shadcn add @sendo/numbers`. Needs `lib/sendo.ts` (`@sendo/webhook`) and the
Sendo schema (`@sendo/schema`). English and Spanish: the page passes the required `locale` prop from
`sendoLocale` in `lib/sendo-ui.ts` (default `"en"`).

## Files

| File                                                          | What it is                                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(protected)/inbox/numbers/page.tsx`                      | The screen (server component). Calls the `list` action, which calls `requireUser()` first; passes `locale={sendoLocale}` and `allowPurge`; `generateMetadata` reads `pageTitle`. |
| `app/(protected)/inbox/numbers/actions.ts`                    | Server actions `list`, `connect`, `setDefault`, `setLabel`, `pauseAgent`, `setAgentMode`, `refreshBilling`, `disconnect`, `purge`.                                               |
| `app/(protected)/inbox/numbers/export/[id]/route.ts`          | "Export conversations": `GET` route handler that streams `sendo.accounts.export` as a JSON download (admins only).                                                               |
| `app/(protected)/inbox/numbers/numbers-config.ts`             | `requireUser()` (**app-owned, implement it**; fails closed until you do), `numbersConfig` (incl. `allowPurge`), `embeddedSignupConfig()`.                                        |
| `components/sendo/numbers/numbers-screen.tsx`                 | Layout (rail, header, list, empty and no-access states) and client state. Props `locale`, `formatLocale`, `allowPurge`.                                                          |
| `components/sendo/numbers/number-row.tsx`                     | One number: label, badges, status with its fix, agent switch and mode, default, export, disconnect, delete history.                                                              |
| `components/sendo/numbers/connect-button.tsx`                 | "Connect WhatsApp": flavour choice, Embedded Signup, error toasts, PIN retry.                                                                                                    |
| `components/sendo/numbers/disconnect-dialog.tsx`              | Asks for the last 4 digits; says history stays and can be exported.                                                                                                              |
| `components/sendo/numbers/purge-dialog.tsx`                   | "Delete history": asks for the full number (digits compared).                                                                                                                    |
| `components/sendo/numbers/strings.ts`                         | `NumbersStrings`, `numbersStrings = { es, en }`, `resolveNumbersStrings(locale, overrides)`, `numbersFormat`. Server-safe.                                                       |
| `components/sendo/numbers/strings-context.tsx`                | Context `{ strings, locale, formatLocale }`; `useNumbersStrings()`, `useNumbersFormat()`.                                                                                        |
| `components/sendo/numbers/types.ts`                           | The view types shared by the screen and the actions (`NumberView`, `NumbersActions`, `NumbersLinks`).                                                                            |
| `lib/sendo-ui.ts`                                             | `SendoLocale` and `sendoLocale`, the language of every Sendo screen. Every UI item ships the same file. **Yours**: set it.                                                       |
| `lib/sendo-embedded-signup.ts`                                | Browser only: loads the Facebook JS SDK, `FB.login` with `sessionInfoVersion: "3"`, listens to `WA_EMBEDDED_SIGNUP` messages.                                                    |
| `lib/sendo-token-store.ts`                                    | Server only: `createVaultTokenStore(supabaseAdmin)` → `{ storeToken, deleteToken }` (Supabase Vault).                                                                            |
| `supabase/migrations/20261012000000_numbers_vault_tokens.sql` | `sendo_vault_store_token`, `sendo_vault_read_token`, `sendo_vault_delete_token` (security definer, service role only).                                                           |

## Connects to (setup)

1. `requireUser()` in `numbers-config.ts`: return `{ userId, tenantId }` of the signed-in user or redirect.
   With `inbox` installed: `export { requireUser } from "../inbox-config";`.
2. `resolveRole` in `createSendo` (`lib/sendo.ts`). `sendo.actor()` fails closed without it. Only `admin`
   has `numbers.manage` (connect, label, default, pause, mode, verify, disconnect).
3. Tokens. Embedded Signup returns a business token per number; `completeEmbeddedSignup` hands it to the
   `storeToken` hook and stores only the returned `tokenRef`.
   - **Supabase Vault (multi-tenant, default):** apply the migration above (Vault is enabled on every
     Supabase project; the migration runs `create extension if not exists supabase_vault`), then in
     `lib/sendo.ts` uncomment `import { createVaultTokenStore } from "@/lib/sendo-token-store"`,
     `...createVaultTokenStore(supabaseAdmin)` and `meta: { appId, configId }`. Refs look like
     `vault:<secret id>`; `resolveToken` in `lib/sendo.ts` reads them from Vault (cached 60 s in memory)
     and keeps reading `process.env[tokenRef]` for every other ref.
   - **Env vars only (single-tenant apps):** skip Vault and Embedded Signup. Put a permanent system-user
     token in an env var (e.g. `SENDO_TOKEN_MAIN`) and register the number with
     `npx @quami/sendo accounts add --phone-number-id <id> --token-env SENDO_TOKEN_MAIN`. Leave
     `NEXT_PUBLIC_SENDO_META_*` unset: the screen still lists, labels, pauses and disconnects, and the
     connect button stays disabled with a hint. You can also write your own `storeToken` for another
     secret manager; `deleteToken` must ignore refs it did not create (see below).
4. Env: `NEXT_PUBLIC_SENDO_META_APP_ID`, `NEXT_PUBLIC_SENDO_META_CONFIG_ID` (browser) and
   `SENDO_META_CONFIG_ID` (server `meta.configId`), plus `SENDO_META_APP_SECRET` from `webhook`.
5. Meta app: Facebook Login for Business with a WhatsApp Embedded Signup configuration (v3 or later;
   v2 is being retired), your HTTPS domain in "Allowed domains for the JavaScript SDK" and "Valid OAuth
   redirect URIs", business verification, app review for `whatsapp_business_management` and
   `whatsapp_business_messaging`, and Tech Provider terms. Until app review passes, connecting fails
   with `signupPermissionMissing` and a link to `numbersConfig.links.metaRequirements`. For coexistence numbers also
   subscribe the webhook fields `smb_message_echoes`, `history` and `smb_app_state_sync`.
6. Mount `<Toaster />` (`components/ui/sonner`) in the root layout.
7. Language: `sendoLocale` in `lib/sendo-ui.ts` (`"en"` or `"es"`) is the required `locale` of `<NumbersScreen>`;
   pass `formatLocale` (e.g. `"es-GT"`) for regional number formatting. Override single texts with
   `strings={{ ... }}`. To add a language, extend `SendoLocale` and follow the type errors (`numbersStrings`).
   Docs: `/docs/languages`.
8. Retention: `numbersConfig.allowPurge` (default `false`). Keeping or deleting a number's history is **your**
   decision (and often a legal duty, e.g. medical records); Sendo never deletes on disconnect. Docs:
   `/docs/retention`.

## How it works

- **Connect:** the button preloads the SDK, then on click opens a choice: "A new number" or "The number
  you already use on your phone" (coexistence, `featureType: "whatsapp_business_app_onboarding"`).
  `FB.login` runs synchronously inside the click (popup blockers). The code (from the login callback)
  and `waba_id`/`phone_number_id` (from the `WA_EMBEDDED_SIGNUP` message, only accepted from
  `https://*.facebook.com`) go to `connect`, which calls `sendo.accounts.completeEmbeddedSignup`.
- **Errors → strings:** cancel (`signupCancelled`, nothing created), Meta error, `SIGNUP_CODE_EXPIRED`
  (`signupCodeExpired`), `META_PERMISSION_MISSING` (toast with `signupPermissionDocs`), `ACCOUNT_EXISTS`
  (`signupAccountExists`), `ALREADY_CONNECTED` (same tenant), `CONFIG_ERROR`, anything else `signupFailed`.
  Compensation (no half-connected row, `deleteToken`) happens in the package.
- **PIN conflict:** the number has two-step verification. The code is already spent at that point, so the
  dialog asks for the 6-digit PIN and opens Meta again; the second code goes to `connect` with `pin`.
- **Reconnect** (invalid token or disconnected): the row's "Reconnect" runs Embedded Signup with
  `reconnectId`. The server checks Meta returned the same `phone_number_id` (`WRONG_NUMBER` otherwise),
  disconnects it if still active (the package refuses to sign up an active number), then signs it up
  again: same account id and history, new `tokenRef`, default restored. If Meta fails after that, the
  number stays disconnected and the screen reloads the list.
- **Disconnect:** the dialog asks for the last 4 digits (checked again on the server), then
  `sendo.accounts.disconnect`: history stays readable, replies stop, the only remaining number becomes
  the default, and `deleteToken(tokenRef)` runs. Disconnect never deletes anything; the dialog says the
  history stays and that an admin can export it.
- **Export conversations** (admins, every number): a plain `<a download>` link to
  `numbersConfig.links.export` (`/inbox/numbers/export/{id}`), so the browser shows its own download
  progress. The route handler calls `requireUser()`, resolves the actor and calls
  `sendo.accounts.export(id, { actor })`: no `numbers.manage` → **403, no body**; unknown id or another
  tenant's number → **404**; otherwise it streams the `SendoExportDocumentV1` JSON with
  `Content-Disposition: attachment; filename="sendo-export-<digits>-<date>.json"` (`exportFileName`).
- **Delete history** (`allowPurge`, off by default): only on disconnected numbers, for admins. The dialog
  asks for the full number (digits compared, so `+`, spaces and dashes don't matter), then the `purge`
  action checks `numbersConfig.allowPurge`, `numbers.manage`, the tenant, that the number is disconnected
  and the digits again, and calls `sendo.accounts.purge` (contacts, conversations, messages, media rows and
  files). No undo. The row leaves the list.
- **Statuses:** Disconnected (`active = false`) › Invalid token · reconnect › Connected · payment method
  missing (`billingReady = false`, link to the WABA in Meta Business Settings plus "I added it, check
  again" → `refreshBilling`) › Connected · payment status unknown (`null`) › Connected.

## Invalid token: how it is detected and persisted

There is no column for it. **The screen re-checks every connected number when it loads**
(`numbersConfig.checkTokensOnLoad`, default `true`): `list` calls `sendo.accounts.refreshBilling(id)`
for each active number in parallel while listening to `sendo.on("account.error")`. `refreshBilling`
calls Meta with the number's token; Meta error 190 makes the package emit `account.error`, and those
numbers are marked `tokenInvalid` in the response. Nothing extra is stored: the state is Meta's answer
at load time, so it clears by itself after a reconnect (new `tokenRef`) or a token rotation.

- Side effects: one Graph call per connected number per page load, and `billingReady` /
  `billingCheckedAt` are refreshed (the same as "I added it, check again"). Numbers slower than
  `numbersConfig.tokenCheckTimeoutMs` (6 s) keep their stored state for that load.
- "I added it, check again" re-checks the token too. Other actions keep the mark from the last check.
- A token missing from the env var or Vault is logged by the package and does not show as invalid.
- Turn it off with `checkTokensOnLoad: false` if Graph calls on page load are a problem; then the screen
  shows billing only and "Invalid token" never appears. To show it without re-checking, persist
  `account.error` yourself (e.g. a `sendo.on("account.error")` handler in `lib/sendo.ts` writing to your
  own table) and set `tokenInvalid` in `list`.

## Don't touch (and why)

- **Every exported action calls `requireUser()` first**, then `sendo.actor()`; mutations call
  `assertCan(actor, "numbers.manage")`. Numbers of other tenants look like unknown ids. A registry test
  checks the guard; keep it when adding actions. The export route handler has the same guard (the same
  test covers route handlers under `app/(protected)/`).
- **Tokens never reach the browser.** Views (`NumberView`) carry no `tokenRef`. `deleteToken` is called
  by `disconnect` with every ref, including env var names of manual numbers: the Vault store ignores refs
  that don't start with `vault:` and throws for malformed `vault:` refs (the package logs it).
- `numbersConfig.numbersVisibleToNonAdmins` (default `true`): non-admins get a read-only list; `false`
  shows `hidden` ("Only admins can see the numbers.").
- `numbersConfig.allowPurge` (default `false`) is read by the page (`allowPurge` prop) **and** by the `purge`
  action: turning it on in one place only is not enough to delete, and leaving the prop on with the config
  off still refuses on the server.
- `numbersConfig.links`: `inbox` (rail and mobile back link), `metaBilling` (`{wabaId}` replaced),
  `metaRequirements` (missing-permission toast), `export` (`{id}` replaced; keep it pointing at the route).
- `embeddedSignupConfig()` returns `null` until both public env vars exist; it can also set `coexistence:
false` (no flavour choice), `sdkUrl` (self-hosted or fake SDK) and `trustedOrigins` (fakes/tests only).
- Strings: every text is in `NumbersStrings` (`strings.ts`, one object per `SendoLocale`); pass
  `strings={{ ... }}` to `<NumbersScreen>` to override single keys on top of `locale`.
- Motion: see `MOTION.md` (transform/opacity only, `--sendo-*` tokens with fallbacks, reduced motion keeps
  the fades).

## Verify

1. Before implementing `requireUser()`, `/inbox/numbers` throws (fails closed). As an admin the list shows
   every number with its status; other roles get the read-only list (or nothing, see
   `numbersVisibleToNonAdmins`).
2. "Connect WhatsApp" opens Meta's Embedded Signup once the public env vars are set (disabled with a hint
   before). After connecting, `npx @quami/sendo doctor` shows the new number's checks, including billing.
3. Disconnect asks for the last 4 digits; the number stays listed as "Disconnected" and its history stays readable.
4. "Export conversations" downloads `sendo-export-<digits>-<date>.json`; as a non-admin,
   `curl -i /inbox/numbers/export/<id>` (with the session cookie) answers 403 with an empty body.
5. With `allowPurge: true`, a disconnected number shows "Delete history"; typing anything but the full number
   keeps the button disabled or shows `purgeMismatch`.
6. With `sendoLocale = "es"` every label is Spanish; with `"en"`, English (labels and phones stay as stored).
