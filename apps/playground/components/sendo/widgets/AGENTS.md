# widgets — notes for agents

Click-to-chat links, QR codes, a chat bubble and source counts, on top of `@quami/sendo`.
Installed by `npx shadcn add @sendo/widgets`. Needs `lib/sendo.ts` (`@sendo/webhook`) and the
Sendo schema (`@sendo/schema`, v2 or later).

## Files

| File                                                              | What it is                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `app/(protected)/inbox/links/page.tsx`                            | The "Enlaces" screen (server component). Admin only (`numbers.manage`).                                 |
| `app/(protected)/inbox/links/actions.ts`                          | Server actions `createLink`, `listSources`. Each calls `requireUser()` first, then `sendo.actor()`.     |
| `app/(protected)/inbox/links/links-config.ts`                     | `requireUser()`: **app-owned, implement it**. Fails closed (throws) until you do.                       |
| `components/sendo/widgets/link-builder.tsx`                       | Number, prefilled text, source → link, copy button, QR, bubble snippet.                                 |
| `components/sendo/widgets/qr-code.tsx`                            | `<SendoQrCode value label />`, `encodeQr`, `qrSvgMarkup`, `qrPngBlob`. PNG/SVG download in the browser. |
| `components/sendo/widgets/chat-bubble.tsx`                        | `<SendoChatBubble />` for your public site. No client JS, no server import.                             |
| `components/sendo/widgets/sources-table.tsx`                      | Conversations per source (`sendo.links.sources`).                                                       |
| `components/sendo/widgets/links-screen.tsx`                       | Lays out the builder and the table.                                                                     |
| `components/sendo/widgets/{strings,types,press,whatsapp-link}.ts` | Spanish strings (`WidgetsStrings`), view types, motion recipes, browser `wa.me` builder.                |

## Don't touch (and why)

- **The package builds every link.** The screen calls `sendo.links.create({ account, tenant, text, source })`
  through `createLink`. `whatsapp-link.ts` is a browser copy of the same format, used only by the chat bubble
  when it gets a `phone`. Change the format in the package, then mirror it there.
- **Sources** are `^[a-z0-9-]{1,32}$` and are appended as ` [#source]`. The pipeline reads the code from
  the first message of a new or reopened conversation, stores it in `sendo_conversations.source` and hides
  it from the AI agent. A Meta ad referral stores `ad:<id>`; no code means `null` ("Directo").
- **Permissions live in the package.** `sendo.links.sources({ actor })` throws `FORBIDDEN` unless the actor
  has `numbers.manage`; the page and `createLink` check the same capability. Don't remove the checks from
  `actions.ts`; add your own on top if you need them.
- **QR:** `qrcode-generator` (item dependency, not a package dependency). Error correction H, or Q when H
  would need more than 81 × 81 modules (`level="auto"`, the default; never lower than Q). 4-module quiet zone,
  always black on white. Downloads are generated client-side; no external QR service ever sees the link.
  The builder caps the message at 200 characters so printed codes stay scannable.
- Strings: every text is in `WidgetsStrings` (`strings.ts`); pass `strings={{ ... }}` to override.
- Motion: see `MOTION.md` (only transform/opacity; reduced motion keeps the fades).

## Using the chat bubble

```tsx
// app/layout.tsx of your public site
import { SendoChatBubble } from "@/components/sendo/widgets/chat-bubble";

<SendoChatBubble phone="+502 5555 1234" text="Hola, quiero información" source="web" />;
```

When you know the account or tenant but not the phone, build the link on the server and pass `href`:

```tsx
const link = await sendo.links.create({ tenant, text: "Hola", source: "web" });
<SendoChatBubble href={link.url} position="bottom-left" />;
```

## Connects to

No env vars. `qrcode-generator` is installed with the item.

### Implementing `requireUser()`

Return `{ userId, tenantId }` for the signed-in user (or redirect to your login). `sendo.actor(userId,
tenantId)` then resolves the role through `resolveRole` in `createSendo` (`lib/sendo.ts`); without
`resolveRole` every user gets "No tienes acceso a Enlaces". If you also installed `inbox`, return the
same user as `app/(protected)/inbox/inbox-config.ts`.

## Verify

1. Before implementing `requireUser()`, `/inbox/links` throws (fails closed). As an admin (`resolveRole` →
   `admin`) the screen opens; other roles see "No tienes acceso a Enlaces".
2. Create a link with source `web`, scan its QR with a phone and send the message: the new conversation shows
   origin `web` in the inbox, and the sources table counts it.
3. Download the PNG and SVG; both scan. `tsc --noEmit` passes in the app.
