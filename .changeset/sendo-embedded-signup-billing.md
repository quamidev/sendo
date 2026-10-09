---
"@quami/sendo": minor
---

Embedded Signup and billing state.

- `sendo.accounts.completeEmbeddedSignup({ code, tenantId, wabaId, phoneNumberId, coexistence?, pin?, label? })` exchanges the code, subscribes the app to the WABA, registers the number (skipped for coexistence; the PIN is never stored), stores the token through `storeToken`, inserts or reconnects the account (`onboardedVia: "embedded_signup"`), makes it the tenant's default when it is the first, and checks billing. A failure after `storeToken` calls `deleteToken`, unsubscribes the app (best effort) and leaves no row. Needs `storeToken`, `meta.appId` and the app secret (`ConfigError` otherwise).
- New `EmbeddedSignupError` with codes `SIGNUP_CODE_EXPIRED`, `META_PERMISSION_MISSING`, `PIN_CONFLICT` and `SIGNUP_FAILED` (plus `step`, `metaCode`, `subcode`, `fbtraceId`, `details`). A number connected elsewhere is `DuplicateAccountError` (`ACCOUNT_EXISTS`), raised before the code is spent.
- `sendo.accounts.refreshBilling(id)` reads the WABA funding field (`primary_funding_id`): present → `billingReady: true`, absent → `false`, Meta error → unchanged. It always sets `billingCheckedAt` and emits `account.billing` on change. `readWabaBillingReady`, `billingReadyFromWaba` and `WABA_FUNDING_FIELD` are exported.
- `MetaApiError` gains `hint`: `billing_not_ready` (131042), `token_invalid` (190), `window_closed` (131047), `rate_limited` or `null`. A send failing with 131042 sets `billingReady = false` and emits `account.billing`; sends are still attempted when `billingReady` is `false`.
- `GraphClient` gains `exchangeCode`, `subscribeApp`, `registerPhone` and `getWaba`.
- `sendo doctor` adds `account:<id>:billing`, a warning (`warning: true`, shown as `AVISO`) with a `billing` fix when the value is `false` or unknown. Warnings don't change the exit code.

No schema change.
