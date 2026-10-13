# CLAUDE.md — Sendo (`@quami/sendo`)

Guidance for agents and developers working in this repo.

## What this is

A WhatsApp Cloud API library for Quami apps, delivered two ways:

- **npm package `@quami/sendo`** (`packages/sendo`): webhook verification and parsing, sending, the pipeline, agents, inbox server ops, adapters, Next.js helpers and the `sendo` CLI.
- **shadcn registry** (`registry/`, served by `apps/web`): files copied into the host app — the webhook route, the Supabase migration and the inbox UI.

**Critical logic lives in npm; customizable pieces live in the registry.** Anything security-sensitive or protocol-level (signature checks, parsing, status ordering, token handling, storage access) belongs in the package. The registry only ships code an app is expected to edit (routes, config, UI).

## Stack

- TypeScript 5 (`strict`, see `tsconfig.base.json`), Node 20+, ESM-first with CJS output.
- pnpm workspaces + Turborepo. pnpm version is pinned in the root `packageManager` field.
- Package build: tsup (ESM + CJS + `.d.ts`, subpath exports, `sendo` bin).
- zod 4 and AI SDK v6 (`ai`) are **peer dependencies**. `@supabase/supabase-js`, `next` and `vitest` are optional peers used only by their subpaths.
- Tests: E2E first. See **Testing rules for agents** in `AGENTS.md`. Vitest runs `packages/sendo/test/integration/` (signed webhook fixtures, msw for Meta, a scripted model, memory + local Supabase adapters) and `apps/playground/test/replay.test.ts`; `pnpm test:e2e` writes `test-results/e2e-report.json`.
- Lint/format: ESLint 9 flat config (`eslint.config.mjs`, type-aware `typescript-eslint` strict) + Prettier.
- Release: Changesets + GitHub Actions, publishing to the public `@quami` npm scope.
- UI (registry, apps): Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui new-york, lucide icons.

## Commands (run from the repo root)

| Command                               | Does                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install`                        | Install the workspace                                                                                                                      |
| `pnpm build`                          | `turbo build`: package (tsup), registry JSON and Next apps                                                                                 |
| `pnpm typecheck`                      | `tsc --noEmit` in every workspace                                                                                                          |
| `pnpm lint`                           | ESLint in every workspace                                                                                                                  |
| `pnpm test`                           | Vitest in every workspace. Supabase-backed suites skip when local Supabase is unreachable                                                  |
| `pnpm supabase start`                 | Start local Supabase (Docker required)                                                                                                     |
| `pnpm test:e2e`                       | The E2E suite only (`packages/sendo/test/integration`, playground replay); writes `packages/sendo/test-results/e2e-report.json`            |
| `pnpm test:supabase`                  | Run only Supabase-backed suites (`*supabase*` test files) with `SENDO_REQUIRE_SUPABASE=1`; they must fail, not skip, when Supabase is down |
| `pnpm registry:build`                 | `shadcn build registry/registry.json -o apps/web/registry-dist` (no-op until the manifest exists)                                          |
| `pnpm format` / `pnpm format:check`   | Prettier                                                                                                                                   |
| `pnpm changeset`                      | Record a release note for `@quami/sendo`                                                                                                   |
| `pnpm --filter @quami/sendo <script>` | Run a script in one workspace                                                                                                              |

**Done gate for every change:** `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test`.

## Layout and ownership

```
packages/sendo/            @quami/sendo
  src/index.ts             main entry: createSendo, types, errors, utils, transports
  src/{types,errors,utils,client,transport,webhook,core,agents,inbox}/
  src/adapters/types.ts    SendoAdapter interface
  src/adapters/memory/     @quami/sendo/adapters/memory
  src/adapters/supabase/   @quami/sendo/adapters/supabase
  src/adapters/contract/   @quami/sendo/adapters/contract (shared adapter + MediaStore suites)
  src/adapters/{drizzle,prisma}/  @quami/sendo/adapters/{drizzle,prisma}
  src/media/               MediaStore interface (createSendo({ media }))
  src/storage/{supabase,s3}/  @quami/sendo/storage/{supabase,s3}
  src/team/snippet-text.ts, src/rules/schemas.ts  client-safe @quami/sendo/snippets, /rules
  src/next/                @quami/sendo/next
  src/cli/                 sendo bin (doctor, accounts, rules sync, mcp)
  scripts/build-agent-data.mjs  post-tsup: dist/api.json (from the .d.ts) + dist/registry.json for `sendo mcp`
  docs/docs.json           docs pages for `sendo mcp` (checked in; `pnpm --filter web build:llms`)
  test/fixtures/           anonymized Meta webhook payloads
  test/                    build-output guards and integration tests
