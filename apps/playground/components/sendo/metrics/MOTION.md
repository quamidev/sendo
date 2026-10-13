# Sendo metrics — MOTION.md

Steps 2–5 of the per-screen process (`CLAUDE.md`) for the `metrics` registry item: the
"Métricas" screen (`metrics-screen.tsx`, `filters.tsx`, `column-chart.tsx`, `tables.tsx`). The skills
in `.claude/skills/` were followed in order: static screen with hover and press states →
`find-animation-opportunities` → only the kept motions → `review-animations` → `break-ui`.

## Tokens and reduced motion

Same `--sendo-*` tokens as `inbox` (`components/sendo/motion.css`), always with the inbox value as
fallback, so the item works when installed alone:

| Token               | Fallback                        | Used for                              |
| ------------------- | ------------------------------- | ------------------------------------- |
| `--sendo-ease-out`  | `cubic-bezier(0.16, 1, 0.3, 1)` | every motion here                     |
| `--sendo-dur-press` | 120 ms                          | press feedback                        |
| `--sendo-dur-fast`  | 160 ms                          | refetch dim, "Actualizando…", tooltip |
| `--sendo-dur-menu`  | 200 ms                          | tag menu entrance                     |

Recipes live in `components/sendo/metrics/press.ts`. `prefers-reduced-motion: reduce` removes the press
scale (`motion-reduce:active:[transform:none]`) and the menu scale (`motion-reduce:starting:[transform:none]`);
every opacity change stays. Hover changes colour only and Tailwind 4 wraps `hover:` in
`@media (hover: hover)`, so touch screens never keep a stuck hover.

## Step 2 — `find-animation-opportunities`

Recon: Next.js 16 + Tailwind 4 + shadcn new-york, no motion library in this item. Personality: a crisp
read-only dashboard a supervisor opens a few times a week and reads for minutes. Frequency map: filter
changes a handful of times per visit; hovering the chart tens of times per visit; keyboard (arrows) on the
chart is occasional but keyboard-initiated.

### Kept

