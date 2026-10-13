# widgets — notes for agents

Click-to-chat links, QR codes, a chat bubble and source counts, on top of `@quami/sendo`.
Installed by `npx shadcn add @sendo/widgets`. Needs `lib/sendo.ts` (`@sendo/webhook`) and the
Sendo schema (`@sendo/schema`, v2 or later). English and Spanish: the page passes the required `locale`
prop from `sendoLocale` in `lib/sendo-ui.ts` (default `en`).

## Files

| File                                                      | What it is                                                                                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(protected)/inbox/links/page.tsx`                    | The links screen (server component). Admin only (`numbers.manage`); others see "You don't have access to Links" (`LinksNotice`). Passes `locale={sendoLocale}`; `generateMetadata` reads `pageTitle`. |
| `app/(protected)/inbox/links/actions.ts`                  | Server actions `createLink`, `listSources`. Each calls `requireUser()` first, then `sendo.actor()`.                                                                                                   |
| `app/(protected)/inbox/links/links-config.ts`             | `requireUser()`: **app-owned, implement it**. Fails closed (throws) until you do.                                                                                                                     |
| `components/sendo/widgets/links-screen.tsx`               | `LinksScreen` lays out the builder and the table; `LinksNotice` (`kind`, `locale`) for the full-page messages. Props `locale`, `formatLocale`, `strings`.                                             |
| `components/sendo/widgets/link-builder.tsx`               | `LinkBuilder`: number, prefilled text, source → link, copy button, QR, bubble snippet. Props `locale`, `formatLocale`, `strings`.                                                                     |
| `components/sendo/widgets/qr-code.tsx`                    | `<SendoQrCode locale value label />`, `encodeQr`, `qrSvgMarkup`, `qrPngBlob`. PNG/SVG download in the browser.                                                                                        |
| `components/sendo/widgets/chat-bubble.tsx`                | `<SendoChatBubble locale />` for your public site. No client JS, no server import.                                                                                                                    |
| `components/sendo/widgets/sources-table.tsx`              | `SourcesTable`: conversations per source (`sendo.links.sources`), counts and shares in `formatLocale`. Props `locale`, `formatLocale`, `strings`.                                                     |
| `components/sendo/widgets/strings.ts`                     | `WidgetsStrings`, `widgetsStrings = { es, en }`, `resolveWidgetsStrings(locale, overrides)`, `widgetsFormat(formatLocale)`. Server-safe (no React).                                                   |
| `components/sendo/widgets/strings-context.tsx`            | Context `{ strings, locale, formatLocale }`; `WidgetsStringsProvider`, `useWidgetsStrings()`, `useWidgetsFormat()`.                                                                                   |
| `components/sendo/widgets/{types,press,whatsapp-link}.ts` | View types, motion recipes, browser `wa.me` builder.                                                                                                                                                  |
| `lib/sendo-ui.ts`                                         | `SendoLocale` and `sendoLocale`, the language of every Sendo screen. Every UI item ships the same file. **Yours**: set it.                                                                            |

## Don't touch (and why)

- **The package builds every link.** The screen calls `sendo.links.create({ account, tenant, text, source })`
  through `createLink`. `whatsapp-link.ts` is a browser copy of the same format, used only by the chat bubble
  when it gets a `phone`. Change the format in the package, then mirror it there.
- **Sources** are `^[a-z0-9-]{1,32}$` and are appended as ` [#source]`. The pipeline reads the code from
  the first message of a new or reopened conversation, stores it in `sendo_conversations.source` and hides
  it from the AI agent. A Meta ad referral stores `ad:<id>`; no code means `null` (`directSource`, "Direct").
- **Permissions live in the package.** `sendo.links.sources({ actor })` throws `FORBIDDEN` unless the actor
  has `numbers.manage`; the page and `createLink` check the same capability. Don't remove the checks from
  `actions.ts`; add your own on top if you need them. The actions' `message` is an English detail for logs;
  the screen shows `errorMessages[code]`.
- **QR:** `qrcode-generator` (item dependency, not a package dependency). Error correction H, or Q when H
  would need more than 81 × 81 modules (`level="auto"`, the default; never lower than Q). 4-module quiet zone,
  always black on white. Downloads are generated client-side; no external QR service ever sees the link.
  The builder caps the message at 200 characters so printed codes stay scannable.
- Strings: every text is in `WidgetsStrings` (`strings.ts`, one object per `SendoLocale`); pass
  `strings={{ ... }}` to `<LinksScreen />` (or `<LinkBuilder>`, `<SourcesTable>`, `<SendoQrCode>`) to override
  single keys on top of `locale`. Counts and shares use `widgetsFormat(formatLocale)` (`Intl.NumberFormat`).
- Language: `sendoLocale` in `lib/sendo-ui.ts` (`en` or `es`) is the required `locale` of every root
  (`LinksScreen`, `LinksNotice`, `LinkBuilder`, `SourcesTable`, `SendoQrCode`, `SendoChatBubble`); pass
  `formatLocale` (e.g. `es-GT`) for regional numbers. `<SendoChatBubble>` and `<SendoQrCode>` are
  public-facing, so give them your public site's language, which may differ from the admin screens'. To add a
  language, extend `SendoLocale` and follow the type errors (`widgetsStrings`). Docs: `/docs/languages`.
- Motion: see `MOTION.md` (only transform/opacity; reduced motion keeps the fades).

## Using the chat bubble

```tsx
// app/layout.tsx of your public site
import { SendoChatBubble } from "@/components/sendo/widgets/chat-bubble";

<SendoChatBubble
  locale="en"
  phone="+502 5555 1234"
  text="Hi, I'd like some information"
  source="web"
/>;
```

`locale` sets the accessible name and tooltip ("Message us on WhatsApp" / "Escríbenos por WhatsApp");
`label` replaces it. When you know the account or tenant but not the phone, build the link on the server and
pass `href`:

```tsx
const link = await sendo.links.create({ tenant, text: "Hi", source: "web" });
<SendoChatBubble locale="en" href={link.url} position="bottom-left" />;
```

## Connects to

No env vars. `qrcode-generator` is installed with the item.

### Implementing `requireUser()`

Return `{ userId, tenantId }` for the signed-in user (or redirect to your login). `sendo.actor(userId,
tenantId)` then resolves the role through `resolveRole` in `createSendo` (`lib/sendo.ts`); without
`resolveRole` every user gets "You don't have access to Links". If you also installed `inbox`, return the
same user as `app/(protected)/inbox/inbox-config.ts`.

## Verify

1. Before implementing `requireUser()`, `/inbox/links` throws (fails closed). As an admin (`resolveRole` →
   `admin`) the screen opens; other roles see "You don't have access to Links".
2. Create a link with source `web`, scan its QR with a phone and send the message: the new conversation shows
   origin `web` in the inbox, and the sources table counts it.
3. Download the PNG and SVG; both scan. `tsc --noEmit` passes in the app.
4. Set `sendoLocale` to Spanish (`es`): the screen, the notices and the page title switch to Spanish.
