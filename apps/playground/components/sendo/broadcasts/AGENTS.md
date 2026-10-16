# broadcasts — notes for agents

The Broadcasts screen: send one APPROVED WhatsApp template to a contact list from your app, see who is
eligible before sending, and follow every recipient's result. Built on `sendo.broadcasts` from
`@quami/sendo`. Installed by `npx shadcn add @sendo/broadcasts`. Needs `lib/sendo.ts`
(`@sendo/webhook`), the Sendo schema v3 (`@sendo/schema`: `sendo_broadcasts`,
`sendo_broadcast_recipients`) and the every-minute tick (`@sendo/workflows` ships
`app/api/sendo/tick/route.ts`): without the tick, broadcasts stay "Queued". English and Spanish: the
page passes the required `locale` prop from `sendoLocale` in `lib/sendo-ui.ts` (default `"en"`).

## Files

| File                                                    | What it is                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(protected)/inbox/broadcasts/page.tsx`             | The Broadcasts screen (server component). Admin only (`broadcasts.manage`); others see "You don't have access to Broadcasts" (`BroadcastsNotice`). Passes `locale={sendoLocale}`; `generateMetadata` reads `pageTitle`. `?id=<broadcast>` opens a progress view, `?nuevo` the composer. |
| `app/(protected)/inbox/broadcasts/actions.ts`           | Server actions `listBroadcasts`, `getBroadcast`, `listRecipients`, `listTemplates`, `listAudiences`, `previewBroadcast`, `createBroadcast`, `cancelBroadcast`. Each calls `requireUser()` first, then `sendo.actor()` + `broadcasts.manage`.                                            |
| `app/(protected)/inbox/broadcasts/broadcasts-config.ts` | **App-owned, implement it:** `requireUser()` (fails closed until you do) and `broadcastAudiences` (your contact lists and filters; empty by default).                                                                                                                                   |
| `components/sendo/broadcasts/broadcasts-screen.tsx`     | List → composer → review → progress, with the open view mirrored in the URL. Props `locale`, `formatLocale`, `strings`.                                                                                                                                                                 |
| `components/sendo/broadcasts/broadcast-list.tsx`        | Broadcasts newest first: template, number, state, progress bar; "Load more".                                                                                                                                                                                                            |
| `components/sendo/broadcasts/broadcast-composer.tsx`    | Number, approved template (with preview and its category rule), variables, audience, rate; then the review: total / eligible / skipped by reason, estimated time, cost note, "Send to N contacts".                                                                                      |
| `components/sendo/broadcasts/broadcast-progress.tsx`    | Counts per state (polls `getBroadcast` every 5 s while queued/sending/paused), billing-pause / stopped / cancelled notices, "Cancel broadcast" with confirmation.                                                                                                                       |
| `components/sendo/broadcasts/recipient-table.tsx`       | Per-recipient results, 50 per page; failed rows show Meta's error code and message, skipped rows the reason.                                                                                                                                                                            |
| `components/sendo/broadcasts/parts.tsx`                 | Status badge, progress bar, counts filter, notices; `BroadcastsNotice` (`kind`, `locale`, `formatLocale`) for the full-page messages.                                                                                                                                                   |
| `components/sendo/broadcasts/strings.ts`                | `BroadcastsStrings`, `broadcastsStrings = { es, en }`, `resolveBroadcastsStrings(locale, overrides)`. Server-safe (no React).                                                                                                                                                           |
| `components/sendo/broadcasts/strings-context.tsx`       | Context `{ strings, locale, formatLocale }`; `BroadcastsStringsProvider`, `useBroadcastsStrings()`, `useBroadcastsFormat()`.                                                                                                                                                            |
| `components/sendo/broadcasts/format.ts`                 | `broadcastsFormat(formatLocale)`: counts, plurals (`Intl.PluralRules`) and dates; recipient totals; `fillTemplate`.                                                                                                                                                                     |
| `components/sendo/broadcasts/{types,press}.ts`          | View types and serializers, motion recipes.                                                                                                                                                                                                                                             |
| `lib/sendo-ui.ts`                                       | `SendoLocale` and `sendoLocale`, the language of every Sendo screen. Every UI item ships the same file. **Yours**: set it.                                                                                                                                                              |

## Don't touch (and why)

- **Eligibility lives in the package and can't be overridden.** `sendo.broadcasts.preview/create` decide
  who gets the message: MARKETING templates only go to contacts with `marketingOptIn = true`; UTILITY and
  AUTHENTICATION go to everyone who hasn't explicitly opted out (`marketingOptIn = false` with an
  `optInAt`). Ineligible recipients are stored `skipped` with `no_opt_in`, `opted_out` or `invalid_phone`.
  Don't filter by opt-in in your audience: return the whole list and let the preview explain the skips.
  Record opt-ins with `sendo.contacts.setOptIn(contactId, true, { source: "form" })`.
- **Recipients never come from the browser.** The composer sends an audience id; `actions.ts` checks the id
  is one `broadcastAudiences.list()` offers and resolves it with `broadcastAudiences.recipients()` on the
  server, for the preview and again on create (the list may change in between; the stored broadcast is
  what counts).
- **Sending happens in the tick**, not here: `createBroadcast` stores a `queued` broadcast; each tick sends
  up to `ratePerMinute` recipients. Meta 131042 (no payment method) pauses it with
  `pauseReason: "billing"` and it resumes by itself once the number's `billingReady` is true again; rate
  limits leave recipients `pending` for the next minute. A template that stops being APPROVED stops the
  broadcast (`failed`) and cancels the pending recipients.
- **Never copy Meta's rates.** The cost note links to Meta's official pricing page
  (`DEFAULT_BROADCASTS_LINKS.metaPricing`); Meta bills the number's WhatsApp Business account directly.
  Override the links with `links={{ ... }}` on `<BroadcastsScreen />`, not with numbers.
- **Permissions live in the package.** Every `sendo.broadcasts.*` call throws `FORBIDDEN` without
  `broadcasts.manage` (admins only). Don't remove the checks from `actions.ts`.
- **Client files import only types from `@quami/sendo`** (`types.ts` keeps local copies of the status lists),
  so the screen doesn't pull the server package into the browser bundle.
- Strings: every text is in `BroadcastsStrings` (`strings.ts`, one object per `SendoLocale`); pass
  `strings={{ ... }}` to `<BroadcastsScreen />` to override single keys on top of `locale`. String functions
  that show a count take `format` (`useBroadcastsFormat()`), so counts and plurals follow `formatLocale`.
- Language: `sendoLocale` in `lib/sendo-ui.ts` (`"en"` or `"es"`) is the required `locale` of
  `<BroadcastsScreen>` and `<BroadcastsNotice>`; pass `formatLocale` (e.g. `"es-GT"`) for regional numbers and
  dates. To add a language, extend `SendoLocale` and follow the type errors (`broadcastsStrings`). Docs:
  `/docs/languages`.
- Motion: see `MOTION.md` (only transform/opacity; reduced motion keeps the fades).

## Connects to

- `resolveRole` in `createSendo` (`lib/sendo.ts`): only `admin` has `broadcasts.manage`.
- `optOut` in `createSendo`: opt-out keywords (default `BAJA`, `STOP`, `ALTO`, `CANCELAR`) and the
  confirmation message. A contact who replies a keyword is opted out and shows as "Opted out".
- The tick route (`@sendo/workflows`, `SENDO_CRON_SECRET`) every minute.
- Templates: `sendo.templates.sync()` (or `npx @quami/sendo doctor`) so approved templates show in the picker.
- `inbox`: replies to a broadcast land in the normal conversation (never in `human` because of the
  broadcast, and the agent doesn't answer the template itself). Add a "Broadcasts" link to `inboxNav` in
  `inbox-config.ts` if your inbox rail should show it.

### Implementing `requireUser()` and `broadcastAudiences`

`requireUser()` returns `{ userId, tenantId }` for the signed-in user (or redirects to your login). If you
also installed `inbox`, return the same user as `app/(protected)/inbox/inbox-config.ts`.

`broadcastAudiences` is the typed hook for recipients:

```ts
export const broadcastAudiences: BroadcastAudienceSource = {
  // What the admin can pick for this number: lists or saved filters of your app.
  list: async ({ actor, accountId }) => [
    { id: "torre-a", label: "Residentes de Torre A", size: 120 },
    { id: "cobro-pendiente", label: "Con cobro pendiente", description: "Saldo > 0 al día 5" },
  ],
  // Contact ids, { phone } (upserted as contacts) or either with per-contact variables.
  recipients: async (id) =>
    (await db.residents.forAudience(id)).map((r) => ({ phone: r.phone, variables: [r.firstName] })),
};
```

Per-contact `variables` win over the ones typed in the screen; leave the screen's variables empty when your
audience sets them. Large lists work (the preview checks every recipient, so 10,000 contacts take a few
seconds on Supabase).

## Verify

1. As an admin, `/inbox/broadcasts` shows "Broadcasts"; other roles see "You don't have access to Broadcasts".
2. "New broadcast" → pick a number, an approved template and one of your audiences → "Review broadcast": the
   counts match your list (a MARKETING template to contacts without opt-in shows "Nobody on this list can
   receive this template" and the confirm button is disabled).
3. Confirm, then call the tick (`curl -H "Authorization: Bearer $SENDO_CRON_SECRET" /api/sendo/tick`): the
   progress view moves from "Queued" to "Sending" and the recipients show "Sent", then "Delivered" /
   "Read" as Meta's status webhooks arrive. "Cancel broadcast" turns the pending ones into "Cancelled".
4. With `sendoLocale = "es"` every label, count and date is Spanish ("Envíos", "Enviar a 1.200 contactos");
   with `"en"`, English (template names, audience labels and Meta's errors stay as stored).
