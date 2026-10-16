# Sendo numbers — MOTION.md

Steps 2–5 of the per-screen process (`CLAUDE.md`) for the `numbers` registry item, following the
skills in `.claude/skills/`: the screen was built static first (hover and press colours only), then
`find-animation-opportunities` → only the kept motions implemented → `review-animations` → `break-ui` with
the fixtures in `apps/playground/fixtures/numbers/`.

## Tokens and reduced motion

The item uses the inbox's `--sendo-*` tokens **with fallbacks** (`duration-[var(--sendo-dur-press,120ms)]`,
`ease-[var(--sendo-ease-out,cubic-bezier(0.16,1,0.3,1))]`), so it works installed alone and follows an app's
overrides when `inbox`'s `motion.css` (or the app's own CSS) defines them. No CSS file ships with the item.

Reduced motion (`prefers-reduced-motion: reduce`): movement is removed per element with Tailwind
`motion-reduce:` variants (`motion-reduce:active:scale-100`, `motion-reduce:starting:translate-y-0`, the
switch thumb's `transition-none`, `motion-reduce:animate-none` on spinners, `--tw-enter/exit-scale:1` on
dialogs); opacity and colour transitions stay. Verified in Chromium: with full motion the pressed
"Conectar otro" reaches `scale: 0.97` and a new row goes `opacity 0 → 1`, `translate 6px → 0` in ~200 ms;
with emulated reduced motion the pressed button stays at `scale: 1` and the row never translates.

Tailwind 4 writes `scale-*` / `translate-*` to the individual `scale` / `translate` properties, so the
transitions list those (`transition-[scale,…]`, `transition-[opacity,translate]`), not `transform`.

## Step 2 — `find-animation-opportunities`

Recon: Next.js 16 + Tailwind 4 + shadcn new-york, no motion library needed. Personality: an admin settings
screen visited occasionally (connect a number, fix billing, pause the agent). Few, crisp motions.

| #   | Location                                                                        | Today                                                         | Purpose                            | Frequency  | Motion (kept)                                                                                                                                      |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Buttons, choice cards, rail link (`pressClass`)                                 | No press feedback                                             | Feedback                           | Occasional | `:active` `scale: 0.97` (cards `0.99`, rail `0.94`), `--sendo-dur-press` 120 ms, `--sendo-ease-out`; colours transition too                        |
| 2   | Newly connected row (`number-row.tsx`, `rowEnterClass`)                         | Row appears instantly at the end of the list                  | Preventing a jarring change        | Rare       | `@starting-style` `opacity: 0; translate: 0 6px` → settled, `--sendo-dur-menu` 200 ms, `--sendo-ease-out`; only for rows connected in this session |
| 3   | Status pill (`StatusPill`)                                                      | Text swaps instantly after "verificar", reconnect, disconnect | State indication                   | Occasional | The new pill fades in (`opacity 0 → 1`, `--sendo-dur-fast` 160 ms); never on page load (only when the status changed while open)                   |
| 4   | Agent switch thumb (host shadcn `Switch`)                                       | —                                                             | State indication                   | Occasional | The primitive's own thumb `translate` (150 ms); track colour 160 ms. Reduced motion: thumb transition removed                                      |
| 5   | Dialogs (flavour choice, PIN, disconnect, delete history; host shadcn `Dialog`) | —                                                             | Spatial consistency                | Occasional | Host `tw-animate` fade + 95 % zoom (200 ms); reduced motion keeps only the fade                                                                    |
| 6   | Spinners in "Connecting…", "Checking…", "Disconnecting…", "Deleting…"           | Label change only                                             | Feedback (multi-second Meta calls) | Occasional | `animate-spin` on the loader icon; reduced motion: no rotation, the label still changes                                                            |

Rejected:

- **Rows on first render (stagger)** — Function: data the admin came to read; motion only delays it.
- **Re-ordering rows when the default changes (FLIP)** — Function + Speed: the screen keeps rows in place after
  every change (`mergeNumbers`), so nothing moves; the "Por defecto" badge just swaps.
