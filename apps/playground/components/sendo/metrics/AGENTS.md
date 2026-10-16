# metrics — notes for agents

The Metrics screen for supervisors and admins, on top of `sendo.metrics.*` from `@quami/sendo`.
Installed by `npx shadcn add @sendo/metrics`. Needs `lib/sendo.ts` (`@sendo/webhook`) and the
Sendo schema v3 (`@sendo/schema`: the `sendo_metrics_*` views). English and Spanish: the page passes the
required `locale` prop from `sendoLocale` in `lib/sendo-ui.ts` (default `"en"`).

## Files

| File                                              | What it is                                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(protected)/inbox/metrics/page.tsx`          | The screen (server component). Supervisors and admins (`metrics.view`); others get "You don't have access to Metrics" (`MetricsNotice`). Passes `locale={sendoLocale}`; `generateMetadata` reads `pageTitle`. |
| `app/(protected)/inbox/metrics/actions.ts`        | Server action `loadMetrics(filters)`. Calls `requireUser()` first, then `sendo.actor()`. Orders names with `sendoLocale`.                                                                                     |
| `app/(protected)/inbox/metrics/metrics-config.ts` | `requireUser()`: **app-owned, implement it**. Fails closed (throws) until you do. `DEFAULT_RANGE_DAYS`.                                                                                                       |
| `components/sendo/metrics/metrics-screen.tsx`     | Layout and state: filters, KPI tiles, charts, tables; refetches through `loadMetrics`. Props `locale`, `formatLocale`, `strings`. `MetricsNotice`.                                                            |
| `components/sendo/metrics/filters.tsx`            | One filter row: 7/30/90 days or a custom range, number, tags (any match).                                                                                                                                     |
| `components/sendo/metrics/column-chart.tsx`       | `<ColumnChart>`: stacked columns per day with hover/keyboard tooltip and a table view.                                                                                                                        |
| `components/sendo/metrics/tables.tsx`             | Per person, per source, per tag and cost per agent tables.                                                                                                                                                    |
| `components/sendo/metrics/summary.ts`             | `summarizeMetrics({ ..., formatLocale })`: folds the per-day API rows into what the screen shows (runs on the server).                                                                                        |
| `components/sendo/metrics/strings.ts`             | `MetricsStrings`, `metricsStrings = { es, en }`, `resolveMetricsStrings(locale, overrides)`. Server-safe (no React).                                                                                          |
| `components/sendo/metrics/strings-context.tsx`    | Context `{ strings, locale, formatLocale }`; `MetricsStringsProvider`, `useMetricsStrings()`, `useMetricsFormat()`.                                                                                           |
| `components/sendo/metrics/format.ts`              | `metricsFormat(formatLocale)`: counts, compact figures, percent, USD cost, durations, plurals, days, name order (`Intl.Collator`), initials.                                                                  |
| `components/sendo/metrics/{types,press}.ts`       | View types and day helpers (`todayIn` keeps `en-CA` for `YYYY-MM-DD` keys), motion recipes.                                                                                                                   |
| `lib/sendo-ui.ts`                                 | `SendoLocale` and `sendoLocale`, the language of every Sendo screen. Every UI item ships the same file. **Yours**: set it.                                                                                    |

## Don't touch (and why)

- **Permissions live in the package.** Every `sendo.metrics.*` call takes `{ actor }` and throws `FORBIDDEN`
  without `metrics.view` (agents). `sendo.metrics.cost` needs `costs.view` (admins), and `daily` returns
  `costCents`/`tokensIn`/`tokensOut` as `null` for everyone else. `loadMetrics` only asks for cost when
  `can(actor, "costs.view")`, so supervisors never see the cost section. Don't remove the checks from
  `actions.ts`; add your own on top if you need them.
- **The tenant is always the actor's.** The number filter accepts the tenant's numbers only (disconnected
  ones included, their history stays); another tenant's id is `ACCOUNT_NOT_FOUND`.
- **Days are calendar days in a number's timezone** (`sendo_accounts.timezone`). The screen reads the
  period in the selected number's timezone, or the default number's for "All numbers", and turns
  `YYYY-MM-DD` days into instants with `metricsDayRange({ from, to, timeZone })` (both days included,
  DST-safe). If your numbers are in different timezones, a number in another zone can lose or gain one
  local day at the ends of the period in the "all numbers" view; filter by number for exact days.
- **Definitions** (the views, see `https://sendo.dev/docs/metrics`): notes, drafts and imported history
  never count as messages or first responses; first response is the first agent or human reply after the
  first inbound; "resolved by AI" is a closed conversation that was never handed to a person and has
  no human message; the tag cut is any-match on the conversation's current tags.
