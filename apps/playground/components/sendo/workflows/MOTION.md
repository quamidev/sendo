# Sendo workflows — MOTION.md

Steps 2–5 of the per-screen process (`CLAUDE.md`) for the `sendo-workflows` registry item: the rules
screen (`rules-screen.tsx`, `rule-row.tsx`), the editor sheet (`rule-editor.tsx`,
`business-hours-fields.tsx`, `rule-fields.tsx`, `form-parts.tsx`) and the delete dialog. The skills in
`.claude/skills/` were followed in order: static screen with hover and press states →
`find-animation-opportunities` → only the kept motions → `review-animations` → `break-ui`.

## Tokens and reduced motion

Same `--sendo-*` tokens as `sendo-inbox` (`components/sendo/motion.css`), always with the inbox value as
fallback, so the item works installed alone and follows an app's overrides:

| Token                 | Fallback                         | Used for                              |
| --------------------- | -------------------------------- | ------------------------------------- |
| `--sendo-ease-out`    | `cubic-bezier(0.16, 1, 0.3, 1)`  | press, pending fade, sheet enter/exit |
| `--sendo-ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | reorder slide (on-screen movement)    |
| `--sendo-dur-press`   | 120 ms                           | press feedback                        |
| `--sendo-dur-fast`    | 160 ms                           | pending row dim, radio-card colour    |
| `--sendo-dur-menu`    | 200 ms                           | sheet exit                            |
| `--sendo-dur-sheet`   | 320 ms                           | sheet enter                           |

Recipes live in `components/sendo/workflows/press.ts` (`pressClass`, `pendingFadeClass`,
`sheetMotionClass`, `REORDER_*`) and `use-reorder-motion.ts`.

`prefers-reduced-motion: reduce`: the press scale is removed (`motion-reduce:active:[transform:none]`),
the sheet stops sliding and fades instead (`--tw-enter-translate-x: 0`, `--tw-enter-opacity: 0`), the
dialog stops scaling (`--tw-enter-scale: 1`), and reordered rows jump to their slot. Every opacity and
colour change stays. Hover changes colour only (Tailwind 4 `hover:` is already behind
`@media (hover: hover)`).

## Step 2 — `find-animation-opportunities`

Recon: Next.js 16 + Tailwind 4 + shadcn new-york + tw-animate-css (shadcn's Sheet and Dialog). Personality:
an admin settings screen opened a few times a month; edits are deliberate and rare. Crisp, very little
motion. Frequency map: the list is read occasionally; toggling and moving a rule are occasional; typing in
the forms is tens of keystrokes per visit.

### Kept

| #   | Location                                                        | Today (static)                                             | Purpose             | Frequency  | Motion                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Rows after "Subir" / "Bajar" / delete (`use-reorder-motion.ts`) | The row teleports to its new slot; the eye loses it        | Spatial consistency | Occasional | FLIP on the `<li>`: `transform: translateY(from old slot)` → `none`, `220ms var(--sendo-ease-in-out)`. A second move mid-slide starts from the current translate (interruptible). Focus stays on the arrow button, so repeated presses work |
| 2   | Editor sheet open / close (`sheetMotionClass`)                  | shadcn default: 500 ms in / 300 ms out, `ease-in-out`      | Spatial consistency | Occasional | Slide from the right, enter `var(--sendo-dur-sheet)` (320 ms), exit `var(--sendo-dur-menu)` (200 ms), both `--sendo-ease-out`. Reduced motion: fade only                                                                                    |
| 3   | Buttons and icon buttons (`pressClass`)                         | Colour change on press only                                | Feedback            | Occasional | `:active { transform: scale(0.97) }`, `transition: transform, colors var(--sendo-dur-press) var(--sendo-ease-out)`; starts on pointer-down                                                                                                  |
| 4   | Row waiting for the server (`aria-busy`, `pendingFadeClass`)    | Row looks idle while a toggle / move / delete is in flight | State indication    | Occasional | Opacity 1 → 0.6 over `--sendo-dur-fast`, back when the server answers. Opacity only                                                                                                                                                         |

### Rejected

- **New rule row entering (fade/rise) after "Guardar".** Function: the sheet closing already reveals the
  list, and the new row is appended at the end; a second motion on top of the sheet exit is noise.
- **Deleted row collapsing.** Would need a height animation (forbidden). The rows below slide up with #1
  instead, which is the useful part.
- **Error row / validation messages appearing.** Frequency + Function: errors appear on every save attempt
  and while typing after the first attempt; they must be readable immediately. Instant.
- **Adding/removing schedule ranges, chips and holidays.** Frequency: tens per visit while editing a
  schedule or a keyword list. Instant.
- **Selected radio card / type picker pill moving between options.** Frequency + Function: a colour change
  (`--sendo-dur-fast`) already shows the state; a travelling pill would animate layout-like geometry.
- **Switch thumb.** Kept as shadcn ships it (a `transform` transition on the thumb, 150 ms); not a new motion.

Verdict: the screen needs little motion. The highest-leverage one is #1: moving a rule is the one action
whose result is hard to see without motion, and the order matters (route rules are first-match-wins).

## Step 4 — `review-animations`

| Before                                                               | After                                                                                      | Why                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| shadcn `Sheet`: `duration-500` in, `duration-300` out, `ease-in-out` | `sheetMotionClass`: 320 ms in / 200 ms out, `--sendo-ease-out`                             | `ease-in-out` delays the start the user watches; 500 ms is sluggish for a side panel |
| shadcn `Button` / `Switch` base `transition-all`                     | `pressClass` / `transition-[background-color,box-shadow]` (tailwind-merge keeps the last)  | No unbounded `transition-all`                                                        |
| Sheet slides under reduced motion                                    | `motion-reduce:` sets `--tw-enter/exit-translate-x: 0` and adds an opacity fade            | Reduced motion keeps opacity, removes movement                                       |
| Dialog zoom under reduced motion                                     | `motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]`                     | Same                                                                                 |
| FLIP with keyframes                                                  | Inline `transition: transform` from the measured offset, re-measured on every order change | A keyframe would restart from zero on a quick second move; a transition retargets    |

Remaining notes:

- **Asymmetry:** the sheet exit (200 ms) is faster than its enter (320 ms): the system response snaps. The
  press stays symmetric (120 ms, 3 %): the round trip is under 250 ms and matches `sendo-inbox`.
- **The reorder slide uses `ease-in-out`** on purpose: the row is already on screen and moves between two
  resting positions (CLAUDE.md: `ease-in-out` for on-screen movement). 220 ms, inside the UI budget.
- **Radio cards and validation** change colour only, no transform.
- **No `ease-in`, no `scale(0)`, no animated layout properties** anywhere in the item.

Decision: **Approve.**

## Step 5 — `break-ui`

Fixtures: `apps/playground/fixtures/workflows/`, rendered by the dev-only route
`/dev/rules?data=demo|worst|empty|invalid` (the real `RulesScreen` with fixture data and stand-in actions
that validate with the package schemas; a toggle at the bottom of the page; `&reset` restarts the dataset;
the route returns 404 in production). Worst case: a 64-character rule name; a route with 100 keywords (the
schema maximum, one of 54 characters), a 32-character source, a 64-character queue, 20 tags (one a long
Polish name) and a 160-character reason, scoped to a disconnected number with a 70-character label; a
business-hours rule with 12 ranges on Monday, 40 holidays, a 1,000-character after-hours message with an
unbreakable email and `appliesTo: "all"`; an invalid stored business-hours rule (unknown time zone,
`"9"`/`"18"` times, missing days, `appliesTo: "sometimes"`); an escalation stored with `"15"` as a string
and an unknown action; a one-letter rule name; a 10,080-minute escalation. Checked in Chromium at 1280 px
and 320 px; the editor at both widths.

| #   | Severity | Field                      | Worst-case value         | What happened → fix                                                                                                                                               |
| --- | -------- | -------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ugly     | Route summary              | 20 tags                  | The row grew to nine lines listing every tag → tags summarised like keywords ("a, b, c y 17 más") and the summary clamps at 3 lines with the full text in `title` |
| 2   | Ugly     | Invalid row                | 12 schema issues         | A fixed-height scroll box cut the list mid-line → the row lists the first 3 problems and "y N problemas más"; the editor marks every field                        |
| 3   | Broken   | Invalid row text           | Missing days, wrong enum | Generic issues showed zod's English ("Invalid input: expected array…") → the row re-validates with the Spanish error map (`validateRuleParams`)                   |
| 4   | Ugly     | Escalation summary         | 10080 minutes            | Digits without grouping → counts use `Intl.NumberFormat("es")` ("10.080 minutos")                                                                                 |
| 5   | Ugly     | Editor sections ("Cuando") | Legend + hint            | The hint overlapped the uppercase legend (negative margin inside a fieldset) → legend margin, no negative margins                                                 |
| 6   | Fragile  | Editor, editing a rule     | Read-only name           | The sheet autofocused and selected the read-only name → when editing, focus goes to the sheet itself                                                              |
| 7   | Broken   | Time range errors          | `"9:00"` – `"18:00"`     | "El inicio debe ser anterior al fin" (string order) hid the real problem → a malformed time's message wins over the range message                                 |

Decisions: names wrap (they identify the rule; 64 characters at most); the number label in a row's scope
line wraps too; keyword and tag chips wrap inside the editor (100 is the schema's maximum, the sheet
scrolls); the list is not paginated (rules are few by nature). A rule scoped to a number that no longer
exists shows "Número <id>", and a disconnected one "(desconectado)"; the editor keeps that value selectable
so saving doesn't silently re-scope the rule.

Held up: the one-letter name; empty state at 320 px; the switch, edit and delete never leave the row at
320 px (they move under the text); arrow buttons disable at the ends; the 12-range Monday and 40 holidays
in the editor; a time zone not in the browser's list is still editable (free text with suggestions).
