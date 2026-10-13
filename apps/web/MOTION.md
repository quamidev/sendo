# Docs site motion (`apps/web`)

`find-animation-opportunities` report for the docs site (`/docs`, `/docs/<slug>`), following
`emil-design-eng` and the product spec's "UI Design and Motion" rules. Step 1 (static build with
hover and press states, light and dark, mobile-first) came first; only the motions kept below are
implemented.

## Recon

- Stack: Next.js 16 App Router, Tailwind 4, shadcn new-york tokens, `lucide-react`. No motion library.
- Personality: reference documentation read for long stretches and scanned repeatedly. That argues
  for very little motion.
- Existing tokens: none in `apps/web`. The inbox's `--sendo-*` tokens live in the registry item and are
  not loaded here, so the kept recipes use the skill's shared curve `cubic-bezier(0.23, 1, 0.32, 1)`
  inline as Tailwind arbitrary values.
- Frequency map: sidebar / pager / TOC links and anchors (tens per session), copy button
  (occasional, a few per page), theme toggle (rare), code blocks and tables (read, never acted on).

## Part 1: Kept motions

| #   | Location                                   | Today (static)                              | Purpose          | Frequency  | Motion                                                                                                                                                                                                                      |
| --- | ------------------------------------------ | ------------------------------------------- | ---------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `components/docs/copy-button.tsx` (icons)  | Copy icon swapped to a check with no bridge | State indication | Occasional | Cross-fade between the copy and check icons: `opacity 0→1` + `transform: scale(0.9)→none`, `150ms cubic-bezier(0.23, 1, 0.32, 1)`; both directions via CSS transitions (interruptible on rapid clicks). Resets after 1.6 s. |
| 2   | `components/docs/copy-button.tsx` (button) | Colour-only press state                     | Feedback         | Occasional | `:active { transform: scale(0.97) }`, `transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1)`; starts on pointer-down. Colour press state (`active:bg-accent/70`) kept as well.                                        |

Rules applied: only `transform` and `opacity` are transitioned (`transition-[opacity,transform]`,
`transition-[transform]`; no `transition-all` in docs components), never `ease-in`, never from
`scale(0)`, durations inside the 100-160 ms press / 125-200 ms small-state budgets.

**Reduced motion:** `motion-reduce:[transform:none]` on both icons and on the pressed button. The
icon swap remains an opacity cross-fade (it aids comprehension), and colour press states remain.

Every other interactive element (sidebar, header links, TOC, pager cards, heading anchors, inline
links, index cards, theme toggle) has hover and `:active` states expressed as colour/opacity
changes with no transition.

## Part 2: Rejected candidates

- `components/site/docs-sidebar.tsx`: sliding active indicator between sidebar items.
  **Rejected (frequency + function):** core navigation used tens of times per session; the page
  content changes anyway, so a moving pill adds latency without information.
- `app/docs/*`: route/page enter transition (fade or slide of the article on navigation).
  **Rejected (frequency):** navigation is the most frequent action in docs; animating it makes every
  click feel slower.
- `components/docs/heading.tsx`: fading in the `#` anchor on heading hover.
  **Rejected (frequency + purpose):** hover reveal happens constantly while reading; an instant
  opacity change is enough.
- `components/docs/doc-page.tsx`: staggered entrance of the "On this page" list and the index
  cards. **Rejected (purpose):** decorative; content the user is about to read should be there
  immediately.
- Smooth scrolling to anchors (`scroll-behavior: smooth`). **Rejected (frequency + function):**
  TOC and anchor jumps are scanning actions, often repeated; instant jumps keep orientation through
  the URL hash and `scroll-mt-24` offset.
- Theme toggle icon rotation / page colour cross-fade. **Rejected:** rare, but `next-themes` runs
  with `disableTransitionOnChange` on purpose so every element switches together; a sun/moon spin is
  "looks cool", not a purpose.
- Callout / code block entrance on scroll. **Rejected (function):** reference content the user is
  reading; decoration hinders.

## Part 3: Verdict

The docs need almost no motion. The single moment that benefits is the copy button, where the
icon swap confirms an action with no other visible result; the press scale makes it feel
responsive. Everything else stays static by design.

## review-animations notes

- Checked the kept motions against the review checklist: exact properties (no `transition: all`),
  custom ease-out curve, sub-200 ms durations, interruptible transitions (no keyframes), no hover
  animations (so no `(hover: hover)` gating needed), reduced motion handled. No open findings.
