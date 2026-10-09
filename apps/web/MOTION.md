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
registry item, with its own motion (`registry/items/sendo-inbox/MOTION.md`); nothing here changes it.

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
