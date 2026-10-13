# numbers — notes for agents

The "Números" screen: connect WhatsApp numbers with Meta's Embedded Signup, label them, choose the
default, pause the AI agent, switch it to drafts, re-check the payment method and disconnect.
Installed by `npx shadcn add @sendo/numbers`. Needs `lib/sendo.ts` (`@sendo/webhook`) and the
Sendo schema (`@sendo/schema`).

## Files

| File                                                          | What it is                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `app/(protected)/inbox/numbers/page.tsx`                      | The screen (server component). Calls the `list` action, which calls `requireUser()` first.                                    |
| `app/(protected)/inbox/numbers/actions.ts`                    | Server actions `list`, `connect`, `setDefault`, `setLabel`, `pauseAgent`, `setAgentMode`, `refreshBilling`, `disconnect`.     |
| `app/(protected)/inbox/numbers/numbers-config.ts`             | `requireUser()` (**app-owned, implement it**; fails closed until you do), `numbersConfig`, `embeddedSignupConfig()`.          |
| `components/sendo/numbers/numbers-screen.tsx`                 | Layout (rail, header, list, empty and no-access states) and client state.                                                     |
| `components/sendo/numbers/number-row.tsx`                     | One number: label, badges, status with its fix, agent switch and mode, default, disconnect.                                   |
| `components/sendo/numbers/connect-button.tsx`                 | "Conectar WhatsApp": flavour choice, Embedded Signup, error toasts, PIN retry.                                                |
| `components/sendo/numbers/disconnect-dialog.tsx`              | Asks for the last 4 digits.                                                                                                   |
| `components/sendo/numbers/{strings.tsx,types.ts}`             | `NumbersStrings` (Spanish defaults) and the view types shared by the screen and the actions.                                  |
| `lib/sendo-embedded-signup.ts`                                | Browser only: loads the Facebook JS SDK, `FB.login` with `sessionInfoVersion: "3"`, listens to `WA_EMBEDDED_SIGNUP` messages. |
| `lib/sendo-token-store.ts`                                    | Server only: `createVaultTokenStore(supabaseAdmin)` → `{ storeToken, deleteToken }` (Supabase Vault).                         |
| `supabase/migrations/20261012000000_numbers_vault_tokens.sql` | `sendo_vault_store_token`, `sendo_vault_read_token`, `sendo_vault_delete_token` (security definer, service role only).        |

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
   with "permisos" and a link to `numbersConfig.links.metaRequirements`. For coexistence numbers also
   subscribe the webhook fields `smb_message_echoes`, `history` and `smb_app_state_sync`.
6. Mount `<Toaster />` (`components/ui/sonner`) in the root layout.

## How it works

- **Connect:** the button preloads the SDK, then on click opens a choice: "Un número nuevo" or "El número
  que ya usas en el teléfono" (coexistence, `featureType: "whatsapp_business_app_onboarding"`).
  `FB.login` runs synchronously inside the click (popup blockers). The code (from the login callback)
  and `waba_id`/`phone_number_id` (from the `WA_EMBEDDED_SIGNUP` message, only accepted from
  `https://*.facebook.com`) go to `connect`, which calls `sendo.accounts.completeEmbeddedSignup`.
- **Errors → strings:** cancel (neutral toast, nothing created), Meta error, `SIGNUP_CODE_EXPIRED`
  ("El enlace con Meta expiró…"), `META_PERMISSION_MISSING` (toast with "Ver requisitos"),
  `ACCOUNT_EXISTS` ("Este número ya está conectado en otra organización"), `ALREADY_CONNECTED` (same
  tenant), `CONFIG_ERROR`, anything else "No se pudo conectar…". Compensation (no half-connected row,
  `deleteToken`) happens in the package.
- **PIN conflict:** the number has two-step verification. The code is already spent at that point, so the
  dialog asks for the 6-digit PIN and opens Meta again; the second code goes to `connect` with `pin`.
