# workflows — notes for agents

The rules screen and the tick route, on top of `@quami/sendo`. Installed by
`npx shadcn add @sendo/workflows`. Needs `lib/sendo.ts` (`@sendo/webhook`) and the Sendo
schema (`@sendo/schema`, v2 or later: `sendo_rules`). English and Spanish: the page passes the required
`locale` prop from `sendoLocale` in `lib/sendo-ui.ts` (default `en`).

## Files

| File                                                                                     | What it is                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(protected)/inbox/rules/page.tsx`                                                   | The rules screen (server component). Admin only (`rules.manage`); others see "You don't have access to Rules" (`RulesNotice`). Passes `locale={sendoLocale}`; `generateMetadata` reads `pageTitle`. |
| `app/(protected)/inbox/rules/actions.ts`                                                 | Server actions `listRules`, `saveRule`, `toggleRule`, `reorderRules`, `deleteRule`. Each calls `requireUser()` first, then `sendo.actor()` + `rules.manage`.                                        |
| `app/(protected)/inbox/rules/rules-config.ts`                                            | `requireUser()` (**app-owned, implement it**; fails closed until you do) and optional `resolveUserNames()`.                                                                                         |
| `app/api/sendo/tick/route.ts`                                                            | `GET`/`POST` → `sendo.maintenance.tick()`, behind `Authorization: Bearer <SENDO_CRON_SECRET>`. `maxDuration = 60`.                                                                                  |
| `components/sendo/workflows/rules-screen.tsx`                                            | `RulesScreen`: list with on/off, move up/down, edit, delete; empty state; delete confirmation. Props `locale`, `formatLocale`, `strings`. `RulesNotice` (`kind`, `locale`).                         |
| `components/sendo/workflows/rule-row.tsx`                                                | One rule: name, type, number, summary, origin badge, last edit. Invalid stored rules render as error rows.                                                                                          |
| `components/sendo/workflows/rule-editor.tsx`                                             | Side sheet: type (create only), name, number, then the typed form.                                                                                                                                  |
| `components/sendo/workflows/business-hours-fields.tsx`                                   | Time zone, weekly schedule (up to 12 ranges per day), holidays, after-hours message, applies-to.                                                                                                    |
| `components/sendo/workflows/rule-fields.tsx`                                             | Route, auto-assign, escalate and auto-close forms.                                                                                                                                                  |
| `components/sendo/workflows/{drafts,validation,summary}.ts`                              | Form state ↔ params, validation with the package schemas (issues mapped to strings), row summaries.                                                                                                 |
| `components/sendo/workflows/strings.ts`                                                  | `WorkflowsStrings`, `workflowsStrings = { es, en }`, `resolveWorkflowsStrings(locale, overrides)`, `workflowsFormat(formatLocale)`. Server-safe (no React).                                         |
| `components/sendo/workflows/strings-context.tsx`                                         | Context `{ strings, locale, formatLocale }`; `WorkflowsStringsProvider`, `useWorkflowsStrings()`, `useWorkflowsFormat()`.                                                                           |
| `components/sendo/workflows/{types,press}.ts`, `form-parts.tsx`, `use-reorder-motion.ts` | View types, motion recipes, form building blocks, reorder slide.                                                                                                                                    |
| `lib/sendo-ui.ts`                                                                        | `SendoLocale` and `sendoLocale`, the language of every Sendo screen. Every UI item ships the same file. **Yours**: set it.                                                                          |

## Don't touch (and why)

- **Validation comes from the package.** Forms validate with `ruleParamsSchemas` and `ruleKeySchema` from
  the client-safe `@quami/sendo/rules` subpath (`validation.ts`; client components never import values from
  the main entry, which would bundle the server runtime); `saveRule` validates again and `sendo.rules.upsert` a
  third time. Don't
  add rules of your own in the form: change the schema in the package. The schemas' own messages are English
  (they also serve the CLI); `validation.ts` maps every issue by its zod code and path (`invalid_type`,
  `too_small`, `too_big`, `invalid_value`, `invalid_format` on `schedule`/`holidays`/`match.source`, `custom`
  on `timezone`/`schedule`) to `WorkflowsStrings` in the screen's locale, and keeps the English message for
  an issue it doesn't know. A new check in the schema needs a string and a case there. `saveRule` validates
  with `sendoLocale`, so its field errors match the screen.
- **Names are keys.** A rule is upserted by `(tenant, key)`, and system lines in the inbox quote the key
  («Turno cobranza»). The name can't be changed after creation (that would create a second rule), and
  `saveRule` refuses a new rule whose name another rule uses. The type can't change either.
- **Stored params may be invalid** (edited in SQL, or an older schema). `sendo.rules.list` returns
  `valid`/`error`; the row shows the error and the engine ignores the rule. `draftsFromRule` reads params
  defensively so the editor always opens; saving goes through validation.
- **Code-defined rules** (`origin: "code"`, from `npx @quami/sendo rules sync`) show a "From code" badge.
  Edits here are kept unless someone syncs with `--force`; a deleted code rule comes back on the next sync.
- **Order** is the evaluation order (`position`): route rules are first-match-wins. `reorderRules` sends the
  whole order.
- **Permissions live in the package.** Every `sendo.rules.*` call throws `FORBIDDEN` without `rules.manage`
  (admins only). Don't remove the checks from `actions.ts`; add your own on top if you need them.
- **Edits record `updated_by`** (the actor's `userId`). `resolveUserNames(ids)` in `rules-config.ts` turns
  them into names ("Edited by Ana"); without it rows say "Edited by you" or just the date.
- Strings: every text is in `WorkflowsStrings` (`strings.ts`, one object per `SendoLocale`); pass
  `strings={{ ... }}` to `<RulesScreen />` to override single keys on top of `locale`. String functions that
  show a count take `format` (`useWorkflowsFormat()`), so counts, plurals, lists and dates follow
  `formatLocale`. The actions' `message` is an English detail for logs; the screen shows `errorMessages[code]`.
- Language: `sendoLocale` in `lib/sendo-ui.ts` (`en` or `es`) is the required `locale` of `<RulesScreen>` and
  `<RulesNotice>`; pass `formatLocale` (e.g. `es-GT`) for regional numbers and dates. To add a language,
  extend `SendoLocale` and follow the type errors (`workflowsStrings`). Docs: `/docs/languages`.
- Motion: see `MOTION.md` (only transform/opacity; reduced motion keeps the fades).

## The tick route

`sendo.maintenance.tick()` runs after-hours bookkeeping, escalations, auto-close, broadcast batches,
billing re-checks and the daily event prune. It is lock-guarded (`tick`, 120 s), so overlapping calls
return `{ skipped: true }`. Call the route **every minute**:

- Set `SENDO_CRON_SECRET` (any long random string). Requests need `Authorization: Bearer <secret>`;
  anything else, or no secret configured, gets `401`. Vercel's `CRON_SECRET` is accepted too, because
  Vercel Cron sends that one.
- Vercel: `vercel.json` → `{ "crons": [{ "path": "/api/sendo/tick", "schedule": "* * * * *" }] }`
  (every minute needs a Pro plan; Hobby runs crons once a day).
- Supabase: `pg_cron` + `pg_net` calling `net.http_post` with the bearer header (see the docs page).
- The response is the `TickReport` JSON (`skipped`, `steps.*.count/errors`, `escalations`, `durationMs`).

## Connects to

- Env: `SENDO_CRON_SECRET` (or Vercel's `CRON_SECRET`) for the tick route, see above.
- `resolveRole` in `createSendo`: only `admin` has `rules.manage`.
- Code-defined rules: `npx @quami/sendo rules sync --config lib/sendo-rules.ts --tenant <id>`.

### Implementing `requireUser()`

Return `{ userId, tenantId }` for the signed-in user (or redirect to your login). `sendo.actor(userId,
tenantId)` then resolves the role through `resolveRole` in `createSendo` (`lib/sendo.ts`); without
`resolveRole` every user gets "You don't have access to Rules". If you also installed `inbox`, return the
same user as `app/(protected)/inbox/inbox-config.ts`.

## Verify

1. `curl -i https://<your-domain>/api/sendo/tick` → `401`; with `-H "Authorization: Bearer $SENDO_CRON_SECRET"` →
   `200` and a `TickReport` JSON (`skipped: true` if another tick holds the lock).
2. As an admin, `/inbox/rules` lists the rules; create a business-hours rule and toggle it. Other roles see
   "You don't have access to Rules".
3. Send a message outside business hours: the after-hours reply goes out once and a system line names the rule.
4. Set `sendoLocale` to Spanish (`es`): the screen, the editor's validation messages, the notice and the page title
   switch to Spanish.
