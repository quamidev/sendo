# CLAUDE.md — wa-li (`@quami/wa-li`)

Guidance for agents and developers working in this repo.

## What this is

A WhatsApp Cloud API library for Quami apps, delivered two ways:

- **npm package `@quami/wa-li`** (`packages/wa-li`): webhook verification and parsing, sending, the pipeline, agents, inbox server ops, adapters, Next.js helpers and the `wa-li` CLI.
- **shadcn registry** (`registry/`, served by `apps/web`): files copied into the host app — the webhook route, the Supabase migration and the inbox UI.

**Critical logic lives in npm; customizable pieces live in the registry.** Anything security-sensitive or protocol-level (signature checks, parsing, status ordering, token handling, storage access) belongs in the package. The registry only ships code an app is expected to edit (routes, config, UI).

## Stack

- TypeScript 5 (`strict`, see `tsconfig.base.json`), Node 20+, ESM-first with CJS output.
- pnpm workspaces + Turborepo. pnpm version is pinned in the root `packageManager` field.
- Package build: tsup (ESM + CJS + `.d.ts`, subpath exports, `wa-li` bin).
- zod 4 and AI SDK v6 (`ai`) are **peer dependencies**. `@supabase/supabase-js`, `next` and `vitest` are optional peers used only by their subpaths.
- Tests: Vitest (colocated `*.test.ts`), msw for Graph API mocks, `MockLanguageModelV3` for agents, local Supabase for adapter integration tests.
- Lint/format: ESLint 9 flat config (`eslint.config.mjs`, type-aware `typescript-eslint` strict) + Prettier.
- Release: Changesets + GitHub Actions, publishing to the private `@quami` npm scope.
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
| `pnpm test:supabase`                  | Run only Supabase-backed suites (`*supabase*` test files) with `WA_LI_REQUIRE_SUPABASE=1`; they must fail, not skip, when Supabase is down |
| `pnpm registry:build`                 | `shadcn build registry/registry.json -o apps/web/registry-dist` (no-op until the manifest exists)                                          |
| `pnpm format` / `pnpm format:check`   | Prettier                                                                                                                                   |
| `pnpm changeset`                      | Record a release note for `@quami/wa-li`                                                                                                   |
| `pnpm --filter @quami/wa-li <script>` | Run a script in one workspace                                                                                                              |

**Done gate for every change:** `pnpm install && pnpm build && pnpm typecheck && pnpm lint && pnpm test`.

## Layout and ownership

```
packages/wa-li/            @quami/wa-li
  src/index.ts             main entry: createWhatsApp, types, errors, utils, transports
  src/{types,errors,utils,client,transport,webhook,core,agents,inbox}/
  src/adapters/types.ts    WhatsAppAdapter interface
  src/adapters/memory/     @quami/wa-li/adapters/memory
  src/adapters/supabase/   @quami/wa-li/adapters/supabase
  src/adapters/contract/   @quami/wa-li/adapters/contract (shared adapter suite)
  src/next/                @quami/wa-li/next
  src/cli/                 wa-li bin (doctor, accounts add)
  test/fixtures/           anonymized Meta webhook payloads
  test/                    build-output guards and integration tests
registry/                  registry.json + items/{wa-li-webhook,wa-li-schema,wa-li-inbox}
supabase/                  local Supabase project (migrations mirror registry/items/wa-li-schema)
apps/web/                  registry.quami.dev: token-protected /r/[name].json + docs
apps/playground/           Next.js + Supabase app that installs from the local registry
.claude/skills/            emilkowalski/skills (committed)
```

Rules:

- Root config (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`) is shared. Do not change it for a single ticket; put workspace-specific settings in that workspace (`package.json`, `tsconfig.json`, `turbo.json` with `"extends": ["//"]`, its own `eslint.config.mjs` for Next apps).
- Add dependencies to the workspace that uses them (`pnpm --filter <name> add <dep>`), not the root.
- New package subpaths need an entry in `packages/wa-li/tsup.config.ts` **and** the `exports` map.
- The main entry (`@quami/wa-li`) must never import `next`, `@supabase/supabase-js` or `vitest`, directly or through shared chunks. `packages/wa-li/test/main-entry-guard.test.ts` enforces this against the built `dist/`.
- Storage always goes through the `WhatsAppAdapter`; the memory and Supabase adapters must both pass the contract suite.

## Code rules

- No `any`, no `@ts-ignore`; `const` by default; `import type` for types.
- Tests are colocated (`foo.ts` + `foo.test.ts`), test behaviour not implementation, cover error paths and tenant isolation, use factory functions for test data, and never use snapshots. No test may require real Meta credentials.
- Keep comments minimal.
- **No tokens in logs, errors or stored rows.** Access tokens are resolved per call through `resolveToken(account)` and never persisted. The logger redacts `Authorization` headers, `access_token` params and every resolved token value. Error messages and `toJSON()` output must not contain tokens.
- Graph API version lives in one exported constant, overridable in config.

## UI rules (registry inbox, `apps/web`, `apps/playground`)

All UI follows the emilkowalski skills in `.claude/skills/`.

- Use **`emil-design-eng`** by default for every UI task (durations, easing, which properties to animate, polish).
- Run **`find-animation-opportunities`** on a screen **before** adding any motion to it.
- Run **`review-animations`** and **`break-ui`** before publishing (or changing) a registry item. Fix every finding or justify it in that item's `MOTION.md`.
- Use `apple-design` for springs, gestures, materials and reduced-motion behaviour.

Per-screen process:

1. Build the screen static, with hover and press states on every interactive element, and no motion.
2. Run `find-animation-opportunities`; save the result as `MOTION.md` next to the component (inbox: `registry/items/wa-li-inbox/MOTION.md`) with each kept motion's recipe and each rejected candidate's reason.
3. Implement only the kept motions.
4. Run `review-animations`; fix or justify in `MOTION.md`.
5. Run `break-ui` with the edge-case fixtures in `apps/playground/fixtures/inbox/`.

Motion rules:

- **Animate only `transform` and `opacity`.** Never `height`, `width`, `padding` or `margin`.
- Every motion has a purpose (feedback, spatial consistency, state indication, preventing a jarring change, explanation, delight). Frequent actions get no decorative motion.
- Durations: press 100–160 ms, tooltips 125–200 ms, menus 150–250 ms, dialogs/sheets 200–500 ms, everything else under 300 ms. Use the `--wa-*` motion tokens.
- `ease-out` to enter, `ease-in-out` for on-screen movement, never `ease-in`. Prefer custom `cubic-bezier()`.
- Response starts on pointer-down; animations are interruptible from the current value.
- CSS transitions by default; `motion` only for springs and gestures, and only in the registry inbox item (never in the npm package).
- `prefers-reduced-motion: reduce`: keep opacity and colour transitions, remove transform movement.
- All inbox strings come from `InboxStrings` (Spanish defaults).
