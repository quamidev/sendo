---
"@quami/sendo": minor
---

The package now carries the whole Sendo Connect service contract.

- `signConnectBody(rawBody, secret, timestamp?)` accepts one secret or a list (`[old, new]`) and adds one `v1=` per secret, in order, for signing secret rotation; `verifyConnectSignature` already accepts a header when any `v1` matches. A blank secret or an empty list now throws `TypeError`.
- The main entry exports the Connect client and its contract: `createConnectClient`, `ConnectClient`, `ConnectClientOptions`, `ConnectRequestError`, `ConnectSignupRequest`, `ConnectSignupResult`, `ConnectWebhookStatus`, `CONNECT_SIGNUP_STEPS`, `ConnectSignupStep`, and the new `CONNECT_ERROR_CODES` / `ConnectErrorCode` and `CONNECT_TEST_EVENT_OBJECT` (`"sendo_test"`).
- New `ConnectClient.disconnectNumber(phoneNumberId)` (`POST /v1/numbers/{phoneNumberId}/disconnect`) and `ConnectRequestError.isProjectSuspended`. A `403 PROJECT_SUSPENDED` is no longer reported as a rejected API key.
- `sendo.accounts.disconnect` and `sendo accounts disconnect` notify Connect when a number with `onboardedVia: "connect"` is disconnected and `connect` (or `SENDO_CONNECT_API_KEY` for the CLI) is configured. It's best effort: a failure is a redacted warning and the number is still disconnected.
- With `connect`, `sendo.handleWebhook` answers a relay-signed `{"object":"sendo_test"}` (the panel's "Send test event") with 200 and `Cache-Control: no-store`, storing and emitting nothing. Unsigned or badly signed requests are still 401.
- `sendo doctor` reports a `403 PROJECT_SUSPENDED` on `connect:key` as "Connect project suspended — update payment at app.sendo.dev", with a `billing` fix.