registry/                  registry.json + items/sendo-*/ (each with AGENTS.md; UI items also MOTION.md)
supabase/                  local Supabase project (migrations mirror registry/items/sendo-schema)
apps/web/                  sendo.dev: landing, live demo (/api/demo), docs, changelog; /r/[name].json registry (public unless meta.private)
apps/playground/           Next.js + Supabase app that installs from the local registry
.claude/skills/            emilkowalski/skills (committed)
```

Rules:

- Root config (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`) is shared. Do not change it for a single ticket; put workspace-specific settings in that workspace (`package.json`, `tsconfig.json`, `turbo.json` with `"extends": ["//"]`, its own `eslint.config.mjs` for Next apps).
- Add dependencies to the workspace that uses them (`pnpm --filter <name> add <dep>`), not the root.
- New package subpaths need an entry in `packages/sendo/tsup.config.ts` **and** the `exports` map.
- The main entry (`@quami/sendo`) must never import `next`, `@supabase/supabase-js`, `vitest`, `drizzle-orm`, `@prisma/client`, `@aws-sdk/*` or the CLI-only dependencies (`@modelcontextprotocol/sdk`, `jiti`; import those dynamically from `src/cli/` only), directly or through shared chunks. The client-safe subpaths (`snippets`, `rules`) import nothing but `zod`. The integration consistency suite (`[CC-ENT-1]` in `packages/sendo/test/integration/consistency.test.ts`) enforces this against the built `dist/`.
- Data always goes through the `SendoAdapter` and media bytes through the `MediaStore` (`ctx.config.media`: `createSendo({ media })`, else `adapter.storage`); the memory and Supabase adapters must both pass the contract suite.

## Code rules

- No `any`, no `@ts-ignore`; `const` by default; `import type` for types.
- Testing: follow `AGENTS.md` → "Testing rules for agents" (E2E first, no after-the-fact unit tests, isolation only with a written failure list, always produce the artifact). No test may require real Meta credentials; Supabase-backed suites skip when local Supabase is down and must fail under `pnpm test:supabase`.
- Keep comments minimal.
- **No tokens in logs, errors or stored rows.** Access tokens are resolved per call through `resolveToken(account)` and never persisted. The logger redacts `Authorization` headers, `access_token` params and every resolved token value. Error messages and `toJSON()` output must not contain tokens.
- Graph API version lives in one exported constant, overridable in config.

## API guessability (review checklist, AC-AD-5)

Coding agents use this API without reading the source. Every new or changed public API, CLI command and error passes this before review:

- [ ] **One way to do each thing.** No second function, option or alias that does the same as an existing one. Extend the existing call instead (e.g. `{ tenant }` on `send.*`, not a `sendForTenant`).
- [ ] **Obvious names.** Namespaces are nouns (`sendo.accounts`, `sendo.inbox`), methods are verbs (`list`, `get`, `upsert`, `delete`, `pauseAgent`), the same concept has the same name everywhere (`tenantId` / `tenant`, `accountId` / `account`, `actor`), and booleans read as facts (`agentPaused`, `billingReady`). Match the existing pattern before inventing one.
- [ ] **Every error says what to do next.** Messages name the thing that failed and the fix (which env var, which migration file, which call or capability), e.g. "No se encontró @supabase/supabase-js. Instálalo en tu app: npm install @supabase/supabase-js". Errors carry a stable `code` (`SENDO_ERROR_CODES`) and the fields needed to act on them; doctor checks carry `fix: { kind, detail, docsUrl }` (a failing check without `fix` does not compile).
- [ ] **Discoverable by agents.** Public exports have a one-line JSDoc (it ends up in `api_reference`), a docs page or section covers the feature (then `pnpm --filter web build:llms`), and registry items keep their `AGENTS.md` current.

### `AGENTS.md` in registry items

Every `registry/items/<item>/AGENTS.md` is listed in the item's `files` with target `components/sendo/<dir>/AGENTS.md` (UI items also ship `MOTION.md` to the same directory) and has: `# <item> — notes for agents` with an intro (what it is, install command, what it needs), `## Files` (which are yours to edit), `## Don't touch` (what lives in npm and why), `## Connects to` (env vars, `createSendo` hooks, database hooks, other items) and `## Verify` (how to check it works). Other sections may follow. `registry/registry.test.ts` enforces it for every item in `registry.json`.

## UI rules (registry inbox, `apps/web`, `apps/playground`)

All UI follows the emilkowalski skills in `.claude/skills/`.

- Use **`emil-design-eng`** by default for every UI task (durations, easing, which properties to animate, polish).
- Run **`find-animation-opportunities`** on a screen **before** adding any motion to it.
- Run **`review-animations`** and **`break-ui`** before publishing (or changing) a registry item. Fix every finding or justify it in that item's `MOTION.md`.
- Use `apple-design` for springs, gestures, materials and reduced-motion behaviour.

Per-screen process:

1. Build the screen static, with hover and press states on every interactive element, and no motion.
2. Run `find-animation-opportunities`; save the result as `MOTION.md` next to the component (inbox: `registry/items/sendo-inbox/MOTION.md`) with each kept motion's recipe and each rejected candidate's reason.
3. Implement only the kept motions.
4. Run `review-animations`; fix or justify in `MOTION.md`.
5. Run `break-ui` with the edge-case fixtures in `apps/playground/fixtures/inbox/`.

Motion rules:

- **Animate only `transform` and `opacity`.** Never `height`, `width`, `padding` or `margin`.
- Every motion has a purpose (feedback, spatial consistency, state indication, preventing a jarring change, explanation, delight). Frequent actions get no decorative motion.
- Durations: press 100–160 ms, tooltips 125–200 ms, menus 150–250 ms, dialogs/sheets 200–500 ms, everything else under 300 ms. Use the `--sendo-*` motion tokens.
- `ease-out` to enter, `ease-in-out` for on-screen movement, never `ease-in`. Prefer custom `cubic-bezier()`.
- Response starts on pointer-down; animations are interruptible from the current value.
- CSS transitions by default; `motion` only for springs and gestures, and only in the registry inbox item (never in the npm package).
- `prefers-reduced-motion: reduce`: keep opacity and colour transitions, remove transform movement.
- All inbox strings come from `InboxStrings` (Spanish defaults).