- **Row exit on disconnect** — Function: a disconnected number stays in the list (history readable); only its
  status changes (motion #3).
- **Row exit after "Delete history"** — Frequency + Function: a rare, irreversible action confirmed in a dialog;
  the dialog's own exit covers the row as it leaves and the toast confirms it. Animating the removal would
  only delay the list settling (and a height collapse is off-limits).
- **Export download progress** — the browser's native download UI shows progress (`<a download>`); the item
  adds no spinner or progress bar of its own.
- **Label edit swap (title ↔ input)** — Frequency + Function: an inline edit should be instant; focus moves to
  the input and back to the pencil.
- **Toasts** — sonner's own motion (app-level `<Toaster />`), not the item's.
- **Rail hover** — colour only; hover motion is not needed on a two-item rail.

## Step 4 — `review-animations`

| Before                                                                 | After                                                            | Why                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `transition-[transform,…]` with `active:scale-[0.97]`                  | `transition-[scale,…]`                                           | Tailwind 4 animates the `scale` property; `transform` never changed, so the press snapped |
| Row rise `transition-[opacity,transform]` + `starting:translate-y-1.5` | `transition-[opacity,translate]`                                 | Same: the rise jumped instead of easing                                                   |
| shadcn `Button`/`Switch` base `transition-all`                         | Explicit property lists (tailwind-merge replaces the base class) | No unbounded property animation                                                           |
| Pill fade on every render                                              | Fade only after a status change while the screen is open         | Page load must not animate data                                                           |

Kept with justification: dialog enter/exit are symmetric (host primitive, 200 ms, both under budget); the
switch thumb uses the primitive's default curve (`cubic-bezier(0.4,0,0.2,1)`, an ease-in-out for on-screen
movement). Verdict: **Approve** — no keyboard/high-frequency motion, nothing over 200 ms, transform/opacity
only, reduced motion handled.

## Step 5 — `break-ui`

Fixtures (`apps/playground/fixtures/numbers/`), switched with the bottom toggle or
`/dev/numbers?data=demo|worst|empty|agent` in fixtures mode: **Demo** (1 number), **Worst case** (6 numbers:
every status, an 80-character label, a number without label, the 2-letter label "Jo", a 13-digit Mexican
phone, coexistence, manual / Embedded Signup / Connect onboarding, paused agent, draft mode), **Vacío**
(0 numbers) and **Rol agente** (the 6 numbers read-only). Checked at 320 px, 768 px, 1024 px (dark) and
1280 px, and with the root font at 200 %.

| #   | Severity | Field       | Worst case                                   | What happened                                                                   | Fix                                                                                             |
| --- | -------- | ----------- | -------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Ugly     | every text  | root font 200 %                              | `text-[15px]`/`[13px]`/`[11px]` stayed small next to rem-sized controls         | rem sizes (`text-[0.9375rem]`, `text-[0.8125rem]`, …) in `number-row.tsx`, `numbers-screen.tsx` |
| 2   | Ugly     | row actions | 320 px                                       | "Marcar por defecto" and "Desconectar" stacked on separate ragged lines         | Actions take the full row width and wrap right-aligned below `sm`                               |
| 3   | Ugly     | status pill | "Conectado · falta método de pago" at 320 px | A two-line `rounded-full` pill became a lozenge                                 | `rounded-[0.625rem]`                                                                            |
| 4   | Fragile  | last row    | 6 numbers                                    | The end of the list sat under fixed bottom chrome (dev toggle, mobile toolbars) | `pb-16` at the end of the scroll container                                                      |

Decisions: long labels **wrap** (they identify the number; `overflow-wrap:anywhere`); the edit pencil then
wraps below the title, which keeps it next to what it edits. Labels are limited to 80 characters in the UI and
the `setLabel` action; labels written through the API or CLI can be longer and wrap the same way.

Held up: the empty state (admin and read-only copy), one number (singular "1 número"), a number without label
(the phone becomes the title, `tabular-nums`), badges never wrap internally (`whitespace-nowrap`, `flex-none`),
the channel avatar never shrinks, dark mode, the read-only list (no controls, agent state as text).

## SNL-3.2 additions (export, delete history, languages)

No new motion. "Export conversations" is a ghost button link with the same `pressClass` (#1); "Delete history"
uses the disconnect dialog's recipe (#5: host fade + 95 % zoom, `--tw-enter/exit-scale:1` under reduced
motion) and the spinner of #6. The disconnect dialog's extra line ("history stays…") is static text.
`break-ui` on the worst-case fixture with `allowPurge`: on a disconnected row the export and delete buttons
sit in their own bar under the row and wrap right-aligned at 320 px; the full-number label wraps
(`overflow-wrap:anywhere`) for 13-digit phones; English and Spanish labels both fit the 320 px row.