- `components/ui/button.tsx` (shadcn primitive, theme toggle) keeps its upstream `transition-all`
  for colour changes; it is not a docs component and is left unchanged.

---

# Landing (`/`), live demo (`/demo`) and changelog (SND-4.9)

Per-screen process: the landing, the demo chat (`components/demo/demo-chat.tsx`) and `/changelog`
were built static first (hover and `:active` colour states on every control, light and dark, 320 px
up), then swept with `find-animation-opportunities`. The inbox inside the demo iframe is the
registry item, with its own motion (`registry/items/inbox/MOTION.md`); nothing here changes it.

## Recon

- Personality: a marketing page seen once or twice per visitor, plus a toy chat used for a few
  minutes (at most 20 messages a session). More room for motion than the docs, but the hero is
  read and the commands are copied, so they stay still.
- Tokens: the inbox's `--sendo-*` tokens load only inside the iframe; the parent pages use the same
  inline curve as the docs, `cubic-bezier(0.23, 1, 0.32, 1)`.
- Frequency: copy buttons (once or twice), chat send / suggestion chips (a few times a session),
  new chat messages (each send, plus the agent's reply), reset (rare), header links (navigation).

## Kept motions

| #   | Location                                                | Today (static)                                           | Purpose                     | Frequency                     | Motion                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------- | -------------------------------------------------------- | --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `demo-chat.tsx` `ENTER` (bubbles, typing row)           | New messages and the agent's reply appear with no bridge | Preventing a jarring change | Occasional (≤ 40 per session) | `@starting-style` (`starting:` variant): `opacity: 0; transform: translateY(6px)` → settled, `transition: opacity, transform 200ms cubic-bezier(0.23, 1, 0.32, 1)`. Only turns added while the page is open: the ones restored from `sessionStorage` (`restored`) render without it. |
| 2   | `demo-chat.tsx` `PRESS` (send button, suggestion chips) | Colour-only press                                        | Feedback                    | Occasional                    | `:active { transform: scale(0.97) }`, `transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1)`; none while disabled.                                                                                                                                                             |
| —   | Landing copy buttons                                    | —                                                        | —                           | —                             | The docs `CopyButton` as-is (motions 1–2 above).                                                                                                                                                                                                                                     |

**Reduced motion:** `motion-reduce:` removes the translate of #1 (the fade stays, it still marks the
new message) and the press scale of #2 (colour press states stay).

## Rejected candidates

- Hero entrance (fade / stagger of the heading, copy and commands). **Rejected (function):** the
  visitor came to read it and copy a command; any delay costs the one moment that matters (and LCP).
- Typing indicator dots bouncing. **Rejected (purpose):** a looping decoration; the header and the
  row already say "escribiendo…", which is enough state indication.
- Smooth scrolling the chat to the newest message. **Rejected (frequency + function):** it happens on
  every message; an instant jump keeps the conversation readable, and the bubble's own enter motion
  already bridges the change.
- Cross-fading the whole conversation on "Empezar de nuevo". **Rejected (frequency + purpose):** a
  deliberate reset; an instant clear is clearer feedback than a fade.
- Animating the iframe or the inbox when the visitor's conversation arrives. **Rejected:** the inbox
  item already plays its row-enter motion for rows that arrive in the background; doubling it here
  would fight the item's own `MOTION.md`.
- Changelog: animating the `:target` row of the schema table. **Rejected (purpose):** the colour
  highlight on arrival is enough; movement would make the anchor jump feel slower.

## review-animations notes

- Exact properties only (`transition-[opacity,transform]`, `transition-[transform]`), strong
  ease-out, 120–200 ms, no `ease-in`, no `scale(0)`, CSS transitions/`@starting-style` (interruptible),
  no hover animations. Reduced motion handled. No open findings.

## break-ui notes (demo chat)

Worst case injected at the data boundary (the transcript the chat restores from `sessionStorage`
key `sendo-demo:v1`), checked at 320, 390 and 1440 px, light and dark: a 500-character message (the
server limit), an unbreakable 120-character URL, a one-letter message, an emoji-only message, a
handoff, a team reply with a long name, and 80 turns (the replay limit).

- Fixed: "Te quedan 1 mensajes" → singular for one; URLs broke mid-word with `break-all` → now
  `overflow-wrap: anywhere`; the landing's command rows overflowed the viewport at 390 px (the
  one-column grid sized to content) → `grid-cols-1`; the chat title truncates and carries a `title`.
