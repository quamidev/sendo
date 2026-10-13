# Sendo widgets — MOTION.md

Steps 2–5 of the per-screen process (`CLAUDE.md`) for the `widgets` registry item: the links screen
(`link-builder.tsx`, `qr-code.tsx`, `sources-table.tsx`, `links-screen.tsx`) and the public
`<SendoChatBubble />` (`chat-bubble.tsx`). The skills in `.claude/skills/` were followed in order:
static screen with hover and press states → `find-animation-opportunities` → only the kept motions →
`review-animations` → `break-ui`.

## Tokens and reduced motion

The item uses the same `--sendo-*` tokens as `inbox` (`components/sendo/motion.css`), always with
the inbox value as fallback, so it works when installed alone and follows an app's overrides when the
tokens exist:

| Token               | Fallback                        | Used for                              |
| ------------------- | ------------------------------- | ------------------------------------- |
| `--sendo-ease-out`  | `cubic-bezier(0.16, 1, 0.3, 1)` | every motion here                     |
| `--sendo-dur-press` | 120 ms                          | press feedback (buttons, chat bubble) |
| `--sendo-dur-fast`  | 160 ms                          | in-place swaps (copied, regenerating) |
| `--sendo-dur-menu`  | 200 ms                          | preview appearing                     |

Recipes live in `components/sendo/widgets/press.ts` (`pressClass`, `fadeSwapClass`); the chat bubble
inlines its own because it ships to public sites.

`prefers-reduced-motion: reduce`: the press scale is removed with `motion-reduce:active:[transform:none]`;
every opacity change (copied swap, regenerating dim, preview fade-in) stays, as the product spec asks.
No `sendo-motion-transform` class is needed, so the item doesn't depend on the inbox's `motion.css`.

Hover: Tailwind 4 `hover:` is already wrapped in `@media (hover: hover)`, so touch screens never get stuck
hover colours. Hover changes colour only; nothing moves on hover.

## Step 2 — `find-animation-opportunities`

Recon: Next.js 16 + Tailwind 4 + shadcn new-york. Personality: an admin tool used a few times a month
(create a link, print a QR, check the sources) plus one public, always-visible button on the
customer's site. Crisp, very little motion. Frequency map: the links screen is occasional; typing in the
builder is tens of keystrokes per visit; the chat bubble is seen on every page view by visitors.

### Kept

| #   | Location                                                      | Today (static)                               | Purpose          | Frequency                  | Motion                                                                                                                                     |
| --- | ------------------------------------------------------------- | -------------------------------------------- | ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Buttons: Copiar, Copiar código, PNG, SVG, Usar (`pressClass`) | Colour change on press only                  | Feedback         | Occasional                 | `:active { transform: scale(0.97) }`, `transition: transform, colors var(--sendo-dur-press) var(--sendo-ease-out)`; starts on pointer-down |
| 2   | Copy button label (`CopyButton`, `fadeSwapClass`)             | "Copiar" replaced by "Copiado" instantly     | State indication | Occasional                 | Both labels stacked in one grid cell; opacity cross-fade over `--sendo-dur-fast`. Nothing moves, button width never changes                |
| 3   | Preview while a new link is requested (`aria-busy`)           | Old QR stays at full strength until it swaps | State indication | Tens per visit (debounced) | Preview opacity 1 → 0.6 over `--sendo-dur-fast` while pending, back to 1 when the link arrives. Opacity only, interruptible                |
| 4   | Chat bubble press (`chat-bubble.tsx`)                         | Colour darkens on press                      | Feedback         | Occasional (per visitor)   | `:active { transform: scale(0.94) }` over `--sendo-dur-press`, `--sendo-ease-out`; colour darkens on hover and press                       |

### Rejected

- **QR redraw (morph or cross-fade between codes) on every regenerated link.** Frequency + Function: it
  fires on each debounced edit, and the code is the thing the admin is about to download. Motion #3 already
  says "updating"; the new code swaps in place.
- **Chat bubble entrance (fade/rise on page load) or an attention pulse.** Frequency + Purpose: every page
  view of the customer's site; a looping pulse is decoration that competes with the site's own content.
  The bubble is simply there.
