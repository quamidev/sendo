# @quami/sendo

## 0.1.0

### Minor Changes

- 7f6d24d: First public release of `@quami/sendo` (0.1.0), MIT licensed and published with public access.

  The package was previously developed under a different name. Apps that used the earlier copy need these changes:

  - Install `@quami/sendo` and import from `@quami/sendo` and its subpaths (`/adapters/memory`, `/adapters/supabase`, `/adapters/contract`, `/next`). The CLI is `npx @quami/sendo doctor`.
  - Rename environment variables to the `SENDO_*` names. The app secret is `SENDO_META_APP_SECRET`.
  - Re-install the registry items from the `@sendo` namespace: `npx shadcn add @sendo/webhook @sendo/schema @sendo/inbox`. The items dropped their `sendo-` prefix (`sendo-inbox` is now `inbox`); the files they copy keep their paths (`components/sendo/…`, `lib/sendo.ts`), and the old names keep resolving on registry.sendo.dev until `0.2.0`.

  **Migration:** copy `20261010000000_sendo_v1.sql` from the `@sendo/schema` registry item into `supabase/migrations/` and run it (`supabase db push`, or `supabase db reset` locally). It creates the `sendo_*` tables (multichannel and team columns included), RLS policies and hooks (`sendo_can_access_internal`, `sendo_can_access_conversation`), functions (including the `sendo_set_default_account` RPC) and the private `sendo-media` storage bucket, at schema version 1. Then run `npx @quami/sendo doctor` to confirm the schema version.

