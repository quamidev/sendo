# Deploying `sendo.quami.dev` and `registry.sendo.quami.dev`

How `apps/web` goes live on Vercel: the marketing site and docs at `sendo.quami.dev`, and the shadcn registry at `registry.sendo.quami.dev`. One Vercel project and one deployment serve both domains. The npm release is a separate flow, described in [`release.md`](release.md).

- **Who:** someone with access to the Vercel team and DNS access to `sendo.quami.dev`.
- **What lives in code:** [`apps/web/vercel.json`](../apps/web/vercel.json) (install, build, `www` redirect), the Node version (`engines` in [`apps/web/package.json`](../apps/web/package.json)), the registry host rule ([`apps/web/proxy.ts`](../apps/web/proxy.ts)) and the registry cache headers ([`apps/web/lib/registry/handler.ts`](../apps/web/lib/registry/handler.ts)).
- **What doesn't:** creating the Vercel project, attaching domains, DNS records and environment values. Those are the manual steps below.
- **When:** after the first npm release (`0.1.0`, see [`release.md`](release.md)). The header's version badge reads `packages/sendo/package.json` at build time, and the site's install commands point at the published package and the renamed registry items.

## Vercel project

Create one project from the GitHub repo (`quamidev/sendo`) with these settings:

| Setting                                                    | Value                                                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework preset                                           | Next.js (also pinned by `"framework": "nextjs"` in `vercel.json`)                                                                                                           |
| Root Directory                                             | `apps/web`                                                                                                                                                                  |
| Include files outside the root directory in the Build Step | **Enabled** (the build needs `packages/sendo`, `registry/` and `scripts/`)                                                                                                  |
| Install Command                                            | from `vercel.json`: `cd ../.. && pnpm install --frozen-lockfile` (installs the whole workspace from the monorepo root)                                                      |
| Build Command                                              | from `vercel.json`: `pnpm turbo run build --filter=web`                                                                                                                     |
| Output Directory                                           | default (`.next`)                                                                                                                                                           |
| Node.js Version                                            | **22.x**. `apps/web/package.json` declares `"engines": { "node": "22.x" }`, which overrides the dashboard setting; set the dashboard to 22.x too so the two never disagree. |
| Production branch                                          | `main`                                                                                                                                                                      |

Leave the Install and Build Command overrides in the dashboard **off**: `vercel.json` sets both.

What the build does: Turborepo builds `@quami/sendo` (`^build`), then `registry#build` (writes the registry JSON into `apps/web/registry-dist/`), then `web` (`scripts/build-llms.mjs` and `next build`). `next.config.ts` traces `registry-dist/**` into the `/r` and `/r/[name]` functions, so the registry files ship with the deployment. Vercel's Remote Cache is used by Turborepo automatically.

The workspace pins `pnpm@10.34.6` in the root `packageManager` field. Set `ENABLE_EXPERIMENTAL_COREPACK=1` (see the env table) so Vercel uses exactly that version instead of picking one from the lockfile.

## Domains

Add all three to the same project (Settings → Domains):