- **Sources table rows animating in (stagger) on number filter change.** Function: numbers the admin reads
  and compares; rows update in place, the table only dims while loading (same recipe as #3).
- **Preview card appearing (empty state → first link).** Considered as "preventing a jarring change", but it
  happens once per visit and the swap is in place inside a fixed card, so nothing jumps. Not needed.
- **Hover lift on the chat bubble (`translateY(-2px)`).** Purpose: hover already changes colour and shadow;
  movement on hover adds nothing and would need extra reduced-motion handling on a public site.

Verdict: the item needs very little motion. The highest-leverage one is #2 (the copy confirmation),
because copying the link is the main action of the screen and needs a visible acknowledgement.

## Step 4 — `review-animations`

| Before                                                           | After                                                                                                          | Why                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| shadcn `Button` base class `transition-all`                      | `pressClass` sets `transition-[transform,color,background-color,border-color]` (tailwind-merge keeps the last) | No unbounded `transition-all`; only the press scale and colours transition |
| Chat bubble `transition-[transform,background-color,box-shadow]` | `transition-[transform,background-color]`                                                                      | Shadow is not animated (paint-heavy); it changes instantly on hover        |
| Press scale under reduced motion                                 | `motion-reduce:active:[transform:none]`                                                                        | Reduced motion keeps colour/opacity and removes movement                   |

Remaining notes:

- **Press timing is symmetric** (120 ms in and out). The scale is 3 % (6 % on the bubble) and the whole
  round trip stays under 250 ms, so asymmetry would not be perceptible; kept consistent with `inbox`.
- **Interruptibility:** every motion is a CSS transition (no keyframes), so a quick double copy or a
  pending → done → pending sequence retargets from the current opacity.
- **Easing:** only `--sendo-ease-out`; no `ease-in` anywhere.

Decision: **Approve.**

## Step 5 — `break-ui`

Fixtures: `apps/playground/fixtures/widgets/`, rendered by the dev-only route `/dev/links?data=demo|worst|empty|one`
(the real `LinksScreen` with fixture data and stand-in actions; a toggle at the bottom of the page; the route
returns 404 in production). Worst case: six numbers with long labels and one without label, a prefilled text at
the length limit with accents, emoji and a long email, a 32-character source (`navidad-2026-garita-norte-torreb`),
25 sources with counts from 1 to 12,345 (one `ad:<id>`), and the `Directo` row. Checked in Chromium at 1280 px
and 320 px.

| #   | Severity | Field                | Worst-case value                             | What happened → fix                                                                                                                                                                 |
| --- | -------- | -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Broken   | QR                   | 300-character message with accents and emoji | Version 25 code (117 modules) at level H: unreadable when printed small → text capped at 200 characters, `level="auto"` drops to Q above 81 modules, and "Código denso…" hint shows |
| 2   | Broken   | Source (fixture)     | 33-character source                          | The initial draft had no link and a red field → the builder only accepts what `^[a-z0-9-]{1,32}$` allows (`maxLength` 32 + slug), the fixture now uses the 32-character limit       |
| 3   | Ugly     | Source field         | Empty on first load                          | Shown as an error before the admin typed anything → the error appears only after the field was edited                                                                               |
| 4   | Broken   | Sources table, 320px | 25 rows                                      | The "Usar" column was cut off and source chips shrank to one letter → the % column is hidden below `sm`, the source column takes the remaining width and truncates with `title`     |
| 5   | Ugly     | QR downloads, 320px  | Two buttons                                  | Overflowed the card → buttons wrap (`flex-wrap justify-center`)                                                                                                                     |
| 6   | Fragile  | Sources table        | `ad:120210000000000001`                      | "Usar" would have turned it into `ad-120…` → "Usar" only for link codes; ads get a megaphone icon instead of the QR icon                                                            |
| 7   | Ugly     | Builder layout       | Short form next to a tall preview            | The form card stretched to the preview's height → `items-start` on the grid                                                                                                         |

Decisions: source chips truncate at the end (the start carries the meaning, full value in `title`); counts
follow Spanish grouping (`4210`, `12.345`, `Intl.NumberFormat("es")`) with `tabular-nums`; the 25-row table is not
paginated (sources are few by nature; revisit if an app generates codes per invoice).

Held up: the number select truncates long labels; the link URL truncates with the full value in `title` and the
copy button never moves; message preview and bubble snippet wrap long words (`overflow-wrap:anywhere`) and emoji;
"Copiado" swaps in place without changing the button width; a message too long for any QR shows an error instead
of throwing; typing "Garita Norte" gives `garita-norte`; the QR is always black on white with a 4-module quiet zone
in the SVG on screen, the SVG download and the PNG (1060 × 1060 px for a version 7 code); with one number the
sources filter is hidden; with no sources the table says so and keeps the `Directo` row.
