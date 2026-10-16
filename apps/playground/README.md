# Sendo playground

A Next.js 16 app (port 3000) that installs Sendo **the way a real Quami app does**: `@quami/sendo` as a dependency plus the `@sendo` registry items copied in with `shadcn add`. Use it to try the webhook, the agent and the inbox end to end.

```bash
cp apps/playground/.env.example apps/playground/.env.local   # optional, defaults work
npx pnpm@10.34.6 --filter playground dev:fixtures           # http://localhost:3000
npx pnpm@10.34.6 --filter playground replay text            # in another terminal
```

## Modes

|                | Fixtures mode                                                    | Supabase mode                                                  |
| -------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| When           | `SENDO_PLAYGROUND_MODE=fixtures`, or Supabase env missing        | Supabase env set and `SENDO_PLAYGROUND_MODE` is not `fixtures` |
| Storage        | `memoryAdapter()` seeded from `fixtures/`                        | root local Supabase (`http://127.0.0.1:55321`)                 |
| Auth           | none: `requireUser()` returns `{ userId: "dev-user", tenantId }` | Supabase Auth, `/login`                                        |
| Realtime       | off                                                              | Supabase Realtime                                              |
| Meta Graph API | fake (`lib/fake-meta.ts`, no network)                            | real, or fake with `SENDO_PLAYGROUND_FAKE_META=true`           |
| Docker         | not needed                                                       | needed                                                         |

`lib/sendo.ts` picks the mode once per server process and caches the client on `globalThis`, so the in-memory data survives hot reloads in `next dev` (it resets when the server restarts). Every adapter call waits for the fixtures seed first.

### Fixtures mode

- Account `100000000000001` (the `phone_number_id` of every package webhook fixture), token ref `SENDO_TOKEN_MAIN`, tenant `00000000-0000-4000-8000-00000000a001`.
- Two approved templates: `recordatorio_cita` (2 variables) and `seguimiento` (`fixtures/templates.json`).
- Inbox edge cases in `fixtures/inbox/`, dated relative to server start:
  - `long-name.ts`: a contact with a 60-character name
  - `long-thread.ts`: a 500-message thread
  - `empty.ts`: a conversation without messages
  - `failed-send.ts`: a human reply that failed with Meta error 131047
  - `missing-media.ts`: an image with `download_status = failed` (plus one downloaded image)
  - `voice-notes.ts`: voice notes transcribed, timed out and over 25 MB ("Sin transcripción"), and agent turns with a known, unknown ("—") and very large cost (hover them as the admin dev user; "Costo del agente" in the panel)
  - `voice-notes.ts`: voice notes transcribed, timed out and over 25 MB ("Sin transcripción"), and agent turns with a known, unknown ("—") and very large cost (hover them as admin; "Costo del agente")
  - `mixed.ts`: agent / human / closed conversations, assigned to `dev-user`, to `operador-2` or to nobody, and outbound messages in every status (pending, sent, delivered, read)
- Links screen (`widgets`) at `/inbox/links`: the dev user is the tenant's admin (`resolveRole` in `lib/sendo.ts`). Its `break-ui` datasets live in `fixtures/widgets/` and render at the dev-only `/dev/links?data=demo|worst|empty|one` (toggle at the bottom; 404 in production).
- Numbers screen (`numbers`) at `/inbox/numbers`. Its `break-ui` datasets (`fixtures/numbers/`) are separate tenants, picked with `/dev/numbers?data=demo|worst|empty|agent` (a cookie; toggle at the bottom of the screen): `demo` is the playground tenant (1 number, the default), `worst` has 6 numbers in every status (incl. "Token inválido", from a fake Meta error 190), `empty` has none, `agent` shows `worst` to a user with the `agent` role (read-only). "Conectar WhatsApp" runs Embedded Signup against `public/fake-facebook-sdk.js` and the fake Graph API: a prompt asks for the `phone_number_id` (empty = cancel; ids ending in `0000` ask for the two-step PIN `123456`). `test/numbers.test.ts` drives the same actions.
- Rules screen (`workflows`) at `/inbox/rules` and the tick route `/api/sendo/tick` (set `SENDO_CRON_SECRET`, then `curl -H "Authorization: Bearer $SENDO_CRON_SECRET" http://localhost:3000/api/sendo/tick`). Its `break-ui` datasets live in `fixtures/workflows/` and render at the dev-only `/dev/rules?data=demo|worst|empty|invalid` (edits stay in the server process; `&reset` starts over; 404 in production). `test/workflows.test.ts` drives the real actions and the tick route.

### Supabase mode

Docker must be running.

```bash
npx pnpm@10.34.6 supabase start             # repo root; applies supabase/migrations
npx pnpm@10.34.6 supabase db reset          # re-apply migrations (they create the bucket)
npx pnpm@10.34.6 supabase status -o env     # copy API_URL, ANON_KEY, SERVICE_ROLE_KEY
# apps/playground/.env.local:
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
#   SUPABASE_SERVICE_ROLE_KEY=...
#   (and remove SENDO_PLAYGROUND_MODE=fixtures)
npx pnpm@10.34.6 --filter playground seed   # dev user, sendo_accounts row, templates
npx pnpm@10.34.6 --filter playground dev
```

