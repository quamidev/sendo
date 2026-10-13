# Listing `@sendo` in the shadcn registry index

Once `@sendo` is in shadcn's registry index, `npx shadcn add @sendo/webhook @sendo/schema` works in any project without editing `components.json`. Until the listing is merged, the quickstart shows the one-line `components.json` fallback:

```json
{ "registries": { "@sendo": "https://registry.sendo.dev/r/{name}.json" } }
```

A human submits the listing; nothing in this repo does it automatically.

## Before you submit

- `https://registry.sendo.dev/r/registry.json` and every item (`https://registry.sendo.dev/r/webhook.json`, …) answer `200` without a token. Items are public unless `meta.private` is set; none are private today.
- The catalog lists only the current names (`webhook`, `schema`, `inbox`, `numbers`, `workflows`, `broadcasts`, `metrics`, `widgets`, `drizzle-schema`, `prisma-schema`). The old `sendo-*` names still resolve as aliases until `0.2.0` but are not listed.
- The repository is public at `https://github.com/quamidev/sendo` (MIT).
- Check shadcn's current rules on <https://ui.shadcn.com/docs/registry/registry-index> before opening the PR. When this was written they were: open source and publicly reachable, valid against the registry schema, flat (`registry.json` and `<name>.json` side by side) and no `content` in the catalog's `files`.

## Steps

1. Fork `shadcn-ui/ui` and add the entry below to `apps/v4/registry/directory.json`, keeping the file's alphabetical order.
2. Run `pnpm validate:registries` in the fork.
3. Open a pull request to `shadcn-ui/ui` with the description below.
4. After it merges, check `npx shadcn add @sendo/webhook` in a fresh Next.js app with no `registries` entry, then make the quickstart fallback optional or remove it.

## Entry for `apps/v4/registry/directory.json`

```json
{
  "name": "@sendo",
  "homepage": "https://sendo.dev",
  "url": "https://registry.sendo.dev/r/{name}.json",
  "description": "WhatsApp Cloud API for Next.js: webhook route, Supabase schema, team inbox, numbers, rules, broadcasts and metrics screens, backed by the @quami/sendo npm package.",
  "logo": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='var(--foreground)'/><path d='M9 11l2.5 10L16 13l4.5 8L23 11' fill='none' stroke='var(--background)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/></svg>"
}
```

The logo is `apps/web/app/icon.svg` with the colours swapped for the theme variables, so it follows light and dark mode in the directory.

## Pull request text

> **Add `@sendo` registry**
>
> Sendo adds WhatsApp to a Next.js app: a webhook route, Supabase migrations and team inbox screens, copied into the app with the shadcn CLI. The protocol logic (signature checks, parsing, sending) lives in the `@quami/sendo` npm package, so the registry ships only the parts an app is expected to edit.
>
> - Homepage: https://sendo.dev
> - Registry: https://registry.sendo.dev/r/registry.json
> - Source: https://github.com/quamidev/sendo (MIT)
> - Try it: `npx shadcn add @sendo/webhook @sendo/schema`
>
> `pnpm validate:registries` passes locally.