- **Reconnect** (invalid token or disconnected): the row's "Reconectar" runs Embedded Signup with
  `reconnectId`. The server checks Meta returned the same `phone_number_id` (`WRONG_NUMBER` otherwise),
  disconnects it if still active (the package refuses to sign up an active number), then signs it up
  again: same account id and history, new `tokenRef`, default restored. If Meta fails after that, the
  number stays disconnected and the screen reloads the list.
- **Disconnect:** the dialog asks for the last 4 digits (checked again on the server), then
  `sendo.accounts.disconnect`: history stays readable, replies stop, the only remaining number becomes
  the default, and `deleteToken(tokenRef)` runs.
- **Statuses:** Desconectado (`active = false`) › Token inválido · reconectar › Conectado · falta método
  de pago (`billingReady = false`, link to the WABA in Meta Business Settings plus "Ya lo agregué,
  verificar" → `refreshBilling`) › Conectado · estado de pago desconocido (`null`) › Conectado.

## Invalid token: how it is detected and persisted

There is no column for it. **The screen re-checks every connected number when it loads**
(`numbersConfig.checkTokensOnLoad`, default `true`): `list` calls `sendo.accounts.refreshBilling(id)`
for each active number in parallel while listening to `sendo.on("account.error")`. `refreshBilling`
calls Meta with the number's token; Meta error 190 makes the package emit `account.error`, and those
numbers are marked `tokenInvalid` in the response. Nothing extra is stored: the state is Meta's answer
at load time, so it clears by itself after a reconnect (new `tokenRef`) or a token rotation.

- Side effects: one Graph call per connected number per page load, and `billingReady` /
  `billingCheckedAt` are refreshed (the same as "Ya lo agregué, verificar"). Numbers slower than
  `numbersConfig.tokenCheckTimeoutMs` (6 s) keep their stored state for that load.
- "Ya lo agregué, verificar" re-checks the token too. Other actions keep the mark from the last check.
- A token missing from the env var or Vault is logged by the package and does not show as invalid.
- Turn it off with `checkTokensOnLoad: false` if Graph calls on page load are a problem; then the screen
  shows billing only and "Token inválido" never appears. To show it without re-checking, persist
  `account.error` yourself (e.g. a `sendo.on("account.error")` handler in `lib/sendo.ts` writing to your
  own table) and set `tokenInvalid` in `list`.

## Don't touch (and why)

- **Every exported action calls `requireUser()` first**, then `sendo.actor()`; mutations call
  `assertCan(actor, "numbers.manage")`. Numbers of other tenants look like unknown ids. A registry test
  checks the guard; keep it when adding actions.
- **Tokens never reach the browser.** Views (`NumberView`) carry no `tokenRef`. `deleteToken` is called
  by `disconnect` with every ref, including env var names of manual numbers: the Vault store ignores refs
  that don't start with `vault:` and throws for malformed `vault:` refs (the package logs it).
- `numbersConfig.numbersVisibleToNonAdmins` (default `true`): non-admins get a read-only list; `false`
  shows "Solo los administradores pueden ver los números."
- `numbersConfig.links`: `inbox` (rail and mobile back link), `metaBilling` (`{wabaId}` replaced),
  `metaRequirements` (missing-permission toast).
- `embeddedSignupConfig()` returns `null` until both public env vars exist; it can also set `coexistence:
false` (no flavour choice), `sdkUrl` (self-hosted or fake SDK) and `trustedOrigins` (fakes/tests only).
- Strings: every text is in `NumbersStrings` (`strings.tsx`); pass `strings={{ ... }}` to `<NumbersScreen>`.
- Motion: see `MOTION.md` (transform/opacity only, `--sendo-*` tokens with fallbacks, reduced motion keeps
  the fades).

## Verify

1. Before implementing `requireUser()`, `/inbox/numbers` throws (fails closed). As an admin the list shows
   every number with its status; other roles get the read-only list (or nothing, see
   `numbersVisibleToNonAdmins`).
2. "Conectar WhatsApp" opens Meta's Embedded Signup once the public env vars are set (disabled with a hint
   before). After connecting, `npx @quami/sendo doctor` shows the new number's checks, including billing.
3. Disconnect asks for the last 4 digits; the number stays listed as "Desconectado" and its history stays readable.
