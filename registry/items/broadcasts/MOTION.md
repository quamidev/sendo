# Sendo broadcasts — MOTION.md

Steps 2–5 of the per-screen process (`CLAUDE.md`) for the `broadcasts` registry item: the list
(`broadcast-list.tsx`), the composer and its review (`broadcast-composer.tsx`), the progress view
(`broadcast-progress.tsx`, `recipient-table.tsx`, `parts.tsx`) and the cancel dialog. The skills in
`.claude/skills/` were followed in order: static screen with hover and press states →
`find-animation-opportunities` → only the kept motions → `review-animations` → `break-ui`.

## Tokens and reduced motion

Same `--sendo-*` tokens as `inbox` (`components/sendo/motion.css`), always with the inbox value as
fallback, so the item works installed alone and follows an app's overrides:

| Token               | Fallback                        | Used for                           |
| ------------------- | ------------------------------- | ---------------------------------- |
| `--sendo-ease-out`  | `cubic-bezier(0.16, 1, 0.3, 1)` | press, step enter, pending fade    |
| `--sendo-dur-press` | 120 ms                          | press feedback                     |
| `--sendo-dur-fast`  | 160 ms                          | pending fade, row and card colours |
| `--sendo-dur-menu`  | 200 ms                          | step enter                         |

Recipes live in `components/sendo/broadcasts/press.ts` (`pressClass`, `viewEnterClass`,
`pendingFadeClass`, `dialogReducedClass`).

`prefers-reduced-motion: reduce`: the press scale is removed (`motion-reduce:active:[transform:none]`),
a step enters with the fade only (`motion-reduce:starting:[transform:none]`), and the cancel dialog stops
scaling (`--tw-enter-scale: 1`). Every opacity and colour change stays. Hover changes colour only
(Tailwind 4 `hover:` is already behind `@media (hover: hover)`).

## Step 2 — `find-animation-opportunities`

Recon: Next.js 16 + Tailwind 4 + shadcn new-york + tw-animate-css (Dialog). Personality: an admin tool
opened a few times a month, around a deliberate, money-spending action. Crisp; motion only where it
explains a state change. Frequency map: the list and the composer are seen a few times per broadcast;
the progress view is watched for minutes while it polls every 5 s; the recipient table is read, not
played with.

### Kept

| #   | Location                                                                                    | Today (static)                                                                                                     | Purpose                     | Frequency  | Motion                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Step change: list → composer → review → progress (`viewEnterClass`)                         | The whole screen swaps in one frame; going from the form to the review looks like nothing happened but the numbers | Preventing a jarring change | Occasional | On insertion only (`@starting-style`): `opacity 0 → 1` and `translateY(4px) → 0`, `var(--sendo-dur-menu)` (200 ms) `var(--sendo-ease-out)`. Reduced motion: opacity only                                                        |
| 2   | Buttons, back link, legend/filter tiles (`pressClass`); list rows (`active:bg-accent`)      | Colour change on press only                                                                                        | Feedback                    | Occasional | `:active { transform: scale(0.97) }`, `transition: transform, colors var(--sendo-dur-press) var(--sendo-ease-out)`; starts on pointer-down. Full-width list rows get a colour press only (a scaling row looks like it detaches) |
| 3   | Recipient table waiting for the server (filter, refresh, "Cargar más") (`pendingFadeClass`) | Old rows sit there as if current while the next page or state loads                                                | State indication            | Occasional | Opacity 1 → 0.6 over `--sendo-dur-fast`, back when the page arrives. Opacity only                                                                                                                                               |
| 4   | Cancel confirmation (shadcn `Dialog`)                                                       | shadcn default fade + zoom                                                                                         | Spatial consistency         | Rare       | Kept as shadcn ships it (fade + 95 % zoom, 200 ms); reduced motion keeps the fade (`dialogReducedClass`)                                                                                                                        |

### Rejected

- **Progress bar segments growing when a poll brings new counts.** Function: it's data the admin reads and
  compares with the numbers right below it. A `scaleX` layer stack would also break the 2 px gaps between
  segments. Widths jump; the numbers update in place with `tabular-nums`.
- **Counting-up numbers in the tiles and the review stats.** Function + Frequency: every 5 s while sending;
  a rolling number is harder to read than the final one.
- **Recipient rows entering (stagger) on every page.** Frequency: 50 rows per page, re-rendered on every
  filter change and every poll that changes counts. Instant.
