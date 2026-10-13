---
"@quami/sendo": minor
---

Send as an organization and manage numbers from code and the CLI.

- `sendo.send.*`, `sendo.templates.sync` and `sendo.templates.list` accept `{ tenant }` next to `{ account }`. A tenant resolves to its default active number, else its only active number. `AmbiguousAccountError` lists only that tenant's candidates and carries `tenantId`; `AccountNotFoundError` carries `tenantId` too.
- New `sendo.accounts`: `list`, `get`, `add`, `setDefault` (atomic swap, one default per tenant), `setLabel`, `pauseAgent`, `setAgentMode`, `disconnect` (keeps the data, promotes the tenant's only remaining number, calls `deleteToken`, unsubscribes Embedded Signup numbers from the WABA) and `purge` (deletes a disconnected account, its data and its media objects). `refreshBilling` and `completeEmbeddedSignup` are declared and land in a later release.
- New config keys `storeToken`, `deleteToken`, `meta` and `coexistence`, and new events `account.default`, `account.disconnected` and `account.billing`.
- New `AccountStateError` (`ACCOUNT_STATE`).
- CLI: `sendo accounts list [--tenant-id] [--json]`, `sendo accounts set-default <id>` and `sendo accounts disconnect <id>`.
- `SendoAdapter` gains `accounts.setDefault`, `accounts.update`, `accounts.reactivate`, `accounts.purge` and `storage.remove`. Custom adapters must implement them and pass the contract suite.

No schema change: schema v1 already has the columns and the `sendo_set_default_account` function.
