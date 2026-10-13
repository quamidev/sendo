# Sendo inbox — MOTION.md

Steps 2–5 of the per-screen process (`CLAUDE.md`, technical spec "UI Design and Motion Workflow") for the
`sendo-inbox` registry item. The skills were installed in WAL-1.1 (`.claude/skills/`) and their procedures were
followed: `find-animation-opportunities` → implement only what was kept → `review-animations` → `break-ui`.

The starting point was the technical spec's recipe table and its rejected list. Every row of that table survived
the gate; nothing was added beyond the table except the press feedback on the send buttons (the spec's "send
buttons" in the ticket) and the desktop image dialog's easing/reduced-motion fix.

## Tokens and reduced-motion semantics

`components/sendo/motion.css` (overridable by the app):

| Token                 | Value                            | Budget                                                   |
| --------------------- | -------------------------------- | -------------------------------------------------------- |
| `--sendo-ease-out`    | `cubic-bezier(0.16, 1, 0.3, 1)`  | entering elements, press                                 |
| `--sendo-ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | on-screen movement (unused today)                        |
| `--sendo-dur-press`   | 120 ms                           | press 100–160 ms                                         |
| `--sendo-dur-fast`    | 160 ms                           | small state changes 125–200 ms                           |
| `--sendo-dur-menu`    | 200 ms                           | entrances / swaps 150–250 ms                             |
| `--sendo-dur-sheet`   | 320 ms                           | reserved for app dialogs; the mobile sheets use a spring |

Reconciled reduced-motion behaviour (`prefers-reduced-motion: reduce`):

- **Durations are not zeroed.** The first version (WAL-4.1) set every `--sendo-dur-*` to `0ms`, which also killed the
  opacity and colour transitions the product spec says to keep. Now the tokens stay as they are, so cross-fades,
  fades and colour changes still run.
- **Movement is removed with a class, not a token.** Every element that moves carries `sendo-motion-transform`, and
  `motion.css` sets `.sendo-motion-transform { transform: none !important }` under reduced motion. That neutralises
  the `@starting-style` rise of new rows/bubbles and the `:active` press scale, while their opacity still fades.
  Verified in Chromium with emulated reduced motion: a new bubble goes opacity 0 → 1 over ~200 ms with
  `transform: none` throughout; a pressed Cerrar button keeps `transform: none`.
- **Springs:** `MotionSheet` reads `useReducedMotion()` from `motion`. When it's on, the sheet doesn't slide: panel
  and backdrop fade (`opacity`, 200 ms, `--sendo-ease-out` values), the drag handle is not rendered and drag is
  disabled (close button, backdrop tap and Escape remain).
- **Desktop image dialog** (host shadcn `Dialog`, `tw-animate-css` keyframes when the app has them): the item adds
  `motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]`, so only its fade remains.
- An app that wants _no_ inbox motion at all can still zero the tokens itself (docs sample `motion-overrides.css`).

## SND-3.5 pass — team inbox (mockup option A)

The redesign added the icon rail, the list header (number selector, search, tabs with counts, tag filters), new
row anatomy, thread banners, notes, system lines, day separators, the draft card and the context panel. The
mockup (`attachments/inbox-option-a.html`) animates a lot; its motions were treated as candidates and run
through the gate like everything else. Static first: every new interactive element got hover and press states
(`pressClass` or colour-only `active:` states) before any motion was added.

### Step 2 — `find-animation-opportunities`

Frequency map: list rows and tabs are used hundreds of times a day; thread switches tens of times; banners,
drafts, pause and the details panel occasionally.

| #   | Element                                                                                            | Trigger                                                                                  | Property                                                                   | Duration                      | Easing             | Purpose                                                        | Frequency  |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------- | ------------------ | -------------------------------------------------------------- | ---------- |
| 11  | Thread banner (`thread-banners.tsx`, `enterBannerClass`)                                           | A banner appears while the thread is open (pause, realtime handoff, number disconnected) | `opacity 0→1`, `translateY(-4px)→0` (`@starting-style`)                    | `--sendo-dur-menu`            | `--sendo-ease-out` | Preventing a jarring change                                    | Occasional |
| 12  | Draft card enter (`draft-card.tsx`, `enterBubbleClass`)                                            | A draft arrives while the thread is open (realtime refresh), never on thread open        | `opacity 0→1`, `translateY(6px)→0`                                         | `--sendo-dur-menu`            | `--sendo-ease-out` | Preventing a jarring change                                    | Occasional |
| 13  | Draft card leave (`leaveDraftClass` + `draftMotionClass`)                                          | Approve / discard succeeded; unmounts after `DRAFT_LEAVE_MS` (200 ms)                    | `opacity → 0`, `translateY(6px) scale(0.98)`                               | `--sendo-dur-menu`            | `--sendo-ease-out` | Feedback + spatial (the card resolves into the sent bubble)    | Occasional |
| 14  | Timeline items appended while open (notes, system lines)                                           | Same rule as bubbles (#3): any key not in `historyKeys`                                  | `opacity 0→1`, `translateY(6px)→0`                                         | `--sendo-dur-menu`            | `--sendo-ease-out` | Feedback that the action happened                              | Occasional |
| 15  | Context side panel, 768–1179 px (`sidePanelMotionClass`)                                           | "Detalles" toggle, Escape, close button                                                  | `translateX(100%)↔0` + `opacity` (CSS transition, retargets mid-flight)    | `--sendo-dur-sheet`           | `--sendo-ease-out` | Spatial consistency (comes from and returns to the right edge) | Occasional |
| 16  | Context sheet, < 768 px (`MotionSheet`)                                                            | Same toggle                                                                              | spring recipe of #7                                                        | spring                        | critically damped  | Spatial consistency, agency                                    | Occasional |
| 17  | Press feedback (`pressClass`): rail items, header actions, Reanudar, draft buttons, details toggle | `:active`                                                                                | `scale(0.97)` (+ colour)                                                   | `--sendo-dur-press`           | `--sendo-ease-out` | Feedback                                                       | Tens/day   |
| 18  | Pause switch (host shadcn `Switch`)                                                                | Toggle                                                                                   | thumb `translateX` (host `transition-transform`), track `background-color` | host 150 ms / `--sendo-dur-*` | host / ease-out    | State indication                                               | Occasional |

Colour-only (no transform): tab pill and tag filter chips (`transition-[color,background-color]`,
`--sendo-dur-fast`), the search box border on focus, the window indicator turning amber.

Rejected:

- **Mockup row rise with a 40 ms stagger on every render** (`.item { animation: rise .42s }`) — Frequency: the list
  re-renders on every tab, tag, search and selection change (hundreds/day); staggering data the operator is
  scanning delays it. Rows only rise when they arrive in the background (#1).
- **Mockup context panel fade (0.5 s, 0.1 s delay) on every conversation switch** — Frequency + Speed: tens/day and
  over budget; the column content swaps instantly.
- **Mockup banner keyframes (`drop .32s`) on every render** — Interruptibility + Frequency: replaced by #11, which
  only runs when a banner appears on an open thread and is a transition.
- **Mockup `.seg .pill` width animation** (composer, SND-3.6) — Properties: animates `width`. SND-3.6 must use one
  pill per segment (opacity cross-fade) or a fixed-width pill moved with `transform: translateX()`/`scaleX()`.
- **Mockup cost chip hover reveal** (`.cost`) — out of scope (SND-4.10), and hover motion in a scrolling thread fires
  constantly.
- **Mockup toasts on every action** ("Conversación asignada a ti", "Agente en pausa"…) — Function: the system line
  that appears in the thread and the badge cross-fade already confirm it; toasts stay for failures only.
- **Banner exit, tag chip removal, row removal** — Properties: the content below would need a height/layout
  animation; they leave instantly.
- **Number selector and rail tooltips** — host shadcn `Select` / `Tooltip` primitives, not re-animated here.
- **Draft "Editar" → textarea swap** — Function: keyboard focus moves into the editor immediately; a fade would
  only delay typing.
- **Unread badge pop, window dot pulse** — Function: data-dense; values change in place (`tabular-nums`).

Verdict: few, small motions. Highest leverage is the draft card leave (#13): it explains where the draft went (it
became the sent agent message that appears in its place).

### Step 3 — implementation

- `transitions.tsx` gained `enterBannerClass`, `leaveDraftClass`, `draftMotionClass`, `sidePanelMotionClass`; all
  carry `sendo-motion-transform` so reduced motion keeps only the fade.
- `thread-banners.tsx` remembers which banners were visible on the previous render (state derived during render);
  only newly visible ones get the enter class, so opening a thread never animates its banners.
- `draft-card.tsx` keeps the card mounted while it leaves and calls `onLeft` after 200 ms; `inbox.tsx` then removes
  the draft and merges the approved message (which enters like any appended bubble).
- `inbox.tsx` renders the side panel always mounted (`inert` while closed) so open/close is one interruptible CSS
  transition; below 768 px the same panel goes into `MotionSheet`.

### Step 4 — `review-animations`

| Before                                                                                               | After                                                                              | Why                                                                        |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Banner enter decided once per thread (`useState(initialKinds)`): resume → pause again didn't animate | Visible kinds tracked per render; a banner that comes back is "entering" again     | Standard 1: the state change happened on screen and needs the same bridge  |
| Draft leave timer re-armed on every parent render (new `onLeft` function each time)                  | Latest `onLeft` kept in a ref; the timer depends only on `leaving`                 | A busy thread (realtime refreshes) could postpone the unmount indefinitely |
| Search box `transition-[border-color,box-shadow]`                                                    | `transition-[border-color]`; the focus ring is instant                             | Only transform/opacity (and colour) animate                                |
| Mockup durations 320–500 ms on panels and banners                                                    | 200 ms banners/cards (`--sendo-dur-menu`), 320 ms side panel (`--sendo-dur-sheet`) | Standard 4 budgets                                                         |
| Mockup keyframes for rise/drop                                                                       | `@starting-style` transitions                                                      | Standard 6: interruptible, no restart from zero                            |

Justified (kept):

- **Switch thumb** uses the host shadcn primitive's `transition-transform` (Tailwind default curve, 150 ms); the item
  only narrows the track to `transition-[background-color,box-shadow]` (no `transition-all`).
- **Side panel enters and exits with `--sendo-ease-out`** — the rule forbids `ease-in`; the exit retargets from the
  current position and leaves along the entry edge.
- **Draft leave is symmetric with the bubble enter (200 ms)** — it's a system response to a click, not a
  press-and-hold.

Browser verification (headless Chromium, playground fixtures on :3113): banner after re-pause at ~30 ms
`opacity 0.43`, `translateY(-2.3px)`, settled at 400 ms; draft leave at 120 ms `opacity 0.05`,
`scale(0.981) translateY(5.7px)`, unmounted by 600 ms; side panel at 60 ms `opacity 0.77`,
`translateX(70px)`, settled at 400 ms. With `prefers-reduced-motion: reduce`: banner and panel keep the opacity fade
with `transform: none`.

### Step 5 — `break-ui`

Fixtures in `apps/playground/fixtures/inbox/team.ts` (plus the earlier ones), through the real boundary (memory
adapter seed → server actions). Checked at 320 × 640, 390 × 844, 1024 × 768 and 1440 × 900, scanning for
`getBoundingClientRect().right > innerWidth`.

| Fixture / value                                                         | Result                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 12 tags incl. "contrato de arrendamiento", "áreas comunes" (Aleksandra) | Row shows 2 chips (`max-w-28`, truncated, `title`) + "+10" (title lists the rest); panel wraps; filter row scrolls with a right fade mask |
| Long name "Aleksandra Wiśniewska-Kowalczyk", long app ref               | Truncates with `title` in row and header; wraps in the panel                                                                              |
| Long handoff reason (~380 characters)                                   | **Fixed**: 6 lines on phones → clamped to 3 below `md` (`title` + the handoff system line carry the full text)                            |
| Pending draft, draft proposed before handoff                            | Card fits 82 % / 560 px; label "propuesto antes del traspaso" wraps under the title on narrow widths                                      |
| Paused agent with window closing (1 h 18 min)                           | Amber in row, header and panel; banner with Reanudar                                                                                      |
| Note thread with a long URL                                             | Note bubble wraps (`break-words`), no overflow at 320 px                                                                                  |
| Disconnected number                                                     | Red banner + disabled composer bar; thread readable                                                                                       |
| Phone-app echo, imported messages, `[#garita]` origin                   | Dashed green bubble "Desde el teléfono", "Importado del teléfono", text without the code + "Origen: garita" chip                          |
| Phone-only contact, "Jo"                                                | Person icon avatar; initial "J"                                                                                                           |
| Empty conversation                                                      | "No ha escrito" in the row, empty thread state                                                                                            |
| Tag filter with no matches                                              | "No hay conversaciones con este filtro."                                                                                                  |
| Channel badge on rows with 3–4 meta lines                               | **Fixed**: badge drifted to the bottom of tall rows → avatar is `self-start` / `h-fit`                                                    |
| List times                                                              | **Fixed**: "01:29 p. m." didn't fit the side column → 24-hour clock (`hourCycle: "h23"`)                                                  |
| Tabs and tag chips past the list width                                  | **Fixed**: cut without affordance → right-edge fade mask on both scroll rows                                                              |
| Header with 4 actions at 320 px                                         | **Fixed**: three rows → details toggle moved to the name row, pause label `sr-only` below `sm`; now two rows                              |
| Agent cost with no agent turns                                          | **Fixed**: "0 turnos —" hidden                                                                                                            |

Not checked: 200 % zoom and RTL (the inbox is Spanish-only). Screenshots: `qa-screenshots/snd-3.5-*.png`.

## SND-3.6 pass — composer, snippet picker, tags, assignment and the admin sheets

New surfaces: the Responder / Nota interna switch with its hint, the `/` snippet picker and zap button, the
unresolved-variable highlight and warning, the "Ventana de 24 h cerrada" bar, the tag picker and assign menu in
the context panel, and the snippets / tags managers. Static first: every new control has hover and press states
(`pressClass` on buttons that commit, colour-only `active:` states elsewhere) before any motion.

### Step 2 — `find-animation-opportunities`

Frequency map: the composer is used tens to hundreds of times a day (typing, Enter); the picker tens of times;
the mode switch, tag picker and assign menu a few times a day; the managers rarely (admins).

| #   | Element                                                                    | Trigger                                                  | Property                                                                            | Duration                                | Easing                | Purpose                                                     | Frequency |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- | --------------------- | ----------------------------------------------------------- | --------- |
| 19  | Snippet picker (`snippet-picker.tsx`, always mounted, `data-state`)        | `/` at the caret or the zap button; Escape, insert, blur | `opacity 0↔1`, `translateY(6px) scale(0.98)↔none`, origin bottom-left               | `--sendo-dur-menu`                      | `--sendo-ease-out`    | Spatial consistency (rises from the text box it belongs to) | Tens/day  |
| 20  | Mode switch pill (`composer.tsx` `ModeSwitch`)                             | Responder ↔ Nota interna (click, arrows)                 | fixed-width pill `translateX(0↔100%)`; labels `color`                               | `--sendo-dur-menu` / `--sendo-dur-fast` | `--sendo-ease-in-out` | State indication                                            | Few/day   |
| 21  | Inline menus (`inline-menu.tsx`: tag picker, assign menu)                  | Trigger opens it                                         | `opacity 0→1`, `translateY(-4px)→0` (`@starting-style`); leaves instantly           | `--sendo-dur-menu`                      | `--sendo-ease-out`    | Spatial consistency (drops from its trigger)                | Few/day   |
| 22  | Unresolved-variable warning (`composer-unresolved`)                        | A `{{variable}}` appears in a reply                      | `opacity 0→1` only                                                                  | `--sendo-dur-fast`                      | `--sendo-ease-out`    | Explanation (why Enviar is disabled)                        | Tens/day  |
| 23  | Note box tint                                                              | Nota interna on/off                                      | `background-color`, `border-color`                                                  | `--sendo-dur-fast`                      | default               | State indication                                            | Few/day   |
| 24  | Press feedback: zap, attach, Plantilla, Nueva …, Guardar, palette swatches | `:active`                                                | `scale(0.97)` (`pressClass`)                                                        | `--sendo-dur-press`                     | `--sendo-ease-out`    | Feedback                                                    | Tens/day  |
| 25  | Snippets / tags managers (`manager-sheet.tsx`, host shadcn `Dialog`)       | Rail buttons                                             | host `tw-animate-css` fade + zoom (#9 recipe: item ease-out, no scale when reduced) | host 200 ms                             | `--sendo-ease-out`    | Preventing a jarring change                                 | Rare      |
| 5   | Text box ↔ template bar (`swapInClass`, kept from WAL-4.x)                 | The window closes / reopens while on screen              | incoming one fades in place                                                         | `--sendo-dur-menu`                      | `--sendo-ease-out`    | Preventing a jarring change                                 | Rare      |

Rejected:

- **Mockup `.seg .pill` width transition** — Properties: animates `width`. The two segments are equal columns, so
  the pill keeps half the control's width and only moves with `transform` (#20).
- **Mockup `.warnvar` `drop` keyframe** — Interruptibility + Function: a keyframe restarts from zero when the text
  changes on every keystroke, and movement under the text box adds nothing; the warning only fades (#22).
- **Mockup `.tagmenu` `drop` keyframe on every open** — replaced by the `@starting-style` transition (#21), which
  retargets if the menu is toggled quickly.
- **Picker active option highlight / smooth scroll to it** — Frequency: arrows are pressed in bursts; the highlight
  is a colour change and the list jumps (`scrollIntoView({ block: "nearest" })`).
- **Picker exit when a snippet is inserted** — kept as the same transition (#19); no extra "insert" flash on the
  text: the amber marks already show what still needs filling.
- **Textarea auto-grow** — Properties: height. It grows instantly (`field-sizing: content`, max 10 lines).
- **Toasts for "Nota guardada" and "Enviado · el agente sigue a cargo"** — Function: the note / bubble appears in the
  thread (#3/#14) and the step-in hint stays visible above the box. The one toast kept is "Respondiste tú; el
  borrador se descartó": it explains why the draft card disappeared (explanation, not success).
- **Tag chip add/remove, row removal in the managers, the confirm row** — Properties: neighbours would need layout
  animation; they appear and leave instantly, and focus moves to the next control.
- **Manager row ↔ edit form swap, inline template picker reveal** — Function: focus goes straight into the form.
- **Menu exit (#21)** — Function: the menu closes because a choice was made or Escape was pressed; the result (new
  chip, new assignee) is the feedback. Unmounting keeps focus management simple.

### Step 3 — implementation

- `snippet-picker.tsx` stays mounted while the composer shows the text box; closed it is `inert`, `opacity-0`,
  `pointer-events-none` and translated, so open and close are one CSS transition that retargets mid-flight.
- `composer.tsx` `ModeSwitch`: `grid-cols-2`, pill `w-[calc(50%-2px)]`, `[transform:translateX(100%)]` for Nota interna,
  `transition-transform` with `--sendo-ease-in-out` (on-screen movement). Under reduced motion
  `motion-reduce:transition-none` makes it jump; the label colours still fade. (It can't use
  `sendo-motion-transform`: that class would pin the pill to the first segment.)
- `inline-menu.tsx` carries the #21 enter class; `sendo-motion-transform` drops the movement under reduced motion.
- The unresolved warning uses `starting:opacity-0` only.

### Step 4 — `review-animations`

| Before                                                                                                 | After                                                                                                             | Why                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Picker mounted on open (enter only, exit cut)                                                          | Always mounted with `data-state`; exit runs the same transition backwards                                         | Standard 6: interruptible; a quick `/` + Escape retargets instead of popping            |
| Highlight layer in a scrolling wrapper (textarea `overflow:hidden`)                                    | The textarea scrolls; the layer is pinned behind it and follows `scrollTop`                                       | A long snippet left the caret out of view (found at 390 px)                             |
| `.md` docs of the item spelled out an arbitrary `ease-` class whose token name ended in a `*` wildcard | Prose instead; `motion-lint.test.ts` fails on any arbitrary-value class with a wildcard in the item's `.md` files | Tailwind scans the installed `components/sendo/inbox/MOTION.md` and emitted invalid CSS |
| Palette swatches with their own `transition-[border-color]` and `pressClass`                           | `pressClass` only                                                                                                 | Two `transition-*` utilities: the last one silently won                                 |

Justified (kept):

- **Pill uses `ease-in-out`** — it moves between two on-screen positions (rule: `ease-in-out` for on-screen
  movement); 200 ms, interruptible (reversed mid-flight it retargets from its current `translateX`).
- **Picker exit uses ease-out at the same duration** — never `ease-in`; with the strong curve it is at ~0.17 opacity
  after 60 ms, so it gets out of the way quickly.
- **Managers use the host `Dialog` animation** — same justification as #9 (modal, rare, from the app's shadcn).

Browser verification (Chromium, playground fixtures on :3116): picker open — 18 ms `opacity 0`,
`scale(0.98) translateY(6px)`; 65 ms `opacity 0.83`, `translateY(1px)`; settled by 216 ms. Escape right after —
61 ms `opacity 0.17`, `translateY(5px)`; settled closed by 311 ms. Pill: width constant at 92.2 px (= a segment),
`translateX` 0 → 46 px at ~100 ms, reversed mid-flight 39 → 1 px in 80 ms. Reduced motion: picker `transform`
resolves to `none` (opacity still fades), pill `transition-property: none`.

### Step 5 — `break-ui`

Fixtures (memory adapter seed → real server actions): `apps/playground/fixtures/inbox/snippets.ts` — 50 snippets
visible to the dev user (team + personal), `plan-pagos` with `{{fecha_limite}}` that nothing resolves, the
32-character shortcut `recordatorio-cuota-mantenimiento` with a ~600-character body, one snippet scoped to the
disconnected number, another operator's personal snippet; `resolveSnippetVariables` in `lib/sendo.ts` resolves
`saldo` for linked residents; the 12 tags of SND-3.5. Checked at 1440 × 900, 390 × 844 and 320 × 640, scanning for
`getBoundingClientRect().right > innerWidth`.

| Fixture / value                                         | Result                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 50 snippets                                             | Picker caps at `min(20rem, 50dvh)` and scrolls; the active option stays in view with the arrows                           |
| 32-character shortcut, long body                        | Shortcut and body truncate in the picker (`title`-free: the body is inserted on pick); managers clamp the body to 2 lines |
| Long body inserted at 390 px                            | **Fixed**: caret was out of view → the textarea scrolls (max 10 lines), the highlight layer follows                       |
| `{{fecha_limite}}` unresolved                           | Amber mark aligned with the text, the variable is selected after insert, warning wraps, Enviar disabled                   |
| Accents (`días`, `María José`)                          | Search is accent-insensitive (`searchSnippets`); marks stay aligned with diacritics                                       |
| Disconnected-number snippet / other operator's personal | Not in the picker of a main-number conversation; the first one is listed in the manager with its number badge             |
| Picker at 320 px                                        | Full width minus 12 px, covers the banner area; keys hint hidden below `md`; mode hint truncates                          |
| 12 tags in the tag menu                                 | Menu caps at `max-h-64` and scrolls; long names truncate with `title`                                                     |
| Assign menu with only the operator as assignee          | **Fixed**: "No hay personas para esta cola." showed next to "Asignarme" → shown only when the list is empty               |
| Delete a tag used by 3 conversations                    | Confirm reads "Se quitará de 3 conversaciones"; chips, filters and rows drop it                                           |
| Duplicate shortcut                                      | "Ya existe una respuesta con ese atajo." under the field; nothing else is lost                                            |

Not checked: 200 % zoom, RTL (Spanish-only), Firefox (`field-sizing: content` is Chromium/Safari; Firefox keeps a
one-line textarea that scrolls). Screenshots: `qa-screenshots/snd-3.6-*.png`.

## Earlier pass (WAL-4.x): composer, sheets, media, list and thread basics

### Step 2 — `find-animation-opportunities`

Recon: Next.js 16 + Tailwind 4 + shadcn new-york; motion tokens above; `motion` 14 available (registry item
dependency only). Personality: a crisp, information-dense operator tool used all day → few, subtle motions. All
CSS motion uses Tailwind `transition-[transform,opacity]` / `transition-[opacity]` with
durations and easings read from the `--sendo-dur-…` / `--sendo-ease-…` tokens (arbitrary `duration-[…]` / `ease-[…]`
values); entrances use `@starting-style` (Tailwind `starting:`),
so nothing needs JS and every transition retargets from its current value.

### Conversation list (`conversation-list.tsx`, `inbox.tsx`)

| #   | Element                                                | Trigger                                                                                          | Property                                                   | Duration           | Easing             | Purpose                                 | Frequency  |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------ | ------------------ | --------------------------------------- | ---------- |
| 1   | New conversation row (`<li>`, `enterRowClass`)         | Row arrives via realtime refresh after mount (`enteringIds`, computed in `loadList({ silent })`) | `opacity 0→1`, `transform translateY(4px)→0`               | `--sendo-dur-menu` | `--sendo-ease-out` | Preventing a jarring change (list jump) | Occasional |
| 2   | Status badge (`ConversationStatusBadge` → `CrossFade`) | `status` changes (handoff, take, return, close, realtime)                                        | `opacity` cross-fade, both states stacked in one grid cell | `--sendo-dur-fast` | `--sendo-ease-out` | State indication                        | Occasional |

Rejected:

- **Row selection highlight animating** — Frequency: tens–hundreds/day, keyboard and click driven. Instant (colour only).
- **Rows on first render, filter change or "Cargar más"** — Frequency + Function: user-requested data the operator is about to read; motion only delays it. `enteringIds` is reset on non-silent loads.
- **Re-ordering rows (FLIP) when activity moves a conversation to the top** — Function + Speed: would need layout animation of every row; the list is data-dense and re-sorts often.
- **Unread counter pop / relative-time ticking** — Function: data-dense; numbers use `tabular-nums` and change in place.

### Thread (`thread.tsx`, `message-bubble.tsx`, `status-ticks.tsx`)

| #   | Element                                         | Trigger                                                                                                              | Property                                     | Duration           | Easing             | Purpose                                   | Frequency                             |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------ | ------------------ | ----------------------------------------- | ------------------------------------- |
| 3   | New message bubble wrapper (`enterBubbleClass`) | Message appended while the thread is open: own send (optimistic) or a received message; any key not in `historyKeys` | `opacity 0→1`, `transform translateY(6px)→0` | `--sendo-dur-menu` | `--sendo-ease-out` | Feedback that the send / receipt happened | Tens/day — kept subtle (6 px, 200 ms) |
| 4   | Delivery ticks (`StatusTicks` → `CrossFade`)    | `status` pending → sent → delivered → read / failed                                                                  | `opacity` cross-fade in a fixed 16 px cell   | `--sendo-dur-fast` | `--sendo-ease-out` | State indication                          | Tens/day, near-imperceptible          |

The optimistic bubble keeps its React key when the stored message replaces it (`clientKey`, preserved by
`mergeMessages`), so the bubble doesn't re-enter and the ○ → ✓ change cross-fades instead of popping.

Rejected:

- **History loading ("Cargar anteriores") / first page** — Frequency + Function: scroll-initiated; bubbles appear in place and the scroll position is restored without animation.
- **Animated scroll to the newest message** — Frequency: every open/send; a smooth scroll delays reading. Jump instantly.
- **Failed-send error line sliding in** — Function: an error should be readable immediately; the tick cross-fade already signals the change.
- **Media thumbnail fade-in on load** — Function: images load progressively already; adds latency.

### Composer and template picker (`composer.tsx`, `template-picker.tsx`, `window-indicator.tsx`)

| #   | Element                                                                                   | Trigger                                                                               | Property                                                       | Duration                                    | Easing             | Purpose                     | Frequency        |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------- | ------------------ | --------------------------- | ---------------- |
| 5   | Composer ↔ template picker (`swapInClass`)                                                | Window closes (countdown, `WINDOW_CLOSED`) or reopens while on screen; never on mount | Incoming one fades in place `opacity 0→1`                      | `--sendo-dur-menu`                          | `--sendo-ease-out` | Preventing a jarring change | Rare             |
| 6   | Send button, template "Enviar plantilla", mobile "Enviar plantilla" opener (`pressClass`) | `:active` (pointer-down)                                                              | `transform scale(0.97)` (+ background colour)                  | `--sendo-dur-press`                         | `--sendo-ease-out` | Feedback                    | Tens/day, subtle |
| 7   | Template picker sheet on mobile (`MotionSheet`)                                           | open / close / drag                                                                   | spring on `y` (translate), backdrop `opacity` follows position | spring: `bounce 0`, `visualDuration 0.35 s` | critically damped  | Spatial consistency, agency | Occasional       |

Rejected:

- **Window countdown digits** — Function: data-dense; only the colour changes (`transition-colors`) when it enters the last hour.
- **Composer textarea auto-grow animation** — Properties: would animate `height`. Grows instantly.
- **Attachment chip enter** — Frequency/Function: immediate confirmation of a file pick is better than a fade.
- **Template variable inputs appearing** — Function: form fields the operator is about to type in.

### Media preview (`media-preview.tsx`)

| #   | Element                                                | Trigger                                   | Property                                                                      | Duration                                   | Easing                               | Purpose                     | Frequency  |
| --- | ------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------ | --------------------------- | ---------- |
| 8   | Image preview sheet on mobile (`MotionSheet dragBody`) | open / close / drag anywhere on the image | spring on `y`, backdrop `opacity`                                             | spring `bounce 0`, `visualDuration 0.35 s` | critically damped                    | Spatial consistency, agency | Occasional |
| 9   | Image dialog on desktop (host shadcn `Dialog`)         | open / close                              | `opacity` + `scale(0.95→1)` from the host's `tw-animate-css` (when installed) | host `duration-200`                        | `--sendo-ease-out` (set by the item) | Preventing a jarring change | Occasional |

Rejected:

- **Shared-element zoom from the thumbnail into the preview** — Speed + Function: needs layout measurement of both boxes; showy for a utility preview.
- **Thumbnail hover zoom** — Frequency: hover in a scrolling thread fires constantly; hover stays opacity-only.

### Handoff actions (`thread.tsx` header)

| #   | Element                                            | Trigger                  | Property                                      | Duration            | Easing             | Purpose          | Frequency  |
| --- | -------------------------------------------------- | ------------------------ | --------------------------------------------- | ------------------- | ------------------ | ---------------- | ---------- |
| 10  | Tomar / Devolver al agente / Cerrar (`pressClass`) | `:active` (pointer-down) | `transform scale(0.97)` (+ background colour) | `--sendo-dur-press` | `--sendo-ease-out` | Feedback         | Occasional |
| —   | Resulting status                                   | action resolves          | badge cross-fade (#2)                         | `--sendo-dur-fast`  | `--sendo-ease-out` | State indication | Occasional |

Rejected (spec list): **toasts on every successful action** — noise; only failures toast. **Button loading spinner
rotation** — the `LoaderIcon` is static on purpose (the action resolves in well under a second).

### Spring recipe (sheets)

- `SHEET_SPRING = { type: "spring", bounce: 0, visualDuration: 0.35 }` — apple-design default (damping 1,
  response 0.3–0.4 s), no overshoot.
- Enter: from `translateY(height)` to 0. Exit: back to `translateY(height)` (same edge as the entry), then unmount.
- Response starts on pointer-down: `y.stop()` catches the sheet mid-flight; a tap without a drag resumes the open
  spring.
- Drag: the handle + header (and the whole body for the image) track the finger 1:1; upward over-drag is
  rubber-banded (`(1 − 1/(x·0.55/d + 1))·d`), and a background extension fills the gap below.
- Release: Apple's momentum projection `y + (v/1000)·0.998/(1 − 0.998)` decides dismiss (past half the height)
  vs. return, and the release velocity is handed to the spring (`velocity: info.velocity.y`). A flick of ~60 px
  dismisses; a slow 80 px drag springs back.
- Interruptible: every `animate()` runs on the same motion value, so a reopen during the exit (or a grab during the
  entry) retargets from the current position and velocity.

### Verdict

The inbox needs little motion and the spec's table was already close to right: eight small CSS transitions and one
spring component. Highest leverage: the new-bubble enter (#3), the most frequent piece of feedback.

### Step 3 — implementation

- `components/sendo/transitions.tsx` — the class recipes (`enterRowClass`, `enterBubbleClass`, `swapInClass`,
  `pressClass`) and `CrossFade`.
- `components/sendo/motion-sheet.tsx` — `MotionSheet` (Radix Dialog primitive for focus trap, Escape, aria;
  `motion` for the spring and pan gesture). Replaces the shadcn `Sheet` in `composer.tsx` and `media-preview.tsx`
  (the `sheet` registry dependency was dropped; `radix-ui` is now a declared npm dependency).
- `inbox.tsx` — `enteringIds` (rows that arrived in a silent refresh, cleared after 600 ms), `historyKeys` per
  thread, `clientKey` for optimistic → stored replacement.
- `motion-lint.test.ts` — fails on `transition-all`, `ease-in` (not `ease-in-out`) / `easeIn`, and on
  transitions or `motion` props targeting `height`, `width`, `padding`, `margin`, `max-/min-height/width` in any
  `.tsx`/`.css` of the item.

### Step 4 — `review-animations`

Findings table (all resolved):

| Before                                                                                                                                                         | After                                                                                                    | Why                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `motion.css` reduced motion: every `--sendo-dur-*: 0ms`                                                                                                        | Durations kept; `.sendo-motion-transform { transform: none !important }`                                 | Standard 8: gentler, not zero — keep opacity/colour, drop movement                                           |
| shadcn `Sheet`: `ease-in-out` keyframes, 500 ms open / 300 ms close, no drag                                                                                   | `MotionSheet`: critically damped spring, drag-to-dismiss, velocity handoff, exits along the entry path   | Standards 3, 4, 6: keyframes aren't interruptible; gestures need springs                                     |
| `MotionSheet` animated via a `useRef` panel: Radix's portal mounts content one commit later, so the first open had no animation and a reopen stayed off-screen | Panel held in state (`ref={setPanel}`), effect depends on it                                             | Bug found in the browser (y stuck at 457 px)                                                                 |
| Backdrop opacity derived with `useTransform`                                                                                                                   | Backdrop driven synchronously from `y`/`fade` change events                                              | First frame painted the backdrop at full opacity while the sheet was still off-screen                        |
| Row enter class kept on the `<li>`                                                                                                                             | Removed 600 ms after arrival                                                                             | `@starting-style` replays when an element leaves `display: none` (mobile list hidden while a thread is open) |
| Optimistic bubble replaced by the stored message with a new key                                                                                                | `clientKey` keeps the key                                                                                | The bubble re-entered and the ○ → ✓ tick popped instead of cross-fading                                      |
| `transition-colors` + shadcn `transition-all` on buttons                                                                                                       | `transition-[transform,color,background-color,border-color]` (`pressClass`); `cn` drops `transition-all` | Escalation trigger: unbounded `transition: all`                                                              |
| Desktop dialog: `tw-animate-css` default `ease`, scales under reduced motion                                                                                   | `ease-[var(--sendo-ease-out)]`, `motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]`   | Standards 3 and 8                                                                                            |

Justified (kept as is):

- **Pure-fade entrances** (badge, ticks, composer swap) — escalation trigger "pure fade with no initial transform".
  These are in-place state changes, not arrivals; a translate would suggest the element came from somewhere.
  Spec: "cross-fade in place".
- **Symmetric press timing** (120 ms in and out) — Standard 9 targets press-and-hold or destructive confirms. These
  are taps; a slower release would make the next tap feel laggy.
- **`motion` `y` (main-thread) for the sheets** — performance note "shorthands are not hardware-accelerated". The
  sheet is gesture-driven and must follow the finger per frame on the main thread anyway; nothing else animates
  while it runs. All non-gesture motion is CSS.
- **Bubble enter on own sends (tens/day)** — Standard 2. Kept because it's the spec's feedback for "the send
  happened", at 6 px / 200 ms with a strong ease-out (opacity is ~0.43 after the first frame); never on history,
  thread switches or scroll.
- **Desktop dialog scales from centre** — Standard 5 exempts modals. It uses whatever the host's shadcn `Dialog`
  ships (keyframes, not interruptible); it opens on a click a few times a day.
- **CrossFade width** — while two badges are stacked the cell is as wide as the wider one, and it snaps to the new
  width when the old layer is removed (300 ms). Neighbours don't move during the fade; one ≤ 8 px snap after it is
  accepted over animating `width`.
- **Sheet drag disabled under reduced motion** — the sheet still closes with the button, backdrop and Escape.
- **No hover motion anywhere** — hover is colour/opacity only, so no `(hover: hover)` gating is needed.
- **Host primitives not touched** — the `Select` dropdown and `Tooltip` animations come from the app's shadcn
  components.

Browser verification (Chromium, playground `dev:fixtures`):
bubble enter `opacity 0 → 0.43 → 1`, `translateY(6px) → 0` in ~200 ms; tick pending → sent cross-fades;
pointer-down on "Devolver al agente" reaches `scale(0.97)` within ~6 frames and holds; the badge cross-fades
Humano 1→0 / Agente 0→1 in ~160 ms with no toast; sheet open/close/reopen-mid-exit retargets (y 247 → 0); slow
80 px drag springs back to 0, upward over-drag of 200 px moves 77 px, a 60 px flick dismisses; reduced motion
keeps the fades with `transform: none`. Row enter can't be triggered in fixtures mode (no realtime), so it's
covered by `conversation-list.test.tsx` plus the same `@starting-style` mechanism verified on bubbles.

Decision: **Approve** — no open findings.

### Step 5 — `break-ui`

Data came through the real boundary: the playground's fixtures (`apps/playground/fixtures/inbox/`, WAL-4.2),
loaded with `npx pnpm@10.34.6 --filter playground dev:fixtures` and the "Todas" filter, which puts every worst case
in one list. The fixtures themselves are the dev-only "worst case" dataset (no separate toggle was added; the
playground never ships). Checked at 320 × 640, 390 × 844 and 1920 × 1080, scanning every element for
`getBoundingClientRect().right > innerWidth` and `scrollWidth > innerWidth`.

| Fixture / value                                                                            | 320 px                                                                           | 390 px                                                                      | 1920 px               | Result                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| 60-character name "María Fernanda de los Ángeles Castañeda Villagrán de Ordóñez"           | Row and header truncate with `title`; avatar, time and badge keep size           | same                                                                        | Header fits (1014 px) | Held                                                                                           |
| 500-message thread "Carlos Méndez"                                                         | Latest 50 render, "Cargar anteriores" keeps position, no enter motion on history | same                                                                        | same                  | Held                                                                                           |
| Empty conversation                                                                         | Empty state centred, template picker below                                       | same                                                                        | same                  | Held                                                                                           |
| Failed send (Meta 131047)                                                                  | ⚠ tick + error line wraps inside the bubble width                                | same                                                                        | same                  | Held                                                                                           |
| Missing media (download failed / unreachable URL)                                          | Dashed placeholder `w-56 max-w-full`, caption below                              | same                                                                        | same                  | Held                                                                                           |
| Pending media / pending status "Diego Pac"                                                 | Placeholder + ○ tick                                                             | same                                                                        | same                  | Held                                                                                           |
| Header actions (Tomar / Devolver / Cerrar)                                                 | Wrap to their own row; rightmost ends at 308 px                                  | —                                                                           | inline                | Held                                                                                           |
| Long template variables (60-char name; 128-char date/location with "Wiśniewska-Kowalczyk") | —                                                                                | Preview wraps, inputs scroll horizontally, sheet 537 px of 844, no overflow | Inline picker         | Held                                                                                           |
| Relative time of a just-updated conversation                                               | "en 13 segundos" (future)                                                        | same                                                                        | same                  | **Fixed**: `formatRelative` clamps to `now` (the 15 s floored clock was behind fresh activity) |

What held up: truncation with `title` on names and previews, `shrink-0` on avatars, badges, ticks and counters,
`tabular-nums` on times and counts, `99+` cap on unread counts, initials from letters (phone-only contacts get an
icon), `max-w-full` on media, `break-words` on bubbles and the template preview.

Not checked: 200 % zoom and RTL (the inbox is Spanish-only; RTL isn't supported). Dark mode was checked in WAL-4.3
and no colours changed here.

Screenshots: `qa-screenshots/inbox-motion-desktop.png`, `inbox-motion-mobile-sheet.png`, `inbox-break-ui-320.png`
(and `inbox-break-ui-320-list.png`) in the feature folder.

## Polling fallback and "Envíos" rail link (SND-4.5)

No new motion. Without Supabase Realtime the inbox polls (list every 10 s, open thread every 3 s, paused while
the tab is hidden). Polled refreshes go through the same paths as realtime refreshes (`loadList({ silent })`
and `refreshThread`), so rows and drafts that arrive by polling use the existing row enter (`enterRowClass`) and
draft card enter (`enterBubbleClass`) and nothing else; a poll that finds no change renders nothing new. The rail's
"Envíos" link is another `RailItem` with the existing press feedback.

## SND-4.10 pass — turn cost on hover, conversation cost, voice-note transcripts

Static first: the cost line (`TurnCost` in `message-bubble.tsx`) is a bordered chip in the message's meta row,
before the time, rendered only for actors with `costs.view` and only on agent replies (drafts show their usage
in the draft card). Voice notes render the player, then the transcript (normal bubble text) or a muted
"Sin transcripción" line with the reason as its `title`. The panel's "Costo del agente" now shows the whole
conversation's total from `sendo.inbox.cost` (thread action, latest page) plus "N sin costo" when some turns
have no known cost. None of these are interactive, so no new hover/press states were needed.

### Step 2 — `find-animation-opportunities`

| #   | Element                          | Trigger                                                      | Property      | Duration           | Easing             | Purpose          | Frequency              |
| --- | -------------------------------- | ------------------------------------------------------------ | ------------- | ------------------ | ------------------ | ---------------- | ---------------------- |
| 19  | Turn cost chip (`turnCostClass`) | Pointer over the message, or focus inside it (fine pointers) | `opacity 0→1` | `--sendo-dur-fast` | `--sendo-ease-out` | State indication | Tens/day (admins only) |

Rejected:

- **Mockup `.cost` rise (`translateY(-2px)→0`)** — Frequency: the pointer crosses bubbles constantly while an
  admin scrolls a thread; a moving chip on every crossing is noise. Opacity alone says "here's the cost" and
  leaves nothing for reduced motion to remove.
- **Hover delay before the reveal** — Function: the chip reserves its space (no reflow) and fades in 160 ms; a
  delay would make reading several turns in a row feel sluggish, and the reveal is cheap to dismiss.
- **Tooltip/popover for the cost** — Function: the mockup puts it inline in the meta row; a portal tooltip would
  cover neighbouring bubbles.
- **Counting animation of the "Costo del agente" total** — Function: data in a dense panel; it changes in place
  (`tabular-nums`).
- **Transcript fade-in when the transcription lands** — the transcript is stored before the agent turn and arrives
  with the normal thread refresh; an extra fade on text that already sits inside an entering bubble (#3) would
  double the motion.

### Step 3 — implementation

`transitions.tsx` `turnCostClass`: `transition-[opacity]` with `--sendo-dur-fast` / `--sendo-ease-out`, hidden
only under the `pointer-fine` variant and revealed by `group-hover/bubble` and `group-focus-within/bubble` (the
bubble wrapper is `group/bubble`). Coarse pointers (phones, tablets) have no hover, so the chip is always visible
there. The chip keeps its box while hidden, so revealing it never reflows the row. A screen reader gets the full
sentence ("Costo del turno: $0.0024; 1102 tokens de entrada, 64 de salida") whether or not it's visible.

### Step 4 — `review-animations`

- Only `opacity` animates; 160 ms is inside the tooltip budget (125–200 ms); ease-out enter, and the exit is the
  same transition reversed, so it retargets mid-flight when the pointer leaves early.
- Reduced motion: nothing moves, the fade stays (colour/opacity transitions are kept by design).
- Hover is gated to fine pointers (touch taps never leave a chip stuck half-visible).

### Step 5 — `break-ui`

- `costCents: null` → the chip reads "—" plus tokens; tokens unknown → cost only.
- Large values: `$12.3456 · 1.234.567 → 98.765 tokens` wraps onto its own line inside the meta row
  (`flex-wrap`) instead of overflowing on 320 px.
- Conversations longer than one thread page: the panel total comes from the server, not the loaded page.
- A voice note over 25 MB, a timeout or a provider failure → "Sin transcripción" with the reason; an empty
  transcript is treated as a failure (`empty`).
