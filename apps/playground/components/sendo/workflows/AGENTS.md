# sendo-workflows — notes for agents

The rules screen ("Reglas") and the tick route, on top of `@quami/sendo`. Installed by
`shadcn add @sendo/sendo-workflows`. Needs `lib/sendo.ts` (`@sendo/sendo-webhook`) and the Sendo
schema (`@sendo/sendo-schema`, v2 or later: `sendo_rules`).

## Files

| File                                                                                             | What it is                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/(protected)/inbox/rules/page.tsx`                                                           | The "Reglas" screen (server component). Admin only (`rules.manage`); others see "No tienes acceso".                                                          |
| `app/(protected)/inbox/rules/actions.ts`                                                         | Server actions `listRules`, `saveRule`, `toggleRule`, `reorderRules`, `deleteRule`. Each calls `requireUser()` first, then `sendo.actor()` + `rules.manage`. |
| `app/(protected)/inbox/rules/rules-config.ts`                                                    | `requireUser()` (**app-owned, implement it**; fails closed until you do) and optional `resolveUserNames()`.                                                  |
| `app/api/sendo/tick/route.ts`                                                                    | `GET`/`POST` → `sendo.maintenance.tick()`, behind `Authorization: Bearer <SENDO_CRON_SECRET>`. `maxDuration = 60`.                                           |
| `components/sendo/workflows/rules-screen.tsx`                                                    | List with on/off, move up/down, edit, delete; empty state; delete confirmation.                                                                              |
| `components/sendo/workflows/rule-row.tsx`                                                        | One rule: name, type, number, summary, origin badge, last edit. Invalid stored rules render as error rows.                                                   |
| `components/sendo/workflows/rule-editor.tsx`                                                     | Side sheet: type (create only), name, number, then the typed form.                                                                                           |
| `components/sendo/workflows/business-hours-fields.tsx`                                           | Time zone, weekly schedule (up to 12 ranges per day), holidays, after-hours message, applies-to.                                                             |
| `components/sendo/workflows/rule-fields.tsx`                                                     | Route, auto-assign, escalate and auto-close forms.                                                                                                           |
| `components/sendo/workflows/{drafts,validation,summary}.ts`                                      | Form state ↔ params, validation with the package schemas, row summaries.                                                                                     |
| `components/sendo/workflows/{strings,types,press}.ts`, `form-parts.tsx`, `use-reorder-motion.ts` | Spanish strings (`WorkflowsStrings`), view types, motion recipes, form building blocks, reorder slide.                                                       |

## Don't touch (and why)

- **Validation comes from the package.** Forms validate with `ruleParamsSchemas` and `ruleKeySchema` from
  the client-safe `@quami/sendo/rules` subpath (`validation.ts`; client components never import values from
  the main entry, which would bundle the server runtime); `saveRule` validates again and `sendo.rules.upsert` a
  third time. Don't
  add rules of your own in the form: change the schema in the package. Messages for generic issues
  (numbers, choices, missing values) are Spanish strings in `strings.ts`.
- **Names are keys.** A rule is upserted by `(tenant, key)`, and system lines in the inbox quote the key
  («Turno cobranza»). The name can't be changed after creation (that would create a second rule), and
  `saveRule` refuses a new rule whose name another rule uses. The type can't change either.
- **Stored params may be invalid** (edited in SQL, or an older schema). `sendo.rules.list` returns
  `valid`/`error`; the row shows the error and the engine ignores the rule. `draftsFromRule` reads params
  defensively so the editor always opens; saving goes through validation.
- **Code-defined rules** (`origin: "code"`, from `npx @quami/sendo rules sync`) show a "Desde código" badge.
  Edits here are kept unless someone syncs with `--force`; a deleted code rule comes back on the next sync.
- **Order** is the evaluation order (`position`): route rules are first-match-wins. `reorderRules` sends the
  whole order.
- **Permissions live in the package.** Every `sendo.rules.*` call throws `FORBIDDEN` without `rules.manage`
  (admins only). Don't remove the checks from `actions.ts`; add your own on top if you need them.
- **Edits record `updated_by`** (the actor's `userId`). `resolveUserNames(ids)` in `rules-config.ts` turns
  them into names ("Editada por Ana"); without it rows say "Editada por ti" or just the date.
- Strings: every text is in `WorkflowsStrings` (`strings.ts`); pass `strings={{ ... }}` to `<RulesScreen />`.
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
`resolveRole` every user gets "No tienes acceso a Reglas". If you also installed `sendo-inbox`, return the
same user as `app/(protected)/inbox/inbox-config.ts`.

## Verify

1. `curl -i https://<your-domain>/api/sendo/tick` → `401`; with `-H "Authorization: Bearer $SENDO_CRON_SECRET"` →
   `200` and a `TickReport` JSON (`skipped: true` if another tick holds the lock).
2. As an admin, `/inbox/rules` lists the rules; create a business-hours rule and toggle it. Other roles see
   "No tienes acceso a Reglas".
3. Send a message outside business hours: the after-hours reply goes out once and a system line names the rule.
