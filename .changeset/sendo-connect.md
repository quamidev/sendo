---
"@quami/sendo": minor
---

Sendo Connect, package side: use Quami's Meta app with configuration only.

- New `connect?: { apiKey, signingSecret, baseUrl? }` in `createSendo` (`baseUrl` defaults to `https://connect.sendo.dev`; `DEFAULT_CONNECT_BASE_URL`, `ConnectOptions`, `ConnectConfig` exported). Both secrets are redacted like tokens. With `connect`, `appSecret` is optional; `connect` with a non-meta-direct transport is a `ConfigError`.
- Webhooks: with `connect`, `handleWebhook` only accepts `X-Sendo-Signature: t=<unix>,v1=<hex hmac_sha256(signingSecret, t + "." + rawBody)>` (5-minute tolerance, constant-time, several `v1` allowed for rotation); Meta's `X-Hub-Signature-256` is not accepted. Fails closed with 401 and stores nothing. Without `connect` the Meta path is unchanged. New exports `CONNECT_SIGNATURE_HEADER`, `CONNECT_SIGNATURE_TOLERANCE_SEC`, `signConnectBody`, `verifyConnectSignature`.
- `completeEmbeddedSignup` with `connect` POSTs `{ code, wabaId, phoneNumberId, coexistence, pin }` to `{baseUrl}/v1/signup/complete` (Bearer `apiKey`), receives `{ token, displayPhone }` and continues from `storeToken` with the same compensation; accounts get `onboardedVia: "connect"`. `meta.appId` and the app secret are not needed. Connect's Meta errors keep the usual codes and steps; a rejected key is `CONFIG_ERROR`; other Connect failures are `SIGNUP_FAILED` with the new step `"connect"`. Sending still goes directly to Graph.
- `sendo doctor`: when `SENDO_CONNECT_API_KEY` / `SENDO_CONNECT_SIGNING_SECRET` are set it requires both (not `SENDO_META_APP_SECRET`) and adds `connect:key`, `connect:webhook` and `connect:delivery` (via `GET {baseUrl}/v1/projects/current/webhook`, `SENDO_CONNECT_BASE_URL` to override), each with a `fix`.

No schema change. Registry: `sendo-webhook` declares `SENDO_CONNECT_API_KEY` and `SENDO_CONNECT_SIGNING_SECRET` and ships the opt-in `connect` wiring commented in `lib/sendo.ts`.