- Accepted: long command lines truncate with an ellipsis (the full command is in `title` and in the
  copy button); 80 turns scroll inside the chat (no virtualization needed at that size).

---

# Pricing (`/pricing`, SND-5.1)

Built static (colour-only hover and `:active` states on the links, light and dark, 320 px up), then
swept with `find-animation-opportunities`.

- **Kept:** none. A page read once to make a decision; the plan cards and the caveat must be there
  immediately.
- **Rejected:** card hover lift or shadow (decorative; the cards aren't clickable, only their links
  are); staggered entrance of the plans and sections (delays reading); highlighting the Connect
  card (it isn't a recommendation: sensitive-data apps should pick their own Meta app).
- Header: `Changelog` hides below `sm` so five items fit at 320 px (no motion involved).

---

# Site header (SNL-4.2)

`components/site/site-header.tsx` and `components/site/header/*`, following `home-option-b.html`
(`md+`) and `home-mobile-option-a.html` (below `md`). Built static first (colour-only hover and
`:active` states on every link and button, light and dark, 320 px up), then swept with
`find-animation-opportunities`.

## Recon

- Personality: site chrome, present on every page (docs included). Navigation is the most frequent
  action; the language menu and the mobile sheet are occasional; the theme toggle is rare.
- Tokens: none for motion in `apps/web`; the curve is `cubic-bezier(0.23, 1, 0.32, 1)` as before.
  The new primitives (`components/ui/dropdown-menu.tsx`, `components/ui/sheet.tsx`) don't use
  tw-animate-css (not installed); their animations are `--animate-*` theme entries in
  `app/globals.css`.
- Why keyframes here and not transitions: Radix only delays unmounting a closing menu or dialog
  while a CSS **animation** runs (`Presence` reads `animation-name`), so a transition-only exit would
  cut to nothing. Both are opened and closed deliberately and rarely re-triggered mid-motion, so the
  keyframes' lack of interruptibility costs nothing in practice.

## Kept motions

| #   | Location                                      | Today (static)                          | Purpose                     | Frequency  | Motion                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------- | --------------------------------------- | --------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ui/dropdown-menu.tsx` (language menu, `md+`) | Menu pops in and out                    | Spatial consistency         | Occasional | Enter `menu-in`: `opacity 0 → 1` + `transform: scale(0.96) → none`, `150ms cubic-bezier(0.23, 1, 0.32, 1)`, `transform-origin: var(--radix-dropdown-menu-content-transform-origin)` (grows from the globe button). Exit: opacity only, `120ms`, same curve. |
| 2   | `language-selector.tsx` chevron               | Chevron flips instantly                 | State indication            | Occasional | `rotate: 180deg` while open, `transition: transform 150ms cubic-bezier(0.23, 1, 0.32, 1)` (a transition, so interruptible).                                                                                                                                 |
| 3   | `ui/sheet.tsx` (mobile menu, `side="top"`)    | Sheet appears over the page with no cue | Spatial consistency         | Occasional | Enter `sheet-in`: `transform: translateY(-100%) → none` (from the edge the hamburger sits on), `300ms`; exit `sheet-out` back to `translateY(-100%)`, `200ms` (faster than the enter). Same curve.                                                          |
| 4   | `ui/sheet.tsx` overlay                        | Page dims instantly                     | Preventing a jarring change | Occasional | `opacity 0 → 1` in `300ms`, `1 → 0` in `200ms`, matching the sheet.                                                                                                                                                                                         |

**Reduced motion:** the menu and the sheet use the opacity-only `fade-in` / `overlay-in` (and
their exits) through `motion-reduce:`; the chevron's rotation snaps (`motion-reduce:transition-none`).
Colour states stay.

## Rejected candidates

- Press scale (`scale(.96)`) on the pill nav links, as in the mockup. **Rejected (frequency):**
  navigation is the most used control on the site; the docs header already settled on colour-only
  press states, and the pill nav keeps that (`active:bg-background/60`).
- Press scale on the version badge, the language button and the mobile ES/EN segments.
  **Rejected (purpose):** the badge and segments navigate away immediately (full page load for the
  language), and the language button's feedback is the menu itself (#1).
- Hamburger morphing into an X (mockup). **Rejected (function):** the sheet is a modal Radix
  dialog that covers the header, so the trigger is hidden while it's open; the sheet has its own
  close button in the same spot.
- Sliding active pill behind the hovered nav link. **Rejected (frequency + purpose):** decorative on
  the most frequent control; the hover background is enough.
- Sheet links indenting on hover (`padding-left`, mockup). **Rejected (rules):** animates padding;
  colour hover instead.
- Staggered entrance of the sheet links. **Rejected (purpose):** delays the one thing the visitor
  opened the sheet for.
- Cross-fading the page on language switch (mockup's `fade-swap`). **Rejected (function):** the
  switch is a full page load (so `<html lang>` follows); there is nothing to cross-fade.

## review-animations notes

- Only `transform`/`rotate` and `opacity` animate; strong ease-out everywhere, no `ease-in`, nothing
  from `scale(0)`; menu 150/120 ms (budget 150–250, exit faster), sheet 300/200 ms (budget 200–500);
  the menu scales from its trigger's origin; exits are quieter than enters. No hover animations.
  Reduced motion handled. No open findings.
- Tap targets below `md` are at least 40 px: logo (40 px high), version badge and ES/EN segments
  (extended with an `::after` hit area), hamburger, close and theme buttons (40 px), sheet links
  (48 px).

---

# Home "Your app stage" (SNL-4.4, `md+`)

`app/[lang]/(site)/page.tsx`, `components/demo/demo-experience.tsx` (`variant="stage"`),
`components/site/stage-steps.tsx`, `components/demo/host-app-frame.tsx` and
`components/site/unofficial-api-note.tsx`, following `home-option-b.html`. Built static first
(hover and `:active` colour states on the copy buttons, Quickstart, footer links and popover
trigger; light and dark; 390 px up), then swept with `find-animation-opportunities`. The inbox
inside the frame keeps its own motion (`registry/items/inbox/MOTION.md`).

## Recon

- Personality: a marketing page seen once or twice per visitor whose job is to get the visitor to
  type into the demo within ten seconds. The hero and commands are read and copied; the stage is
  the one place where motion can explain what to do.
- Tokens: the shared curve `cubic-bezier(0.23, 1, 0.32, 1)`; new `--animate-composer-pulse` in
  `app/globals.css` next to SNL-4.2's `--animate-*` entries. New colour tokens `--wa` /
  `--wa-strong` (WhatsApp green; light and dark) for the headline accent, the active step and the
  host sidebar's `sendo` badge.
- Frequency: the composer invite (once per visit, until the first message), step changes (two per
  first exchange, then rare), the popover (rare), copy buttons (once or twice).

## Kept motions

| #   | Location                                        | Today (static)                         | Purpose                 | Frequency                   | Motion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------- | -------------------------------------- | ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `demo-chat.tsx` composer invite (`invite` prop) | Nothing says "you can type here"       | Explanation (marketing) | Once per visit              | A 2 px green ring around the input (an absolutely positioned `<span>`, not `box-shadow`) loops `opacity 0 → 1 → 0` with `transform: scale(1) → scale(1.015, 1.06) → scale(1)`, `2.2s cubic-bezier(0.37, 0, 0.63, 1) infinite` (ease-in-out: it moves on screen, no enter). Only while the transcript is empty and nothing is pending; hidden while the input has focus (`peer-focus:hidden`); gone after the first message. Placeholder "Ask about the pool…" / "Pregunta por la piscina…". |
| 2   | `stage-steps.tsx` active step highlight         | The green fill jumps from step to step | State indication        | Rare (2 per first exchange) | The fill is its own layer: `transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)` (the old step fades out while the new one fades in). The number badge and text colour switch instantly.                                                                                                                                                                                                                                                                                               |
| 3   | `unofficial-api-note.tsx` popover               | —                                      | Spatial consistency     | Rare                        | Reuses SNL-4.2's `menu-in` (`opacity 0 → 1`, `scale(0.96) → none`, 150 ms) from `--radix-popover-content-transform-origin` (grows from the link), exit `menu-out` (opacity, 120 ms).                                                                                                                                                                                                                                                                                                        |
| —   | Copy buttons, chat bubbles, send / chip press   | —                                      | —                       | —                           | Unchanged: docs `CopyButton` (#1–2 of the docs section) and the demo chat's `ENTER` / `PRESS`.                                                                                                                                                                                                                                                                                                                                                                                              |

**Reduced motion:** #1 doesn't animate (`motion-safe:animate-composer-pulse`); the ring stays as
a static 60 % outline (`motion-reduce:opacity-60`) until the first message, so the hint survives
without movement. #2 is opacity only and stays. #3 uses the opacity-only `fade-in`.

## Rejected candidates

- Hero and stage entrance (mockup `rise` / `stagein`: fade + `translateY(10–18px)`, staggered
  30–320 ms). **Rejected (function):** the demo is the hero and must be usable on first paint; a
  560 ms stagger delays the very moment the page exists for (and LCP). Same verdict as SND-4.9.
- Box-shadow "glow" on the composer (mockup `@keyframes glow`). **Rejected (rules):** animates
  `box-shadow`; replaced by #1's opacity/transform ring.
- Mockup typing dots. **Rejected (purpose):** already rejected for the demo chat; the header says
  "typing…".
- Press scale on the host sidebar items and the install pills. **Rejected (function):** they are
  not controls (the sidebar is a picture of the host app; the pill's only control is its copy
  button), so they get no hover or press state at all.
- Pill hover lift / shadow (mockup `.cmd:hover`). **Rejected (purpose):** decorative on a
  non-interactive container.
- Highlighting or animating the visitor's row when it lands in the inbox. **Rejected:** the inbox
  item plays its own row-enter motion; the frame only opens the conversation (a click on its row).
- Language cross-fade (mockup `fade-swap`). **Rejected (function):** the switch is a full page load.

## review-animations notes

- Only `opacity` and `transform` animate; no `transition: all` in the new components (the shadcn
  `Button` primitive keeps its upstream `transition-all` for colours, as before). Durations: 150/120
  ms popover, 200 ms step fade; #1 is a looping marketing hint outside the UI budget on purpose, at
  low amplitude (1.5 % / 6 %), and it ends for good after the first message. No `ease-in`, nothing
  from `scale(0)`, no hover animations. Reduced motion handled. No open findings.

## One screen (AC-ST-6)

From `md` the `<main>` is `calc(100dvh - 3.5rem - 1px)` tall (the header is a 56 px bar plus a
1 px border, 57 px in total) with `min-height: 640px`; the hero, install row and footer line take
their natural height and the stage gets the rest (`flex: 1; min-height: 0`), the inbox scrolling
inside its iframe. Measured with Playwright: 1280×800 → `scrollHeight` 800 = `innerHeight`, iframe
bottom 751; 1440×900 → 900 = 900, iframe bottom 851. The iframe is 782 px wide at 1280 (phone
column 300 px, host sidebar 148 px), above the inbox's 768 px two-pane breakpoint.

---

# Home mobile "Two-view toggle" (SNL-4.5, below `md`)

`components/demo/mobile-demo.tsx`, the below-`md` classes of `StageLayout` in
`components/demo/demo-experience.tsx`, `components/site/mobile-install-tabs.tsx` and the mobile
sections of `app/[lang]/(site)/page.tsx`, following `home-mobile-option-a.html`. Built static first
(hover and `:active` colour states on the segments, chips, install tabs, copy, Quickstart / Docs
and the compare card; light and dark; 320 and 390 px), then swept with
`find-animation-opportunities`. The inbox in the frame keeps its own motion
(`registry/items/inbox/MOTION.md`), including its row-enter motion for the visitor's row.

## Recon

- Personality: the same marketing page as SNL-4.4 on a phone. The demo can only show one pane at
  a time, so the motion that matters is the one that explains where the other pane is.
- Tokens: the shared curve `cubic-bezier(0.23, 1, 0.32, 1)`, `--wa` for the highlight; no new
  keyframes (the badge and the highlight use `@starting-style` transitions).
- Frequency: pane switches (a few per visit), the badge (once per server answer while the phone
  shows), chips (once: they leave after the first message), install tabs and copy (once or twice).

## Kept motions

| #   | Location                                   | Today (static)                                    | Purpose             | Frequency                      | Motion                                                                                                                                                                                                                                       |
| --- | ------------------------------------------ | ------------------------------------------------- | ------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `StageLayout` track (the two panes)        | The other pane replaces the first with no cue     | Spatial consistency | Occasional (a few per visit)   | The 200 %-wide track moves `transform: translateX(0) ↔ translateX(-50%)`, `transition: transform 320ms cubic-bezier(0.23, 1, 0.32, 1)` (a transition, interruptible mid-slide). Only below `md` (`max-md:` classes); `md+` has no transform. |
| 2   | `MobileDemoBar` segmented-control thumb    | The white thumb jumps between segments            | State indication    | Occasional                     | `transform: translateX(0) ↔ translateX(100%)`, `260ms` same curve (slightly ahead of the panes, as in the mockup).                                                                                                                           |
| 3   | `MobileInboxHighlight` (inbox pane)        | The visitor's row is just "there" after the slide | Explanation         | Rare (inbox shown with unread) | A `--wa` wash over the pane starts at `opacity: 1` (`@starting-style`) and fades to 0 over `900ms` after a `220ms` delay (once the slide is mostly done). Keyed per switch, so it replays only when there was something new.                 |
| 4   | Team inbox badge (`mobile-demo-badge`)     | The badge pops into the segment                   | State indication    | Once per answer                | `@starting-style`: `opacity 0 → 1` + `transform: scale(0.8) → none`, `200ms` same curve. Removed instantly when the inbox is shown (exit motion would only delay the "read" state).                                                          |
| 5   | Segments and chips press                   | Colour-only press                                 | Feedback            | Occasional                     | `:active { transform: scale(0.97) }`, `transition: transform 120ms` same curve (the chat's `PRESS`).                                                                                                                                         |
| —   | Copy button, chat bubbles, composer invite | —                                                 | —                   | —                              | Unchanged: docs `CopyButton`, the chat's `ENTER`, SNL-4.4's composer pulse.                                                                                                                                                                  |

**Reduced motion:** #1 and #2 snap (`motion-reduce:transition-none`); #3 is opacity only and stays;
#4 keeps the fade without the scale; #5 drops the scale (colour press states stay).

## Rejected candidates

- Pulsing "live" dot before "Try it: write as a resident" (mockup `@keyframes ping`).
  **Rejected (rules + purpose):** animates `box-shadow`, loops forever, and the composer already
  has SNL-4.4's invite pulse; two competing loops on one small screen. The dot stays static.
- Entrance stagger (mockup `rise` / `d1…d5`). **Rejected (function):** same verdict as SNL-4.4;
  the demo must be usable on first paint.
- Swipe gesture between panes. **Rejected (function):** the inbox iframe and the chat log both
  scroll and take touches; a horizontal drag would fight them. The segmented control is the one way
  to switch.
- Language cross-fade (mockup `fade-swap`). **Rejected (function):** the switch is a full page load.
- Animated underline sliding between install tabs. **Rejected (frequency + purpose):** two tabs,
  used once; the colour and border switch is clear enough.
- Mockup typing dots and the row `flash` keyframe. **Rejected:** typing is already "typing…" in the
  chat header (SND-4.9); the row is the inbox item's, which animates its own new rows (#3 replaces
  the flash from outside the iframe, with opacity only).
- Height change of the chat when the chips leave. **Rejected (rules):** would animate layout; the
  chips just unmount and the log grows.

## review-animations notes

- Only `transform` and `opacity` animate; exact properties (`transition-[transform]`,
  `transition-opacity`, `transition-[opacity,transform]`), strong ease-out, no `ease-in`, nothing
  from `scale(0)`. Durations: press 120 ms, badge 200 ms, thumb 260 ms, slide 320 ms (on-screen
  movement of a whole pane, inside the 200–500 ms sheet budget), highlight 900 ms fade (a one-off
  hint, opacity only). All transitions, so a pane switch mid-slide reverses from where it is. No
  hover animations. Reduced motion handled. No open findings.
- Tap targets below `md`: segments 40 px high; chips 32 px with a 40 px `::after` hit area; send,
  reset and copy buttons 40 px; install tabs 40 px; Quickstart / Docs 40 px; compare card ≥ 40 px.
  Composer input 16 px (`text-base`, `md:text-sm`), so iOS doesn't zoom on focus.

## One iframe at every width

The stage is one tree: `StageLayout` renders the steps, the mobile bar, then a frame whose track
holds the phone pane and the inbox pane. `md+` the track is SNL-4.4's grid (no transform, mobile
bar `display: none`); below `md` it is a 200 % flex row inside a 470 px `overflow: hidden` frame.
Resizing across the breakpoint only changes classes, so the iframe is never duplicated or
reloaded. Below `md` the hidden pane gets `inert` (from a `matchMedia` store; the server renders
none). In a frame narrower than the inbox's own `md` (768 px), `inbox-frame.tsx` no longer clicks
the visitor's row open: in one-pane mode that would replace the list with the thread, so the row
stays on top of the list instead.