- 72c1e61: Send as an organization and manage numbers from code and the CLI.

  - `sendo.send.*`, `sendo.templates.sync` and `sendo.templates.list` accept `{ tenant }` next to `{ account }`. A tenant resolves to its default active number, else its only active number. `AmbiguousAccountError` lists only that tenant's candidates and carries `tenantId`; `AccountNotFoundError` carries `tenantId` too.
  - New `sendo.accounts`: `list`, `get`, `add`, `setDefault` (atomic swap, one default per tenant), `setLabel`, `pauseAgent`, `setAgentMode`, `disconnect` (keeps the data, promotes the tenant's only remaining number, calls `deleteToken`, unsubscribes Embedded Signup numbers from the WABA) and `purge` (deletes a disconnected account, its data and its media objects). `refreshBilling` and `completeEmbeddedSignup` are declared and land in a later release.
  - New config keys `storeToken`, `deleteToken`, `meta` and `coexistence`, and new events `account.default`, `account.disconnected` and `account.billing`.
  - New `AccountStateError` (`ACCOUNT_STATE`).
  - CLI: `sendo accounts list [--tenant-id] [--json]`, `sendo accounts set-default <id>` and `sendo accounts disconnect <id>`.
  - `SendoAdapter` gains `accounts.setDefault`, `accounts.update`, `accounts.reactivate`, `accounts.purge` and `storage.remove`. Custom adapters must implement them and pass the contract suite.

  No schema change: schema v1 already has the columns and the `sendo_set_default_account` function.

- 72c1e61: Agents per tenant, agent pause and WhatsApp Business app coexistence.

  - `AgentDefinition` gains `tenants?` (tenant ids, `null` for no tenant, or `(tenantId) => boolean`), ANDed with `accounts`, so one definition serves many organizations; the registration overlap check considers both lists. `mode?: "auto" | "draft"` is declared (draft behaviour lands with the team inbox).
  - No agent turn runs while the number (`accounts.pauseAgent`) or the conversation is paused, or while a rule holds the agent. Checked when the conversation lock is taken, so a running turn finishes. Inbound messages are still stored and still bump unread and the window.
  - The webhook parser handles `smb_message_echoes` (`ParsedEcho`, `kind: "echo"`) and `history` (`ParsedHistory`, `kind: "history"`); new `parseChanges(body)` returns every handled change (`parseWebhook` still returns only `messages` changes).
  - Echoes are stored as sent outbound messages (`sender: "human"`, `senderRef` and `metadata.origin` `"business_app"`), deduplicated by Meta id, update activity but never the 24-hour window, and pause the agent on `agent` conversations (`coexistence.pauseAgentOnPhoneReply`, default true) with a `conversation.agent_paused` event by `"business_app"`.
  - With `coexistence.importHistory`, `history` messages are stored with `metadata.imported = true` and never trigger the agent; otherwise they are acknowledged and ignored.

  Subscribe your Meta app to the `smb_message_echoes`, `history` and `smb_app_state_sync` webhook fields for coexistence numbers. No schema change.

- 72c1e61: Broadcasts and marketing opt-in.

  - `sendo.broadcasts.preview/create/get/list/recipients/cancel({ actor })` (needs `broadcasts.manage`): send one APPROVED template to many contacts. MARKETING templates go only to contacts with `marketingOptIn = true`; UTILITY and AUTHENTICATION templates go to every contact who hasn't explicitly opted out. Ineligible recipients are stored `skipped` with `no_opt_in` / `opted_out` / `invalid_phone`; phones become contacts. `ratePerMinute` defaults to 60.
  - `sendo.maintenance.tick()` now sends broadcasts: up to `ratePerMinute` recipients per broadcast and tick, with `metadata.broadcastId` on the stored message. Status webhooks move recipients forward (sent → delivered → read, or failed with Meta's error). Meta 131042 pauses the broadcast (`pauseReason: "billing"`) and marks the number `billingReady = false`; the tick resumes it once `billingReady` is true. A rate limit (130429) stops the pass and leaves recipients `pending`. Broadcast messages never move a conversation to `human` or run the agent.
  - `sendo.contacts.setOptIn(contactId, optIn, { source? })` records an explicit decision and emits the new `contact.opt_in` event.
  - Inbound opt-out keywords (`optOut: { keywords?, confirmation? }`, default `BAJA`, `STOP`, `ALTO`, `CANCELAR`): an exact match after trimming and ignoring case and accents opts the contact out, emits `contact.opt_in`, sends the confirmation inside the 24-hour window and skips rules and the agent turn.
  - Adapter: `contacts.getByPhone(accountId, phone)`, `contacts.setOptIn(id, { marketingOptIn, optInAt })` and `broadcasts.listRecipients({ broadcastId, status?, cursor?, limit })`. Custom adapters must implement them (covered by `runAdapterContract`).

  No schema change (uses the v3 tables).

- 20d1fa7: The package now carries the whole Sendo Connect service contract.

  - `signConnectBody(rawBody, secret, timestamp?)` accepts one secret or a list (`[old, new]`) and adds one `v1=` per secret, in order, for signing secret rotation; `verifyConnectSignature` already accepts a header when any `v1` matches. A blank secret or an empty list now throws `TypeError`.
  - The main entry exports the Connect client and its contract: `createConnectClient`, `ConnectClient`, `ConnectClientOptions`, `ConnectRequestError`, `ConnectSignupRequest`, `ConnectSignupResult`, `ConnectWebhookStatus`, `CONNECT_SIGNUP_STEPS`, `ConnectSignupStep`, and the new `CONNECT_ERROR_CODES` / `ConnectErrorCode` and `CONNECT_TEST_EVENT_OBJECT` (`"sendo_test"`).
  - New `ConnectClient.disconnectNumber(phoneNumberId)` (`POST /v1/numbers/{phoneNumberId}/disconnect`) and `ConnectRequestError.isProjectSuspended`. A `403 PROJECT_SUSPENDED` is no longer reported as a rejected API key.
  - `sendo.accounts.disconnect` and `sendo accounts disconnect` notify Connect when a number with `onboardedVia: "connect"` is disconnected and `connect` (or `SENDO_CONNECT_API_KEY` for the CLI) is configured. It's best effort: a failure is a redacted warning and the number is still disconnected.
  - With `connect`, `sendo.handleWebhook` answers a relay-signed `{"object":"sendo_test"}` (the panel's "Send test event") with 200 and `Cache-Control: no-store`, storing and emitting nothing. Unsigned or badly signed requests are still 401.
  - `sendo doctor` reports a `403 PROJECT_SUSPENDED` on `connect:key` as "Connect project suspended — update payment at app.sendo.dev", with a `billing` fix.

- 72c1e61: Sendo Connect, package side: use Quami's Meta app with configuration only.

  - New `connect?: { apiKey, signingSecret, baseUrl? }` in `createSendo` (`baseUrl` defaults to `https://connect.sendo.dev`; `DEFAULT_CONNECT_BASE_URL`, `ConnectOptions`, `ConnectConfig` exported). Both secrets are redacted like tokens. With `connect`, `appSecret` is optional; `connect` with a non-meta-direct transport is a `ConfigError`.
  - Webhooks: with `connect`, `handleWebhook` only accepts `X-Sendo-Signature: t=<unix>,v1=<hex hmac_sha256(signingSecret, t + "." + rawBody)>` (5-minute tolerance, constant-time, several `v1` allowed for rotation); Meta's `X-Hub-Signature-256` is not accepted. Fails closed with 401 and stores nothing. Without `connect` the Meta path is unchanged. New exports `CONNECT_SIGNATURE_HEADER`, `CONNECT_SIGNATURE_TOLERANCE_SEC`, `signConnectBody`, `verifyConnectSignature`.
  - `completeEmbeddedSignup` with `connect` POSTs `{ code, wabaId, phoneNumberId, coexistence, pin }` to `{baseUrl}/v1/signup/complete` (Bearer `apiKey`), receives `{ token, displayPhone }` and continues from `storeToken` with the same compensation; accounts get `onboardedVia: "connect"`. `meta.appId` and the app secret are not needed. Connect's Meta errors keep the usual codes and steps; a rejected key is `CONFIG_ERROR`; other Connect failures are `SIGNUP_FAILED` with the new step `"connect"`. Sending still goes directly to Graph.
  - `sendo doctor`: when `SENDO_CONNECT_API_KEY` / `SENDO_CONNECT_SIGNING_SECRET` are set it requires both (not `SENDO_META_APP_SECRET`) and adds `connect:key`, `connect:webhook` and `connect:delivery` (via `GET {baseUrl}/v1/projects/current/webhook`, `SENDO_CONNECT_BASE_URL` to override), each with a `fix`.

  No schema change. Registry: `webhook` declares `SENDO_CONNECT_API_KEY` and `SENDO_CONNECT_SIGNING_SECRET` and ships the opt-in `connect` wiring commented in `lib/sendo.ts`.

- 20d1fa7: Disconnected numbers leave the default inbox, and a number's history can be exported.

  - **Behaviour change (minor while 0.x):** `sendo.inbox.list` and `sendo.inbox.count` now leave out the conversations of disconnected numbers. Pass `includeInactiveAccounts: true` to include them; a query with that number's `accountId` or a non-blank `search` still finds them.
  - New `sendo.accounts.export(id, { actor })`: an `AsyncIterable<string>` with the chunks of one JSON document (`SendoExportDocumentV1`, `format: "sendo-export"`, `version: 1`) holding the number's contacts, tags, conversations, messages, internal notes, assignments, system events (with their `metadata`) and media references (`storageKey`, a URL signed for 7 days, `missing`). It works on connected and disconnected numbers, streams page by page, and is a snapshot as of `exportedAt`. Admins only (`numbers.manage`): any other actor gets `ForbiddenError` when calling it, before any chunk.
  - New `exportFileName(displayPhone, exportedAt)` → `sendo-export-50222345600-2026-10-12.json`, and the `SendoExport*` types.
  - New CLI command `sendo accounts export <id> [--out <file>]`: writes the same document to the file (or stdout), with progress on stderr.
  - `ConversationFilter` gains `excludeAccountIds` (memory, Supabase, Drizzle and Prisma adapters; covered by the adapter contract suite, which also gains an export case). Custom adapters should implement it.

- 72c1e61: Drizzle adapter: run Sendo on any Postgres 15+ (Neon, RDS, Cloud SQL, self-hosted) without Supabase. `drizzleAdapter({ db, media? })` from `@quami/sendo/adapters/drizzle` takes a `drizzle-orm/node-postgres` or `drizzle-orm/postgres-js` database (optional peer `drizzle-orm`) and implements the whole `SendoAdapter`, including snippets, tags, rules, broadcasts and `metrics.*` (through `METRICS_SQL`). It passes the adapter contract suite on both drivers.

  - Plain SQL over the `sendo_*` tables; what the Supabase functions do (forward-only status updates and placeholders, `markSent` merges, locks, unread increments, the default-number swap, metadata and rule-state merges) runs as single statements or transactions with the same advisory locks, so no function grants are needed.
  - Unmapped database failures throw `DrizzleAdapterError` (`operation`, `code`, `constraint`, `detail`); the documented constraints still map to `ConstraintViolationError`.
  - There is no default media store: pass `media` (e.g. `s3Storage`) here or to `createSendo`.
  - On this adapter, access control is the package's role checks only (RLS applies to Supabase browser clients).

  Setup: install the `schema` and `drizzle-schema` registry items; on plain Postgres run `lib/db/sendo-postgres-prelude.sql` once, then apply `20261010000000_sendo_v1.sql`, `20261011000000_sendo_v2.sql` and `20261013000000_sendo_v3.sql` in order. See https://sendo.dev/docs/adapters#drizzle.

- 72c1e61: Embedded Signup and billing state.

  - `sendo.accounts.completeEmbeddedSignup({ code, tenantId, wabaId, phoneNumberId, coexistence?, pin?, label? })` exchanges the code, subscribes the app to the WABA, registers the number (skipped for coexistence; the PIN is never stored), stores the token through `storeToken`, inserts or reconnects the account (`onboardedVia: "embedded_signup"`), makes it the tenant's default when it is the first, and checks billing. A failure after `storeToken` calls `deleteToken`, unsubscribes the app (best effort) and leaves no row. Needs `storeToken`, `meta.appId` and the app secret (`ConfigError` otherwise).
  - New `EmbeddedSignupError` with codes `SIGNUP_CODE_EXPIRED`, `META_PERMISSION_MISSING`, `PIN_CONFLICT` and `SIGNUP_FAILED` (plus `step`, `metaCode`, `subcode`, `fbtraceId`, `details`). A number connected elsewhere is `DuplicateAccountError` (`ACCOUNT_EXISTS`), raised before the code is spent.
  - `sendo.accounts.refreshBilling(id)` reads the WABA funding field (`primary_funding_id`): present → `billingReady: true`, absent → `false`, Meta error → unchanged. It always sets `billingCheckedAt` and emits `account.billing` on change. `readWabaBillingReady`, `billingReadyFromWaba` and `WABA_FUNDING_FIELD` are exported.
  - `MetaApiError` gains `hint`: `billing_not_ready` (131042), `token_invalid` (190), `window_closed` (131047), `rate_limited` or `null`. A send failing with 131042 sets `billingReady = false` and emits `account.billing`; sends are still attempted when `billingReady` is `false`.
  - `GraphClient` gains `exchangeCode`, `subscribeApp`, `registerPhone` and `getWaba`.
  - `sendo doctor` adds `account:<id>:billing`, a warning (`warning: true`, shown as `AVISO`) with a `billing` fix when the value is `false` or unknown. Warnings don't change the exit code.

  No schema change.

- 1eb0213: The package speaks English to developers.

  - **Breaking (minor while 0.x): `sendo --help`, every CLI message and prompt, `sendo doctor` check labels, details and `fix.detail`, the `accounts list` table headers, `rules sync` output and every thrown package error are now English.** The doctor table uses `OK` / `FAIL` / `WARN` and `-> Fix:`. Error `code`s, check `id`s and `fix.kind`s are unchanged, so code that branches on them keeps working; code that matched Spanish message text must switch to the codes.
  - Rule validation messages (`@quami/sendo/rules` schemas and `sendo rules sync`) and `schemaDriftMessage` ("Your database is at schema version N and Sendo expects M. Run these migrations: …") are English. The registry rules screen shows the schema-declared messages as they are, so they are English there too.
  - The agent system prompt is English and tells the model to reply in the contact's language. The handoff tool keeps its name (`transferir_a_humano`) and `motivo` input; its description is English and its result is `{ handedOff, status, assignees }`. History labels the model reads are English (`[operator] `, `[voice note]`, `[untranscribed voice note]`, `[image]`, …; `HUMAN_PREFIX` and `UNTRANSCRIBED_VOICE_NOTE` hold the new values), and the current date is formatted neutrally (`en-US`) with the IANA time zone.
  - `sendo mcp` search drops the Spanish stop words (the docs are English).
  - End-customer WhatsApp text is unaffected here; it follows `createSendo({ locale })`.

- 72c1e61: `sendo.links`: `create({ account?, tenant?, text?, source })` returns a `wa.me` click-to-chat link whose prefilled text ends with ` [#source]` (`{ url, code, phone, text }`; resolves the number like `send.*`, writes nothing; `source` must match `^[a-z0-9-]{1,32}$`). `sources({ actor, account?, from?, to? })` counts conversations per source in the actor's tenant (admin only, `numbers.manage`). New pure helper `buildWhatsAppLink({ phone, text?, source })` and `LINK_SOURCE_RE`. The `widgets` registry item adds the links screen (QR with PNG/SVG download, chat bubble snippet, sources table) and `<SendoChatBubble />`.
- 1eb0213: Add `createSendo({ locale })` (`"en" | "es"`, default `"en"`) and structured system events.

  - **Breaking (minor while 0.x): the built-in end-customer messages are now English by default.** The handoff message is "Connecting you with someone from the team." and the opt-out confirmation is "Done, we won't send you promotional messages anymore. If you change your mind, message us." To keep the previous Spanish text, pass `locale: "es"`. An explicit `handoffMessage`, `handoff.message` or `optOut.confirmation` still wins.
  - New exports: `SendoLocale`, `BUILT_IN_MESSAGES` (the one table of built-in messages per locale), `BuiltInMessages`, `SystemEventName` and `SYSTEM_LINE_EVENTS`. `DEFAULT_HANDOFF_MESSAGE` and `DEFAULT_OPT_OUT_CONFIRMATION` stay exported and now hold the English values.
  - System lines keep `metadata.event` and now store every value their sentence uses as params (`reason`, `assignedTo`, `assignedToName`, `byName`, `ruleKey`, `queue`, `tags`, `minutesWaiting`, `afterDays`, `agentResumeFrom`). The stored `text` is English. `InboxSystemLine` gains `params`, so a client can render each line in the viewer's language from `event` + `params` and fall back to `text`. Rows written earlier (Spanish `text`, missing or unknown event) come through unchanged.
  - A route rule that hands off without a `reason` now stores `Rule «<key>»` as the handoff reason (was `Regla «<key>»`).

- 72c1e61: `sendo mcp`: an MCP server for coding agents, bundled with the installed version.

  - `npx -y @quami/sendo mcp` serves, over stdio, `search_docs` (BM25 over the docs), `read_doc` (a page or `slug#anchor` section), `api_reference` (declaration, JSDoc and import path of any export, e.g. `createSendo`, `InboxApi.reply`, `sendo.inbox.reply`), `list_registry_items`, `get_registry_item` (files, env vars and the item's `AGENTS.md`) and `run_doctor` (the same JSON as `sendo doctor --json`, read-only). Setup for Claude Code: `claude mcp add --transport stdio --scope project sendo -- npx -y @quami/sendo mcp`; Cursor: see https://sendo.dev/docs/agents-docs.
  - The package now ships `docs/docs.json`, and the build writes `dist/api.json` (from the published `.d.ts`) and `dist/registry.json` (registry manifest plus every item's `AGENTS.md`).
  - `sendo doctor --config <path>` and `sendo mcp --config <path>` use the `adapter` exported by that module instead of the Supabase adapter built from env (for Drizzle, Prisma or custom adapters).
  - `@modelcontextprotocol/sdk` is a new runtime dependency, loaded only by the CLI (the library entry never imports it).
  - Clearer `FORBIDDEN` and `ACCOUNT_STATE` messages: each now says what to do next (configure `resolveRole`, check `can(actor, …)`, reconnect the number).

  No schema change.

- 72c1e61: Pluggable media storage. `createSendo({ media })` takes a `MediaStore` (`put`, `get`, `signedUrl`, `delete`, optional `exists`); the pipeline's media download, the signed URLs of `sendo.inbox.thread`, agent vision, `sendo.accounts.purge` and `sendo doctor`'s bucket check all go through it. Without `media` the adapter's default store is used (`supabaseAdapter` keeps its bucket, `memoryAdapter` its in-memory map); with neither, inbound media is stored as `failed` and doctor reports a `config` fix.

  New subpaths:

  - `@quami/sendo/storage/supabase`: `supabaseStorage({ client, bucket })`, the store `supabaseAdapter` now uses.
  - `@quami/sendo/storage/s3`: `s3Storage({ client, bucket })` for AWS S3, Cloudflare R2 and other S3-compatible stores (optional peers `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`), with `S3StorageError`.
  - `@quami/sendo/snippets` and `@quami/sendo/rules`: client-safe helpers (snippet search and variables, `SNIPPET_BODY_MAX_LENGTH`, `TAG_NAME_MAX_LENGTH`, `SNIPPET_VARIABLE`; rule schemas and types) that don't pull the server runtime into browser bundles.
  - `@quami/sendo/adapters/drizzle` and `@quami/sendo/adapters/prisma`: the Drizzle and Prisma adapters (optional peers `drizzle-orm`, `@prisma/client`), described in their own entries.

  `@quami/sendo/adapters/contract` adds `runMediaStoreContract`, and the main entry exports `metricsFromSql`, `metricsViewStatements` and the `MediaStore` type. `sendo doctor --config` reads an optional `media` export next to `adapter`.

  **Breaking for custom adapters:** `SendoAdapter.storage` is now an optional `MediaStore`: rename `remove` to `delete` and `bucketExists` to `exists`. Adapters without media storage can omit it and rely on `createSendo({ media })`.

  The Supabase adapter now stamps broadcast recipients' `updated_at` with one clock on insert and update, so `nextPending` ordering no longer mixes the database and app clocks.

- 72c1e61: `sendo.metrics`: `daily`, `byAssignee`, `firstResponse`, `aiResolution`, `bySource` and `cost`, each taking `{ actor, from, to, account?, tagIds? }`. Tenant-scoped to the actor; needs `metrics.view` (supervisors and admins), and `cost` needs `costs.view` (admins). For actors without `costs.view`, `daily` returns `costCents`, `tokensIn` and `tokensOut` as `null`. `byAssignee` adds `name` and `avatarUrl` from `resolveUsers`. `account` accepts an account id or Meta phone number id of the tenant (disconnected numbers included); `tagIds` is an any-match tag cut. New helpers `metricsDayRange({ from, to, timeZone })` (calendar days, both included, to local-midnight instants) and `metricsLocalDay(timeZone, at?)`, and the types `MetricsDaily` and `MetricsAssignee`. The `metrics` registry item adds the "Métricas" screen at `/inbox/metrics`.
- 72c1e61: Prisma adapter: run Sendo on any Postgres 15+ through your app's `PrismaClient`. `prismaAdapter({ prisma, media?, schema?, transaction? })` from `@quami/sendo/adapters/prisma` (optional peer `@prisma/client`; Prisma 5+, Prisma 7 with a driver adapter such as `@prisma/adapter-pg`) implements the whole `SendoAdapter`, including snippets, tags, rules, broadcasts and `metrics.*` (through `METRICS_SQL`), and passes the adapter contract suite.

  - Raw SQL with bound parameters through `$queryRawUnsafe` / `$executeRawUnsafe`; what the Supabase functions do (forward-only status updates and placeholders, `markSent` merges, locks, unread increments, the default-number swap, rule reordering, purge, metadata and rule-state merges) runs as single statements or interactive `$transaction`s with the same advisory locks. Your generated models are never used, so their names don't matter.
  - `schema` (default `public`) points the adapter at the Postgres schema that holds the `sendo_*` tables.
  - Unmapped database failures throw `PrismaAdapterError` (`operation`, `code`); the documented constraints still map to `ConstraintViolationError`.
  - There is no default media store: pass `media` (e.g. `s3Storage`) here or to `createSendo`.
  - On this adapter, access control is the package's role checks only (RLS applies to Supabase browser clients).

  Setup: install the `schema` and `prisma-schema` registry items; on plain Postgres run `prisma/sendo-postgres-prelude.sql` once, then apply `20261010000000_sendo_v1.sql`, `20261011000000_sendo_v2.sql` and `20261013000000_sendo_v3.sql` in order (each as its own Prisma migration), and include `prisma/sendo.prisma` in your Prisma schema. See https://sendo.dev/docs/adapters#prisma.

- 1eb0213: Remove the reserved hosted-transport stub.

  Its factory and options type are no longer exported from `@quami/sendo`: every method only threw `NotImplementedError`, and no hosted mode that stores your data is planned. The `Transport` interface and `metaDirect` are unchanged, and `NotImplementedError` stays (a transport without `uploadMedia` or `markRead`, or `templates.sync` on a transport that isn't `metaDirect`). The roadmap now describes Sendo Connect and the channels still to come.

- 72c1e61: Rules engine, `sendo.maintenance.tick()`, source attribution and `sendo rules sync`.

  - Five rule types (`business_hours`, `route`, `auto_assign`, `escalate`, `auto_close`) with zod schemas exported from the main entry (`ruleParamsSchemas`, `ruleDefinitionSchema`, `parseRuleParams`, ...). Rules live in `sendo_rules`; the engine reads them per tenant (cached 30 s, refreshed on writes through `sendo.rules`).
  - `sendo.rules.list/upsert/toggle/reorder/delete({ actor })` need `rules.manage` and record `updatedBy`; `list` flags stored rules whose params no longer validate (`valid`, `error`).
  - Pipeline: the first message of a new or reopened conversation sets `conversation.source` and `message.metadata.source` from a trailing `[#code]` or a Click-to-WhatsApp `referral` (`ad:<source_id>`), then `route` rules run (first match wins). Inbound messages outside business hours get the after-hours message once per closed period, only inside the 24-hour window. `appliesTo: "all"` holds the agent.
  - `sendo.maintenance.tick({ now?, budgetMs? })` (lock `tick`, 120 s) hands held conversations back to the agent when hours open, escalates, auto-closes, re-checks billing hourly for accounts with `billingReady = false`, and prunes events once a day. It returns a `TickReport` with per-step counts. Call it every minute from a cron route.
  - Every rule action writes a system line in the thread and emits `rule.applied` (plus `conversation.status`, `conversation.assigned` or `escalation`) with `by: "rule:<key>"`.
  - CLI: `sendo rules sync --config <path> [--force] [--tenant <id>]` loads `rules` from a JS/TS module and inserts missing rules with origin `code`; existing rules are only overwritten with `--force`. `jiti` is a new runtime dependency, loaded only by the CLI.

  No schema change (uses the v2 tables).

- 72c1e61: Schema v2: storage for the team inbox (snippets, tags and rules).

  **Migration:** copy `20261011000000_sendo_v2.sql` from the `schema` registry item into `supabase/migrations/` and run it (`supabase db push`, or `supabase db reset` locally). Re-installing the item (`npx shadcn add @sendo/schema`) adds the file too. It is additive: it creates `sendo_snippets`, `sendo_tags`, `sendo_conversation_tags` and `sendo_rules` with RLS select policies through `sendo_can_access_tenant`, the optional hook `sendo_current_user_id()` (personal snippets are only readable by their owner; defaults to `auth.uid()::text`, replace it if your app's user ids are not Supabase Auth ids), the service-role functions `sendo_merge_rule_state`, `sendo_escalation_candidates` and `sendo_count_by_source`, and sets schema version 2. Until it runs, `sendo doctor` and the startup check report the drift.

  - New entities `Snippet`, `Tag` and `StoredRule`, and enums `SNIPPET_VISIBILITIES`, `TAG_COLORS`, `RULE_TYPES` and `RULE_ORIGINS`.
  - `SendoAdapter` gains the `snippets`, `tags` and `rules` namespaces, `conversations.count`, `countBySource`, `countByAssignee` and `findForTick`, `messages.update` and `messages.deleteDrafts`. `conversations.list` accepts `tagIds` (any match), `queue`, `visibleTo` and `search`. Custom adapters must implement them and pass the contract suite.
  - `SENDO_TABLES` (checked by `healthCheck` and `sendo doctor`) includes the four new tables.

- 72c1e61: Schema v3: storage for broadcasts and the metrics views.

  **Migration:** copy `20261013000000_sendo_v3.sql` from the `schema` registry item into `supabase/migrations/` and run it (`supabase db push`, or `supabase db reset` locally). Re-installing the item (`npx shadcn add @sendo/schema`) adds the file too. It is additive: it creates `sendo_broadcasts` and `sendo_broadcast_recipients` with RLS select policies through `sendo_can_access_tenant` (no write policies; deleting an account deletes its broadcasts), the five read-only `security_invoker` views `sendo_metrics_daily`, `sendo_metrics_by_assignee`, `sendo_metrics_first_response`, `sendo_metrics_ai_resolution` and `sendo_metrics_by_source`, and sets schema version 3. Until it runs, `sendo doctor` and the startup check report the drift.

  - New entities `Broadcast` and `BroadcastRecipient`, and enums `BROADCAST_STATUSES` and `BROADCAST_RECIPIENT_STATUSES`.
  - `SendoAdapter` gains the `broadcasts` namespace (`insert`, `get`, `list`, `update`, `insertRecipients`, `nextPending`, `updateRecipient`, `recipientByMessageId`, `cancelPending`, `counts`), the read-only `metrics` namespace (`daily`, `byAssignee`, `firstResponse`, `aiResolution`, `bySource`, `cost`, all taking `{ tenantId, from, to, accountId?, tagIds? }`) and `messages.pendingDraftConversations`. Custom adapters must implement them and pass the contract suite.
  - Metrics days are calendar days in the account's timezone. First response ignores internal notes, drafts and imported history; AI resolution means the conversation was never handed off and no human wrote; cost per day and per AI agent comes from `cost_cents` (drafts included).
  - `METRICS_SQL`, `METRICS_VIEWS` and `metricsSqlParams` export the same queries as parameterized SQL for Drizzle, Prisma or plain `pg` users.
  - `SENDO_TABLES` (checked by `healthCheck` and `sendo doctor`) includes the two new tables.

- 72c1e61: `sendo.snippets` and `sendo.tags` (schema v2). Snippets: `list({ actor, accountId? })` (team snippets plus the actor's personal ones, optionally only those usable on a number), `get`, `upsert({ id?, shortcut, body, visibility?, accountId? }, { actor })`, `delete` and `render(snippetId, { actor, conversationId })` → `{ text, unresolved }`, which fills the built-ins `{{nombre}}`, `{{telefono}}`, `{{agente}}` and the values of the new `resolveSnippetVariables({ contact, conversation, account })` config hook, leaving unresolved variables as written. Team snippets need `snippets.manage_tenant`; personal ones are visible and editable only by their owner; shortcuts are unique per tenant and owner (`ConstraintViolationError`). Tags: `list({ actor })` for every role, and `upsert({ id?, name, color }, { actor })`, `delete` (also removes the tag from every conversation) and `usage` with `tags.manage`; colors come from `TAG_COLORS`. Browser-safe helpers `searchSnippets` (accent- and case-insensitive), `findSnippetVariables`, `fillSnippetVariables`, `normalizeSearchText` and `SNIPPET_SHORTCUT`. The `inbox` registry item adds the composer with Responder / Nota interna, the `/` snippet picker with unresolved-variable highlighting, the tag picker, the assign menu and the snippets / tags managers; re-copy `actions.ts`, `page.tsx`, `inbox.tsx`, `composer.tsx` and the new component files.
- 72c1e61: Team inbox operations: actor-based `sendo.inbox`, notes, drafts, agent pause and turn cost.

  - **Breaking:** every `sendo.inbox.*` method takes `{ actor }` from `sendo.actor(userId, tenantId)` (needs `resolveRole`) instead of `tenantId` / `userId`, and enforces the role matrix: another tenant's conversation is `RECORD_NOT_FOUND`; a conversation the actor can't see, reassigning someone else, or pausing the AI without the role is `FORBIDDEN`. `reply` returns an `InboxMessage`; `markSeen` returns nothing.
  - New: `inbox.get`, `count`, `note`, `take`, `assign`, `returnToAgent`, `close`, `pauseAgent`, `approveDraft`, `discardDraft`, `assignees`, `tags.add/remove`, and `sendo.conversations.pauseAgent(id, paused, { by })`.
  - `InboxConversation` adds `channel`, `source`, `queue`, `assignee` (from `resolveUsers`), `handoff { reason, by, at }`, `agentPaused` / `agentPausedOn`, `hasPendingDraft`, `accountActive` and `tags`. `InboxMessage` adds `internal`, `systemLine`, `draft`, `handoffAfterDraft`, `approvedBy`, `edited`, `origin`, `source` and `tokensIn` / `tokensOut` / `costCents` (admins only).
  - Step-in: a person's reply leaves the status and the agent alone and discards the pending draft. Internal notes are never sent and never reach the model.
  - Draft mode (`mode: "draft"` or the number's `agentMode`): the agent stores one pending draft per conversation instead of sending; approving after the 24-hour window throws `WindowClosedError`.
  - Agent pause: no catch-up on resume; the agent answers from the next inbound message on. `conversation.agent_paused` fires on every change and `conversation.assigned` on every assignment change.
  - Handoffs, takes, assignments, returns to the AI, closes and pauses add a system line to the thread (`internal`, sender `system`, `metadata.kind = "system"`). Handoffs use `resolveAssignees` (falling back to `resolveHandoffTargets`), and every entry into `human` calls the rules hook.
  - Every agent turn stores `tokensIn` / `tokensOut`, and `costCents` from the provider's cost (OpenRouter), else the new `AgentDefinition.pricing`, else `null`.
  - A disconnected number makes `reply`, `note` and `approveDraft` throw `AccountStateError` (`ACCOUNT_STATE`); reads keep working.
  - Adapters: `messages.insertOutbound` accepts `status: "sent"` for rows that never go through the transport.

  Re-copy `app/(protected)/inbox/actions.ts`, `page.tsx` and `components/sendo/types.ts` from `inbox`, and configure `resolveRole` in `lib/sendo.ts`. No schema change.

- 72c1e61: Voice-note transcription and conversation cost.

  - `createSendo({ transcribe: { model, timeoutMs? } })` transcribes inbound `audio` with `experimental_transcribe` from `ai` right after the media download and before the opt-out check, rules, `message` event and agent turn (30 s limit, 25 MB max). The transcript goes into the message `text` with `metadata.transcription = { model, ms }`; on failure `text` stays `null` and `metadata.transcription.error` is `too_large`, `timeout`, `no_audio`, `empty` or `failed`. An invalid `transcribe` throws `ConfigError`. Exports `TRANSCRIBE_TIMEOUT_MS`, `TRANSCRIBE_MAX_BYTES`, `TranscriptionError`, `UNTRANSCRIBED_VOICE_NOTE`.
  - Agent history: inbound voice notes read as `[nota de voz] <transcript>`, or `[nota de voz sin transcribir]` (previously `[audio]`).
  - `InboxMessage.transcription: { model, ms, error } | null`.
  - New `sendo.inbox.cost(conversationId, { actor })` → `{ turns, tokensIn, tokensOut, costCents, unpricedTurns }` for the whole conversation (agent replies and drafts); needs `costs.view` (admins).
  - Re-copy the `inbox` registry item: agent replies show their cost and tokens on hover for admins, "Costo del agente" totals the whole conversation, and voice notes show their transcript or "Sin transcripción".

### Patch Changes

- 9d24d54: Consistent access errors across the team APIs. Every method that takes `{ actor }` (`sendo.inbox`, `snippets`, `tags`, `rules`, `broadcasts`, `metrics`, `links.sources`) now refuses a missing or forged actor (no user id, unknown or `null` role) with `ForbiddenError` (`role: null`, plus the capability the call needs) before reading anything; `snippets.list`, `snippets.get`, `snippets.render` and `tags.list` used to answer such an actor. An `accountId` filter on `inbox.list`, `inbox.count`, `snippets.list`, `rules.list` and `broadcasts.list` must name a number of the actor's tenant (connected or not, by id or Meta phone number id), else `AccountNotFoundError`, like every other account argument. `inbox.tags.add` / `remove` refuse an unknown tag or one of another tenant with `RecordNotFoundError` (`entity: "tag"`). The inbox list reads pending drafts with one batched query, so a draft older than the last 30 messages still shows.
- f9c15a0: Registry items drop the `sendo-` prefix: `npx shadcn add @sendo/webhook @sendo/schema`, then `npx shadcn add @sendo/inbox` (also `numbers`, `workflows`, `broadcasts`, `metrics`, `widgets`, `drizzle-schema`, `prisma-schema`). Installed files keep their paths (`components/sendo/…`, `lib/sendo.ts`, `supabase/migrations/…`), so apps that already installed the items change nothing. registry.sendo.dev still serves the old `sendo-*` names until `0.2.0`.

  - `sendo doctor` and the schema-version warnings point to `npx shadcn add @sendo/schema`.
  - `sendo mcp`: `list_registry_items` returns `npx shadcn add @sendo/<name>`; `get_registry_item` accepts `inbox`, `@sendo/inbox` and the old `sendo-inbox`.
  - `package.json` gains `repository`, `homepage` and `bugs` (github.com/quamidev/sendo, sendo.dev).