| Domain                     | Role                                                                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendo.quami.dev`          | **Primary** production domain: site, docs, `/api/demo`, `llms.txt`.                                                                                                                                                                                                                      |
| `www.sendo.quami.dev`      | Optional. 308 to `sendo.quami.dev`, path and query kept. `vercel.json` has the rule (`redirects` with a `host` condition). You may also set it as a domain-level redirect in the dashboard ("Redirect to `sendo.quami.dev`", 308); both give the same result, so either alone is enough. |
| `registry.sendo.quami.dev` | Same project, same deployment, no redirect. `proxy.ts` serves `/r` and `/r/*` on this host, rewrites `/` to the JSON index (`/r`), and sends every other path to `https://sendo.quami.dev{path}` with a 308.                                                                             |

`connect.sendo.quami.dev` and `app.sendo.quami.dev` belong to the Sendo Connect project, not this one. Don't add them here.

### DNS records

`sendo.quami.dev` and its subdomains live in the `quami.dev` zone, which is on Namecheap (Advanced DNS). Add one `CNAME` per host; Vercel's Domains page shows the exact target for each one (it looks like `<hash>.vercel-dns-017.com`, as for `spendly.quami.dev`), so use Vercel's value.

| Type    | Host (in `quami.dev`) | Value                   | Purpose                    |
| ------- | --------------------- | ----------------------- | -------------------------- |
| `CNAME` | `sendo`               | the target Vercel shows | `sendo.quami.dev`          |
| `CNAME` | `www.sendo`           | the target Vercel shows | `www.sendo.quami.dev`      |
| `CNAME` | `registry.sendo`      | the target Vercel shows | `registry.sendo.quami.dev` |

- `www.sendo` is optional: skip it and the `vercel.json` redirect simply never matches.
- `.dev` is on the HSTS preload list: browsers only use HTTPS. Wait until Vercel shows a valid certificate for each domain before announcing anything.
- Sendo Connect adds `connect.sendo` and `app.sendo` to the same zone, pointing at its own Vercel project.

## Environment variables

Set these for **Production** (and Preview where noted). Everything `apps/web` reads from `process.env` is listed; nothing else is needed.

| Variable                                             | Required                      | Value / notes                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_EXPERIMENTAL_COREPACK`                       | Recommended                   | `1`. Build-time only: makes Vercel use the `packageManager` pnpm version (`10.34.6`).                                                                                                                                                    |
| `SENDO_REGISTRY_DIST_DIR`                            | No, leave unset               | Override for the folder holding the built registry JSON. Unset means `<function cwd>/registry-dist`, which is where the build writes it and what `next.config.ts` traces into the functions. Set it only if you move that output.        |
| `SENDO_REGISTRY_TOKENS`                              | Only for private items        | Comma-separated bearer tokens that unlock items with `meta.private: true`. No item is private today; unset means private items get 401 (fail closed) and the catalog hides them. Public items never need a token. Mark it **Sensitive**. |
| `SENDO_REGISTRY_ALLOW_ANONYMOUS`                     | **Never in production**       | See the warning below. Local development only.                                                                                                                                                                                           |
| `AI_GATEWAY_API_KEY`                                 | Yes, if the demo uses a model | Vercel AI Gateway key, read by the AI SDK's `gateway` provider. On Vercel the gateway can also authenticate with the project's OIDC token, but set the key explicitly so the demo doesn't depend on that. Mark it **Sensitive**.         |
| `SENDO_DEMO_MODEL`                                   | Yes, for live answers         | Gateway model id, e.g. `openai/gpt-5-mini`. Unset: the demo answers with scripted replies only (no model calls).                                                                                                                         |
| `SENDO_DEMO_BUDGET_USD`                              | Yes, for live answers         | Monthly model budget in USD, e.g. `20`. Unset or `0`: no model calls (scripted fallback).                                                                                                                                                |
| `SENDO_DEMO_DAILY_CAP`                               | Yes                           | Integer: model-answered messages per UTC day for all visitors together, e.g. `500`. Past it the demo falls back to scripted replies. Unset or invalid: no daily cap.                                                                     |
| `SENDO_DEMO_SECRET`                                  | Yes                           | Random secret (e.g. `openssl rand -base64 32`) that signs the per-session message counter token. Unset: a random secret per server instance, so tokens stop verifying across instances and cold starts. Mark it **Sensitive**.           |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN`               | Yes (one pair)                | Redis REST store for the demo counters (per IP, per day, monthly spend). Added automatically when you connect an Upstash Redis store from the Vercel Marketplace (Storage tab).                                                          |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Alternative to `KV_*`         | Same store, Upstash's own variable names. `KV_*` wins when both are set. With neither pair, the counters live in each instance's memory, so the daily cap and budget aren't global.                                                      |

Vercel sets `NODE_ENV` and `VERCEL_*` itself; don't set them. Turborepo runs in loose env mode (`turbo.json`), so all of these reach the build and the functions without being listed anywhere else.

> [!WARNING]
> **Do not set `SENDO_REGISTRY_ALLOW_ANONYMOUS` in production (or Preview).** With `SENDO_REGISTRY_ALLOW_ANONYMOUS=1`, `/r/<name>.json` serves **private client items without a token**. Public items need no flag at all. It exists only for local development. (The technical spec's env list includes it; that line is wrong and is overridden here.) If it is ever set by mistake, remove it and redeploy, and treat any private item as exposed.

## No cron jobs

This project has no scheduled work: `vercel.json` has no `crons`, and nothing in `apps/web` needs one. The demo counters expire on their own (Redis TTLs, or in-memory expiry). Only the Sendo Connect project uses Vercel Cron.

## Caching

- Public registry JSON (items, aliases, a catalog with only public items): `Cache-Control: public, max-age=300, s-maxage=3600` — browsers keep it 5 minutes, Vercel's CDN 1 hour. A new production deployment purges the CDN cache, so a registry change is live as soon as its deploy is.
- Private items, and the catalog whenever it has private items: `private, no-store`.
- Errors (400/401/404/500): `no-store`.
- Legacy names (`/r/sendo-<x>.json`, until `0.2.0`) return the same body and headers as `/r/<x>.json`.

## Post-deploy checks

Run after the first production deploy and after any change to `proxy.ts`, `vercel.json`, the registry or the env.

```bash
SITE=https://sendo.quami.dev
REG=https://registry.sendo.quami.dev

# 1. Registry item: 200, JSON, public cache header (a second request shows x-vercel-cache: HIT).
curl -sI "$REG/r/webhook.json" | grep -iE '^(HTTP|content-type|cache-control|x-vercel-cache)'
#   HTTP/2 200
#   cache-control: public, max-age=300, s-maxage=3600
#   content-type: application/json; charset=utf-8

# 2. Legacy alias: same body and headers as the new name.
curl -sI "$REG/r/sendo-webhook.json" | grep -iE '^(HTTP|cache-control)'
diff <(curl -s "$REG/r/webhook.json") <(curl -s "$REG/r/sendo-webhook.json") && echo "alias OK"

# 3. Registry host: non-registry paths 308 to the site; / is the JSON index.
curl -sI -H 'Host: registry.sendo.quami.dev' "$SITE/pricing" | grep -iE '^(HTTP|location)'
#   HTTP/2 308
#   location: https://sendo.quami.dev/pricing
curl -s "$REG/" | head -c 300; echo
curl -s "$REG/r/registry.json" | head -c 300; echo   # lists only public items

# 4. www → apex.
curl -sI https://www.sendo.quami.dev/pricing | grep -iE '^(HTTP|location)'
#   HTTP/2 308
#   location: https://sendo.quami.dev/pricing

# 5. Language redirect: / goes to /en or /es.
curl -sI "$SITE/" | grep -iE '^(HTTP|location)'                              # 307 → /en
curl -sI -H 'Accept-Language: es-GT,es;q=0.9' "$SITE/" | grep -i '^location'  # → /es
curl -sI -H 'Cookie: sendo-lang=es' "$SITE/pricing" | grep -i '^location'      # → /es/pricing

# 6. hreflang alternates (es, en, x-default) on both languages.
for l in en es; do curl -s "$SITE/$l" | grep -oi 'hreflang="[^"]*" href="[^"]*"'; done

# 7. Set-Cookie audit: no response sets a cookie (the site's only cookie, sendo-lang,
#    is written in the browser when the visitor picks a language).
for p in / /en /es /en/pricing /es/compare /en/changelog /docs /docs/quickstart /llms.txt; do
  curl -sI -H 'Accept-Language: es' "$SITE$p" | grep -i '^set-cookie' && echo "  ^ from $p"
done
for p in / /r /r/webhook.json /r/sendo-webhook.json /pricing; do
  curl -sI "$REG$p" | grep -i '^set-cookie' && echo "  ^ from registry $p"
done
curl -s -D - -o /dev/null -X POST "$SITE/api/demo" \
  -H 'content-type: application/json' -H "origin: $SITE" \
  -d '{"transcript":[],"text":"hola","lang":"es"}' | grep -iE '^(HTTP|set-cookie)'
# Expected: no set-cookie lines at all; the demo answers HTTP/2 200.

# 8. No analytics or third-party scripts.
curl -s "$SITE/en" | grep -oiE '<script[^>]+src="[^"]+"' | grep -v '/_next/' || echo "no third-party scripts"
```

Then in a browser (private window):

- Open `https://sendo.quami.dev`, switch to Español in the header, and check DevTools → Application → Cookies: the only cookie is `sendo-lang` (value `es`, one year, `SameSite=Lax`). Reloading `/` now goes to `/es`.
- Send a message in the home demo: it answers in the page's language. With `SENDO_DEMO_MODEL`, `SENDO_DEMO_BUDGET_USD` and `AI_GATEWAY_API_KEY` set, the answer is from the model, not the scripted fallback note.
- Run the post-publish smoke in [`release.md`](release.md#post-publish-smoke): `npx shadcn add @sendo/webhook` in a scratch app installs from `https://registry.sendo.quami.dev/r/webhook.json`.

## Manual setup, in order

1. Release `@quami/sendo@0.1.0` ([`release.md`](release.md)) and merge the feature branch to `main`.
2. Create the Vercel project from `quamidev/sendo`: Root Directory `apps/web`, "Include files outside the root directory" enabled, Node.js 22.x, no command overrides.
3. Connect an Upstash Redis store to the project (Storage → Marketplace), which adds `KV_REST_API_*`.
4. Set the env table's values for Production: `ENABLE_EXPERIMENTAL_COREPACK=1`, `AI_GATEWAY_API_KEY`, `SENDO_DEMO_MODEL`, `SENDO_DEMO_BUDGET_USD`, `SENDO_DEMO_DAILY_CAP`, `SENDO_DEMO_SECRET`; `SENDO_REGISTRY_TOKENS` only once a private item exists. Do **not** set `SENDO_REGISTRY_ALLOW_ANONYMOUS`.
5. Deploy `main` and check the build log shows `registry#build` and `web#build`.
6. Add the domains `sendo.quami.dev` (primary), `www.sendo.quami.dev` and `registry.sendo.quami.dev`, then create the DNS records and wait for valid certificates.
7. Run the post-deploy checks above.
8. Submit the shadcn registry index PR ([`shadcn-registry-index.md`](shadcn-registry-index.md)).
