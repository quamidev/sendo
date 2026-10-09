# Sendo

`@quami/sendo` is Quami's WhatsApp Cloud API library. Install it in a Quami app to receive and send WhatsApp messages, run AI agents on conversations, hand off to humans, and give operators an inbox — without a central server. Messages, contacts and credentials stay in the app's own database.

It ships in two parts:

- **npm package** [`@quami/sendo`](packages/sendo): the webhook handler (signature verification, parsing, dedupe), sending (text, media, buttons, lists, templates), the 24-hour window, statuses, agents (AI SDK v6), inbox server operations, storage adapters (memory, Supabase), Next.js helpers and the `sendo` CLI (`doctor`, `accounts add`).
- **shadcn registry** ([`registry/`](registry), served from `registry.sendo.dev`): the webhook route and client config, the Supabase schema migration, and the inbox UI. These are copied into your app so you can customise them.

Critical logic lives in npm; customizable pieces live in the registry.

## Repository layout

| Path              | What                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `packages/sendo`  | The `@quami/sendo` npm package                                                              |
| `registry/`       | shadcn registry manifest and items                                                          |
| `apps/web`        | Registry host (token-protected `/r/[name].json`) and docs                                   |
| `apps/playground` | App that installs Sendo from the local registry ([README](apps/playground/README.md))       |
| `supabase/`       | Local Supabase project used by tests and the playground                                     |
| `.claude/skills/` | UI design and motion skills ([emilkowalski/skills](https://github.com/emilkowalski/skills)) |

## Requirements

- Node 20+ (CI runs 22 and 24)
- pnpm 10 (version pinned in `package.json` → `packageManager`)
- Docker, only for local Supabase (`pnpm supabase start`)

## Commands

```bash
pnpm install          # install the workspace
pnpm build            # build the package, registry and apps (Turborepo)
pnpm typecheck        # tsc --noEmit everywhere
pnpm lint             # ESLint 9 flat config
pnpm test             # Vitest; Supabase-backed suites skip if Supabase is down
pnpm supabase start   # start local Supabase (Docker)
pnpm test:supabase    # run only the Supabase-backed suites
pnpm registry:build   # build registry JSON into apps/web/registry-dist
pnpm format           # Prettier
pnpm changeset        # add a release note
```

## Releasing

Releases use [Changesets](https://github.com/changesets/changesets). Add a changeset with `pnpm changeset` in your PR. On `main`, the `Release` workflow opens a "version packages" PR; merging it publishes `@quami/sendo` to the private `@quami` npm scope using the `NPM_TOKEN` repository secret.

## Contributing

See [`CLAUDE.md`](CLAUDE.md) for conventions, ownership and UI rules.
