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

## Step 2 — `find-animation-opportunities`

Recon: Next.js 16 + Tailwind 4 + shadcn new-york; motion tokens above; `motion` 14 available (registry item
dependency only). Personality: a crisp, information-dense operator tool used all day → few, subtle motions. All
CSS motion uses Tailwind `transition-[transform,opacity]` / `transition-[opacity]` with
`duration-[var(--sendo-dur-*)]` and `ease-[var(--sendo-ease-*)]`; entrances use `@starting-style` (Tailwind `starting:`),
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

## Step 3 — implementation

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

## Step 4 — `review-animations`

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

## Step 5 — `break-ui`

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