- Sign in at `/login` with **`dev@playground.local` / `playground`**.
- `supabase/migrations/20261010100000_playground.sql` replaces `sendo_can_access_tenant(tenant_id uuid)`: a signed-in user reads the `sendo_*` rows whose `tenant_id` equals `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`. Only the service role can set `app_metadata`, which the seed script does. The registry migration stays app-agnostic. The root Supabase project gets a byte-identical copy at `supabase/migrations/20261010100000_playground.sql`, checked by `[CC-SCH-1]` in `packages/sendo/test/integration/consistency.test.ts`. If you edit one, copy it to the other.
- The seeded user has the fixed id `00000000-0000-4000-8000-00000000d001`. Handoffs auto-assign to it.

## Demo agent

`lib/sendo.ts` registers the agent `recepcion` (`lib/demo-agent.ts`):

- Tool `buscar_cita`: a fake appointment lookup by name or phone.
- Handoff `{ when: "el usuario pide hablar con una persona o está molesto", to: "recepcion" }`.
- `resolveHandoffTargets` returns the dev user.
- `linkContact` maps the demo phones `+50255550001`–`+50255550003` to `pac_001`–`pac_003`.

The model is `SENDO_AGENT_MODEL` (an AI Gateway id). If it isn't set, a deterministic mock model (`lib/mock-model.ts`) answers instead:

- It replies `Hola, soy el agente de prueba. Recibí: <texto>`.
- If the text contains "persona", it calls the handoff tool.
- If the text contains "mi cita" or "buscar cita", it calls `buscar_cita`.

## Replaying webhooks

```bash
npx pnpm@10.34.6 --filter playground replay                 # list fixtures
npx pnpm@10.34.6 --filter playground replay text
npx pnpm@10.34.6 --filter playground replay text --fresh --text "quiero hablar con una persona"
npx pnpm@10.34.6 --filter playground replay image --fresh
```

`scripts/replay.mjs` posts `packages/sendo/test/fixtures/webhooks/<name>.json` to `http://localhost:3000/api/sendo/webhook`, signed with HMAC-SHA256 using `SENDO_META_APP_SECRET` (default `playground-app-secret`).

- By default, message and status timestamps become "now" so the 24-hour window is open. `--raw` sends the file untouched.
- `--fresh` gives each message a new id. Without it, a second replay is dropped as a duplicate.
- `--url` targets another host.

## Installing from the local registry

```bash
npx pnpm@10.34.6 --filter playground registry:install                 # every default item, from files
npx pnpm@10.34.6 --filter playground registry:install webhook   # one item
npx pnpm@10.34.6 --filter playground registry:install --source url    # through http://localhost:3001
```

`scripts/registry-install.mjs` runs `shadcn add` with the built item files from `apps/web/registry-dist/<item>.json`. It runs `pnpm registry:build` first when they're missing. `shadcn add` accepts absolute paths to item JSON files.

With `--source url`, it adds `@sendo/<item>` through the `@sendo` registry in `components.json` (`http://localhost:3001/r/{name}.json` with `Authorization: Bearer ${SENDO_REGISTRY_TOKEN}`). This needs `pnpm --filter web dev`, `SENDO_REGISTRY_TOKEN` here, and the same token in the web app's `SENDO_REGISTRY_TOKENS`.

**Resolving `@quami/sendo` to the workspace (it isn't on npm):**

- `package.json` already declares `"@quami/sendo": "workspace:*"`. `shadcn add` skips dependencies that are already declared when the item gives no version, so it never runs `pnpm add @quami/sendo` and the package stays linked to `packages/sendo`.
- The script refuses to run without that entry, and checks afterwards that it is unchanged.
- No `.npmrc` change is needed.
- If `pnpm` isn't on PATH, the script puts a temporary shim on PATH that runs `npx pnpm@10.34.6`.

The script always passes `--overwrite`, except for files the playground adapted after installing: `lib/sendo.ts` is kept unless you pass `--reset-app-files`. It also removes the `.env.local` that `shadcn add` creates with empty keys. The variables are documented in `.env.example`.

The installed files are committed:

- `app/api/sendo/webhook/route.ts`
- `lib/sendo.ts` (adapted)
- `supabase/migrations/20261010000000_sendo_v1.sql` (the app's copy; the root Supabase project uses `supabase/migrations/`)
- `components/sendo/*`

Re-run the install after changing a registry item.

## Checks

```bash
npx pnpm@10.34.6 --filter playground test        # webhook → stored message → mock agent reply, fixtures
npx pnpm@10.34.6 --filter playground build
```

`test/replay.test.ts` calls the route module directly in fixtures mode. No server is needed.
