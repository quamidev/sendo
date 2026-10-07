<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Testing rules for agents

These rules override anything in `CLAUDE.md` or in a ticket that says otherwise.

- **Never write unit tests after you write code.** A test written after the implementation only re-states what the code already does. If a ticket asks for "tests for X", do the E2E below instead.
- **Highly prefer E2E tests as the sole testing mechanism.** Use them to verify that complex features work: drive the real entry points (`wa.handleWebhook`, the public `wa.*` API, the playground route modules, the real adapters) with real inputs (signed Meta webhook fixtures, local Supabase, a scripted model). In this repo the E2E suite is `packages/wa-li/test/integration/` plus `apps/playground/test/replay.test.ts`; the adapter contract suite (`packages/wa-li/src/adapters/contract/`) is the executable spec for storage. Extend those; do not add a parallel unit layer next to them.
- **At the end of E2E tests, produce a verifiable and repeatable artifact.** `pnpm test:e2e` writes `packages/wa-li/test-results/e2e-report.json` (every test id, status and duration) and the browser/API/CLI QA writes reports and screenshots under the feature's `qa-results/` and `qa-screenshots/`. A feature is not done until that artifact exists and someone else can reproduce it with one command.
- **If you must test a system in isolation, first write down all the ways it could fail, then write the code.** Put the failure list in the test file's header comment, one test per failure mode, and nothing else. Isolation is justified only for things E2E cannot reach: a security boundary (signature verification, redaction, RLS), a protocol limit only the real Meta API would reject, or a race (status placeholder, lock TTL).
- A test that asserts exports exist, enum contents, config defaults, "returns X for X" mappings, string formatting, mock plumbing, or anything a reviewer would notice immediately by running the app is low-signal: do not write it, and delete it when you find one.