- **"Conversations" per person is a sum of days**: a conversation someone wrote in on three days counts
  three times (the view's grain is per day). It is exact for one-day periods.
- **Range limit:** 366 days per request (`METRICS_MAX_DAYS`), checked in the browser and again in the action.
- Strings: every text is in `MetricsStrings` (`strings.ts`, one object per `SendoLocale`); pass
  `strings={{ ... }}` to `<MetricsScreen>` to override single keys on top of `locale`. String functions that
  show a count take `format` (`useMetricsFormat()`), so counts and plurals follow `formatLocale`.
- Language: `sendoLocale` in `lib/sendo-ui.ts` (`"en"` or `"es"`) is the required `locale` of `<MetricsScreen>`
  and `<MetricsNotice>`; pass `formatLocale` (e.g. `"es-GT"`) for regional numbers, money and days. To add a
  language, extend `SendoLocale` and follow the type errors (`metricsStrings`). Docs: `/docs/languages`.
- Motion: see `MOTION.md` (only transform/opacity; reduced motion keeps the fades).

## The chart (why no chart library)

`column-chart.tsx` is plain HTML and CSS: one flex column per day, segment heights as percentages,
hairline gridlines, clean 1/2/5 ticks. It covers the only two charts the screen needs (stacked columns of
received/sent messages, single-series cost) with hover and keyboard tooltips (arrow keys, Home/End,
Escape), a screen-reader live summary and a table view. A chart library (Recharts, visx, Chart.js) would
add 50–100 kB of client JS and a dependency to every app that installs the item, for no capability
the screen uses. If you need more chart types, adding one is fine: keep the colours and the table view.

Colours follow the dataviz reference palette, validated for colour-vision deficiency on light and dark
surfaces: slot 1 blue `#2a78d6` (dark `#3987e5`) for "Received" and cost, slot 2 orange `#eb6834`
(dark `#d95926`) for "Sent", as `--sendo-metrics-series-1/2` on the chart root. Text never uses the
series colours; the legend and tooltip carry identity with swatches and line keys.

## Connects to

No env vars and no item dependencies beyond `@quami/sendo`. Needs schema v3 (the `sendo_metrics_*` views;
Drizzle and Prisma adapters run the same SQL) and, in `createSendo`, `resolveRole` (who sees the screen) and
optionally `resolveUsers` (names in the per-person table). The rail of `inbox` can link to
`/inbox/metrics`.

### Implementing `requireUser()`

Return `{ userId, tenantId }` for the signed-in user (or redirect to your login). `sendo.actor(userId,
tenantId)` then resolves the role through `resolveRole` in `createSendo` (`lib/sendo.ts`); without
`resolveRole` every user gets "You don't have access to Metrics". Configure `resolveUsers` too, or the per-person
table shows user ids. If you also installed `inbox`, return the same user as
`app/(protected)/inbox/inbox-config.ts`.

## Verify

1. Before implementing `requireUser()`, `/inbox/metrics` throws (fails closed). As an agent the screen says
   "You don't have access to Metrics"; as a supervisor it opens without the "AI cost" section; as an admin
   the cost section shows cost per day and per agent.
2. Send a message to one of your numbers and answer it from the inbox: today's column in "Messages per day"
   grows, and your row in "By person" counts the reply and its first-response time.
3. Pick a tag in "Tags": every tile, chart and table narrows to conversations with that tag.
4. With `sendoLocale = "es"` every label, count, cost and day is Spanish ("Métricas", "lun, 5 oct 2026");
   with `"en"`, English (names, tags and sources stay as stored).
5. Package side: `pnpm --filter @quami/sendo test -- metrics` (role checks, tag cut, day ranges).

## Reading the metrics elsewhere

```ts
import { metricsDayRange } from "@quami/sendo";

const actor = await sendo.actor(userId, tenantId);
const range = metricsDayRange({
  from: "2026-10-01",
  to: "2026-10-31",
  timeZone: "America/Guatemala",
});
const daily = await sendo.metrics.daily({ actor, ...range }); // rows per day and number
const ventas = await sendo.metrics.firstResponse({ actor, ...range, tagIds: [ventasTagId] });
```

Drizzle or Prisma without the views: `METRICS_SQL` and `metricsSqlParams` from `@quami/sendo` (see the docs).