- **Notices (billing pause, stopped, cancelled) sliding in.** They change with the broadcast's state, which
  the badge already shows; the notice appears with the step (kept #1) or replaces the previous notice in
  place. Height animation would be needed for a smooth push-down, which is forbidden.
- **Radio cards / selected filter tile moving a highlight.** A colour change (`--sendo-dur-fast`) already
  shows the selection; a travelling pill would animate layout-like geometry.

Verdict: the screen needs very little motion. The highest-leverage one is #1: the review step is where the
admin must notice that the screen changed and read the counts before spending money.

## Step 4 — `review-animations`

| Before                                          | After                                                                              | Why                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| shadcn `Button` base `transition-all`           | `pressClass`: `transition-[transform,color,background-color,border-color,opacity]` | No unbounded `transition-all` (tailwind-merge keeps the last `transition-*`)            |
| Step enter as a keyframe (`animate-in fade-in`) | `@starting-style` transition (`starting:` variant)                                 | A transition retargets if the step changes again mid-flight; a keyframe restarts        |
| Step enter with `translateY(8px)`               | `translateY(4px)`                                                                  | The step replaces the whole column; 8 px read as a page load. 4 px is a cue, not a move |
| Dialog zoom under reduced motion                | `motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]`             | Reduced motion keeps opacity, removes movement                                          |
| List rows with `active:scale`                   | `active:bg-accent` only                                                            | A full-width row scaling 3 % moves its edges ~20 px at 1280 px                          |

Remaining notes:

- **Press stays symmetric** (120 ms, 3 %): the round trip is under 250 ms and matches `inbox`.
- **The step enter is 200 ms ease-out**: a system response to a click, inside the UI budget; no exit
  animation (the old step leaves instantly, so the new one is never delayed).
- **No `ease-in`, no `scale(0)`, no animated layout properties** anywhere in the item. The progress bar's
  segment widths are static styles (they change, they don't animate).

Decision: **Approve.**

## Step 5 — `break-ui`

Fixtures: `apps/playground/fixtures/broadcasts/`, rendered by the dev-only route
`/dev/broadcasts?data=demo|zero|huge|failed|paused|empty` (the real `BroadcastsScreen` with fixture data
and stand-in actions; a toggle at the bottom; `&reset` restarts the dataset; 404 in production). The demo
"Enviando" broadcast advances on every poll. Worst cases: a 78-character template name (`es_MX`); a
70-character number label on a number without a payment method; a disconnected number; an audience with a
120-character label and a 210-character description; 10,000 recipients (paged, 50 per page); one audience
of exactly 1 contact; names `Aleksandra Wiśniewska-Kowalczyk`, `Jo`, a missing name (app reference
`PAC-10002` instead), a 60-character Spanish name, an Arabic (RTL) name, an emoji-first name, a missing
phone; Meta errors with long titles, details and an unbreakable template name; Sendo's own "interrupted"
error without a Meta code. Checked in Chromium at 1280 px and 320 px.

| #   | Severity | Field                    | Worst-case value                      | What happened → fix                                                                                                                  |
| --- | -------- | ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Broken   | Review stats             | 10.000 / 0 / 10.000 at 320 px         | Three tiles side by side cut "10.000" at the edge → one row per stat (label left, number right) below 440 px; numbers never truncate |
| 2   | Ugly     | Recipient rows on phones | Every row                             | Name, phone, state and detail stacked into four lines → name and state share the first line, the detail spans below                  |
| 3   | Broken   | Failed row label         | Sendo's "interrupted" error           | Labelled "Error de Meta" without a code, although Meta never answered → "No se envió" when there is no Meta code                     |
| 4   | Fragile  | "All failed" broadcast   | 64 of 64 failed, status `done`        | Showed the neutral "Terminado" notice → a red "Ningún mensaje salió" notice when nothing went out and something failed               |
| 5   | Ugly     | Composer                 | Coming from the list                  | The only way back was "Cancelar" at the bottom of a long form → "← Envíos" at the top, like the progress view                        |
| 6   | Fragile  | Empty list "Nuevo envío" | Tenant with only disconnected numbers | The empty state offered "Nuevo envío" into a composer with no number → hidden when no number is connected                            |

Decisions: template names and audience labels wrap (`overflow-wrap: anywhere`; they identify the
broadcast); audience descriptions clamp at 2 lines with the full text in `title`; Meta's error clamps at
2 lines with the full text (title, message, details) in `title`, since the full error is also on the
message in the inbox thread; phones are shown as stored (E.164); counts use `Intl.NumberFormat("es")`
(so 4-digit numbers have no separator, per Spanish style) with `tabular-nums`; recipients are paged
("Cargar más", 50 at a time) instead of virtualized — the admin reads the first pages or filters by state.

Held up: the RTL and emoji names; the one-contact audience ("1 contacto"); the disconnected number
("(desconectado)"); billing-pause notice and its link at 320 px; filters with 0 recipients are hidden;
"Cargar más" and the state filter on 10,000 rows; the cancel dialog's pending count; the empty composer
(no templates, no audiences) explains what to do instead of showing empty selects.
