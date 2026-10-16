# Releasing `@quami/sendo`

How a release goes out, and the one-time steps for the first public release (`0.1.0`). Releases run through Changesets and `.github/workflows/release.yml`; nobody publishes from a laptop.

- **Who:** a maintainer with admin access to the GitHub repo and owner access to the `@quami` npm scope.
- **Flow:** changesets land on `main` → the release workflow opens or updates the **"chore: version packages"** PR → merging that PR makes the same workflow build and publish to npm with provenance.

## The changesets guard (`pnpm check:changesets`)

While `@quami/sendo` is `0.x`, a `major` changeset would publish `1.0.0` instead of the next `0.x`. `scripts/check-changesets.mjs` reads every pending `.changeset/*.md` (not `README.md` or `config.json`) and exits 1, naming each file, if any declares `"@quami/sendo": major`. It also fails on a frontmatter line it can't read.

```bash
pnpm check:changesets
# check-changesets: 19 pending changeset(s) for @quami/sendo@0.0.0 (18 minor, 1 patch), none major.
```

It runs in CI (`check` job, "Changesets guard" step) and again in the release workflow before versioning. If it fails, change that changeset's bump to `minor`: in `0.x`, breaking changes are minor bumps. Going to `1.0.0` on purpose means removing this guard in the same PR.

## Pre-merge checks

Before merging anything that will produce the first release:

1. **PR #2 is merged into `main` first.** The feature branch is built on top of it, so merge PR #2, then the feature branch.
2. **The GitHub repo is public and named `quamidev/sendo`.** npm provenance only works from a public repository, and npm rejects the publish if `repository.url` in `packages/sendo/package.json` (`git+https://github.com/quamidev/sendo.git`) doesn't match the repo the workflow runs in. Rename the repo before the first publish.
3. **The npm Trusted Publisher is configured.** There is no `NPM_TOKEN` secret: the release job authenticates to npm with its GitHub OIDC token. On https://www.npmjs.com/package/@quami/sendo/access, "Trusted Publisher" must list GitHub Actions with organization `quamidev`, repository `sendo` and workflow `release.yml` (case-sensitive; no environment). npm only lets you configure this on a package that exists, so the package was created by hand once: npm registered it with its own empty `0.0.0-stage` placeholder (staged publishing), which is the only version before `0.1.0`. The workflow upgrades npm to 11 because Trusted Publishing needs npm >= 11.5.1.
4. **The changesets guard passes:** `pnpm check:changesets` locally, and the "Changesets guard" step is green.
5. **CI is green** on the PR: both the `check` job (Node 22 and 24) and the `supabase` job.

## Confirm the version PR bumps to exactly `0.1.0`

After the changesets reach `main`, the release workflow opens **"chore: version packages"**. Before merging it, open its diff and check:

- `packages/sendo/package.json` goes from `"version": "0.0.0"` to `"version": "0.1.0"`. Not `1.0.0`, not `0.0.1`.
- `packages/sendo/CHANGELOG.md` has a `## 0.1.0` section with the release notes.
- Every pending `.changeset/*.md` is deleted (only `README.md` and `config.json` stay).

If the version is anything other than `0.1.0`, **don't merge**. Close the PR, fix the offending changeset on `main` (`pnpm check:changesets` names it), and let the workflow regenerate the PR.

Merging the PR triggers the workflow again. With no changesets left, it runs `pnpm release` (`turbo run build --filter=@quami/sendo && node scripts/release-publish.mjs && changeset tag`), which publishes `@quami/sendo@0.1.0` with public access and pushes the `@quami/sendo@0.1.0` git tag. `scripts/release-publish.mjs` calls `npm publish` directly (its output is in the workflow log), skips a version that is already on npm, and fails if npm exits 0 but the version never shows up on the registry. It replaces `changeset publish`, which publishes through `pnpm publish`: for 0.1.0 that reported success, and created the tag, without anything reaching npm.

## Provenance

The workflow publishes through npm Trusted Publishing with provenance: the job has `permissions: id-token: write` (the GitHub OIDC token npm exchanges for a short-lived publish credential and uses to sign the attestation) and the publish step sets `NPM_CONFIG_PROVENANCE=true`. No npm token is stored anywhere.

After the publish, verify on https://www.npmjs.com/package/@quami/sendo:

- The version is `0.1.0` and it is tagged `latest`.
- The page shows the **Provenance** section ("Built and signed on GitHub Actions"), and its links point to `quamidev/sendo`, the release commit and the `Release` workflow run.
- From a terminal: `npm view @quami/sendo@0.1.0 dist.attestations` prints an attestation URL. In the smoke project below, `npm audit signatures` reports verified attestations for `@quami/sendo`.

If the publish step fails with an auth (`ENEEDAUTH`, 404 on PUT) or provenance error, the usual causes are a Trusted Publisher whose organization, repository or workflow file name doesn't match exactly (see pre-merge check 3), a private repo, a `repository.url` mismatch (see pre-merge check 2), npm older than 11.5.1 or a missing `id-token: write`.

## Post-publish smoke

Run it from an empty folder outside this repo, so nothing resolves to the workspace copy.

```bash
pnpm create next-app@latest sendo-smoke --yes
cd sendo-smoke
pnpm add @quami/sendo ai zod
```

1. **Installs:** `pnpm add` finishes without errors and without unmet peer dependency warnings for `ai` or `zod`. `pnpm list @quami/sendo` shows `0.1.0`.
2. **CLI help is English:** `npx sendo --help` exits 0 and prints the commands (`doctor`, `accounts`, `rules`, `mcp`) with English descriptions and no Spanish text.
3. **Types resolve:** create `sendo-smoke.ts`:

   ```ts
   import { createSendo } from "@quami/sendo";

   export type Sendo = ReturnType<typeof createSendo>;
   ```

   Then `npx tsc --noEmit` exits 0.

Record the result (pass or the failing step and output) in the release's build log. If a step fails, fix it on `main` with a `patch` changeset; npm versions can't be republished.

## Switch MIDI Med and apartments to the npm package

Done in those repos, not here. In each app:

1. Replace the local path dependency (`file:` / `link:` to this repo) with the published package and reinstall:

   ```bash
   pnpm add @quami/sendo@^0.1.0
   ```

2. Keep the apps in Spanish. The package now defaults to English, so pass the locale where the app creates its client (usually `lib/sendo.ts`):

   ```ts
   export const sendo = createSendo({
     // ...existing options
     locale: "es",
   });
   ```

3. Set the registry UI locale. `lib/sendo-ui.ts` is introduced by later tickets of this release (the locale work in the registry UI items) and is copied into the app when the UI items are installed or updated with `npx shadcn add @sendo/<name>`. It ships with `sendoLocale = "en"`; change it to:

   ```ts
   export const sendoLocale: SendoLocale = "es";
   ```

4. Run the app's own `typecheck`, `lint` and tests, and click through the inbox to confirm the strings, dates and system lines are in Spanish.

The old `sendo-*` registry item names keep resolving until `0.2.0`, so existing installs don't break, but new commands should use the `@sendo/<name>` form.