| #   | Location                                                                                                   | Today (static)                               | Purpose                     | Frequency       | Motion                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Buttons: presets, Personalizado, Aplicar, Ver tabla, Mostrar todos, Reintentar, tag trigger (`pressClass`) | Colour change on press only                  | Feedback                    | Occasional      | `:active { transform: scale(0.97) }`, `transition: transform, colors var(--sendo-dur-press) var(--sendo-ease-out)`; starts on pointer-down                                                                                      |
| 2   | Everything below the filters while `loadMetrics` runs (`refetchClass`)                                     | Old numbers stay at full strength, then swap | State indication            | A few per visit | Opacity 1 → 0.6 over `--sendo-dur-fast` while pending, back to 1 with the new report; "Actualizando…" fades in beside the timezone note. Opacity only, no skeleton, no layout jump (the dataviz "refetch keeps the frame" rule) |
| 3   | Chart tooltip (`tooltipFadeClass`)                                                                         | Appears and disappears instantly             | Preventing a jarring change | Tens per visit  | Opacity 0 → 1 over `--sendo-dur-fast` on the first hover/focus and back to 0 on leave (it keeps the last day while fading out). Moving between days is instant: the position is not transitioned                                |
| 4   | Tag filter menu (`menuEnterClass`)                                                                         | Panel pops in under the trigger              | Spatial consistency         | Occasional      | `@starting-style` entrance from `opacity: 0; scale(0.97)`, `transform-origin: top left` (the trigger's corner), `--sendo-dur-menu`, `--sendo-ease-out`. Closing snaps                                                           |

### Rejected

- **Columns growing from the baseline on load or on every filter change.** Function + Frequency: this is
  the data the supervisor is reading and comparing; bars that grow delay reading and replay on each refetch.
  Columns render at their final height.
- **KPI numbers counting up.** Function: a counter shows wrong intermediate numbers for ~300 ms on a screen
  whose only job is to show the right ones.
- **Tooltip sliding between days (transitioned `left`).** Frequency + Function: it follows the pointer and
  the arrow keys; any lag makes it trail the cursor, and `left` is a layout property. It jumps.
- **Chart ↔ table cross-fade ("Ver tabla").** Purpose: it is a view switch inside one card, triggered
  deliberately; the swap is in place and nothing else moves.
- **Staggered entrance of tiles and cards on page load.** Frequency + Cohesion: the page is opened to read
  numbers, often repeatedly; a stagger only delays them.
- **"Mostrar todos" rows sliding in.** Would need a height animation (forbidden) or a stagger on a table;
  rows appear in place below the visible ones, so nothing jumps.

Verdict: the screen needs very little motion. The highest-leverage motion is #2: a refetch that dims the
current numbers instead of flashing a skeleton tells the reader what is happening without moving anything.

## Step 4 — `review-animations`

| Before                                                                   | After                                                                                                          | Why                                                                              |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| shadcn `Button` base class `transition-all`                              | `pressClass` sets `transition-[transform,color,background-color,border-color]` (tailwind-merge keeps the last) | No unbounded `transition-all`                                                    |
| Tooltip content cleared on leave, so an empty box faded out              | The tooltip keeps the last day (`shown`) while its opacity goes to 0                                           | A fade-out of an empty, collapsing box reads as a glitch                         |
| Hover dimming of the other columns considered with an opacity transition | Instant (no transition)                                                                                        | Tracks the pointer across up to 90 columns; any duration makes the highlight lag |

Remaining notes, justified:

- **Pure fade on the tooltip (no initial transform).** It is anchored to the column under the pointer and
  re-anchors instantly on every day; a scale-in would replay on the first hover only and fight the snap.
  Opacity alone is the quieter bridge (Standard 10: a dashboard stays crisp).
- **Keyboard-initiated tooltip (arrow keys).** Only the first appearance fades (160 ms, within the tooltip
  budget); moving with the arrows is instant, so repeated keyboard use never waits on motion.
- **Press timing is symmetric** (120 ms in and out). The scale is 3 % and the round trip stays under 250 ms,
  so asymmetry would not be perceptible; kept consistent with `inbox` and `widgets`.
- **Interruptibility:** every motion is a CSS transition (no keyframes); a second filter change while
  loading keeps the dim and retargets, and the request counter drops stale responses.
- **Easing:** only `--sendo-ease-out`; no `ease-in` anywhere. Nothing scales from 0.

## Step 5 — `break-ui`

Fixtures: `apps/playground/fixtures/metrics/` at the dev route `/dev/metrics?data=<key>` (dev only, a
bottom-centre toggle): `demo`, `worst`, `empty` (no activity), `one` (one day, one conversation, every
count at 1), `ninety` (90 days with empty days), `heavy` (one person with ~1,000 conversations in 30 days)
and `supervisor` (no cost). The rows enter through the same `summarizeMetrics` the server action uses.
Checked at 1280 px and 375 px, light and dark. Screenshots: `qa-screenshots/snd-4.4-*.png`.

### What broke, and the fix applied

| #   | Severity | Field                            | Worst-case value                              | What happened                                                  | Fix                                                                                               |
| --- | -------- | -------------------------------- | --------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Broken   | cost y-axis ticks                | 400 US$/day (`worst`)                         | "400,00 US$" clipped by a fixed 40 px gutter                   | Gutter sized by an invisible copy of the widest tick; compact cost ticks (`formatCostTick`)       |
| 2   | Broken   | x-axis labels at 375 px          | 30 days                                       | "10 sept16 sept" collided                                      | Phones keep the first, middle and last labels (`hidden sm:inline` on the rest)                    |
| 3   | Ugly     | tables in half-width cards       | 5 numeric columns                             | "App WhatsApp Busi…" truncated, headers wrapped on three lines | Per-person table full width; tag median hidden while the card is half width (`secondary: "half"`) |
| 4   | Ugly     | long lists                       | 25 people, 24 sources, 40 tags                | Inner scroll cut the last row mid-glyph                        | First 8 rows, then "Mostrar los N" / "Mostrar menos"; no nested scroll                            |
| 5   | Ugly     | KPI details                      | `1 recibidos · 1 enviados`, `0 de 0 cerradas` | Wrong plurals and a meaningless ratio                          | Singular/plural strings; "Ninguna cerrada en el periodo"; no unanswered line when nothing started |
| 6   | Ugly     | initials                         | "Agente de turno 11"                          | "A1"                                                           | Initials from words that start with a letter (grapheme-safe); unknown user → person icon          |
| 7   | Ugly     | KPI detail at 375 px             | `341.701 recibidos · 135.326 enviados`        | Truncated with an ellipsis                                     | `line-clamp-2` instead of a one-line truncate                                                     |
| 8   | Ugly     | tag "Resueltas por IA" on phones | `55 % (9286/16.894)`                          | Tag names squeezed to "Etique…"                                | The `(n/m)` detail is hidden below `sm`; source share column is secondary on phones               |
| 9   | Broken   | selected preset on hover         | "7 días" just clicked                         | Ghost button hover colour made the selected label invisible    | `hover:text-background` on the selected chip                                                      |
| 10  | Ugly     | person without a sender id       | human message with no `senderRef`             | Row read "Usuario "                                            | "Sin identificar"                                                                                 |

### What held up

Huge counts (`477 mil`, `69,3 mil` via compact figures; tables use full `Intl` grouping and
`tabular-nums`), long number labels and disconnected numbers in the select, long and emoji tag names
(truncate + `title`), long source codes and `ad:<id>`, `null` agent names ("Sin nombre"), 90 columns
(1 px gaps, 2 px radius, hover still finds every day), a single column, the all-zero chart ("Sin mensajes
en este periodo." over a 0–1 axis), the supervisor view (no cost section at all), and dark mode (the dark
palette steps were validated against the app's dark surface).

### Decisions

- **Per-person "Conversaciones" is a sum of days** (the view grain). Documented in `AGENTS.md`; exact for
  one-day periods. A distinct count would need a new view.
- **Mixed-timezone tenants:** "Todos los números" reads days in the default number's timezone; a number in
  another zone can lose or gain one local day at the edges. Documented; filter by number for exact days.
