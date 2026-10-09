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

| # | Location | Today (static) | Purpose | Frequency | Motion |
| --- | --- | --- | --- | --- | --- |
| 1 | `components/docs/copy-button.tsx` (icons) | Copy icon swapped to a check with no bridge | State indication | Occasional | Cross-fade between the copy and check icons: `opacity 0→1` + `transform: scale(0.9)→none`, `150ms cubic-bezier(0.23, 1, 0.32, 1)`; both directions via CSS transitions (interruptible on rapid clicks). Resets after 1.6 s. |
| 2 | `components/docs/copy-button.tsx` (button) | Colour-only press state | Feedback | Occasional | `:active { transform: scale(0.97) }`, `transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1)`; starts on pointer-down. Colour press state (`active:bg-accent/70`) kept as well. |

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
