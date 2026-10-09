# sendo-inbox — notes for agents

The team inbox at `/inbox`: conversation list with number selector, search, status tabs and tag filters; the
thread with handoff, pause and disconnected banners, notes, system lines and draft approval; the composer with
snippets and templates; a context panel (assignment, tags, origin, window, agent cost); and live updates through
Supabase Realtime, or polling without it (list every 10 s, open thread every 3 s, paused while the tab is hidden).
Installed by `npx shadcn@latest add @sendo/sendo-inbox`. Needs `lib/sendo.ts`
(`@sendo/sendo-webhook`) and the Sendo schema (`@sendo/sendo-schema`, v2 or later). Spanish by default.

## Files

| File                                                                                                  | What it is                                                                                                                                                        | Edit it?                                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `app/(protected)/inbox/inbox-config.ts`                                                               | `requireUser()` (**implement it**; fails closed until you do), `inboxRealtimeEnabled()`, `inboxNav`, `resolveUserNames()`, `contactAppHref()`, `inboxAgentNames`. | **Yes, it's yours.**                                                        |
| `app/(protected)/inbox/page.tsx`                                                                      | Server component: `requireUser()` → `sendo.actor()` → first page, numbers, permissions; renders `<SendoInbox>` or "No tienes acceso a la bandeja".                | Layout and props. Keep the guard.                                           |
| `app/(protected)/inbox/actions.ts`                                                                    | Server actions (list, thread, reply, note, take, assign, close, pause, drafts, tags, snippets, templates). Each calls `requireUser()` then `sendo.actor()`.       | Add actions following the same guard; error mapping lives in `errorCode()`. |
| `components/sendo/sendo-inbox.tsx`, `inbox.tsx`                                                       | Client shell: state, realtime wiring, optimistic updates, which panel shows at each width.                                                                        | Yes, carefully (see Don't touch).                                           |
| `components/sendo/{conversation-list,thread,message-bubble,note-bubble,system-line,draft-card,…}.tsx` | List and thread pieces.                                                                                                                                           | Yes: markup, classes, copy.                                                 |
| `components/sendo/{composer,snippet-picker,template-picker,tag-picker,assign-menu,…-manager}.tsx`     | Composer (reply / note), pickers, snippet and tag managers.                                                                                                       | Yes.                                                                        |
| `components/sendo/context-panel.tsx`, `inbox-rail.tsx`, `thread-banners.tsx`                          | Context panel (assignment, tags, origin, window, cost), icon rail, banners.                                                                                       | Yes.                                                                        |
| `components/sendo/strings.ts`                                                                         | `InboxStrings` with Spanish defaults. Override with `<SendoInbox strings={{ ... }} />` instead of editing.                                                        | Prefer overriding.                                                          |
| `components/sendo/types.ts`, `utils.ts`                                                               | View types shared by the actions and the UI (`InboxActions`, `*View`, `InboxErrorCode`), serializers.                                                             | Only together with `actions.ts`.                                            |
| `components/sendo/motion.css`, `transitions.tsx`, `motion-sheet.tsx`                                  | `--sendo-*` motion tokens, enter/swap transitions, the mobile sheet (springs via `motion`).                                                                       | Tokens: yes. See `MOTION.md` before adding motion.                          |
| `hooks/use-sendo-realtime.ts`, `lib/sendo-realtime.ts`                                                | Realtime subscription on `sendo_conversations` / `sendo_messages`, polling fallback (no client, or the channel errors); the browser Supabase client.              | `lib/sendo-realtime.ts`: yes (return your `@supabase/ssr` client).          |

## Don't touch

- **The guard in every action and the page:** `requireUser()` first, then `sendo.actor(user.userId,
user.tenantId)`, then the `sendo.inbox.*` call with `{ actor }`. A registry test checks it. Roles, visibility,
  tenant scoping and permissions (`FORBIDDEN`) are enforced **in the package** (`sendo.inbox`, `sendo.snippets`,
  `sendo.tags`); don't re-implement them in the UI or bypass them with `sendo.conversations.*` or the adapter.
- **Sending rules stay in npm:** the 24-hour window (`WINDOW_CLOSED`), templates outside it, step-in on reply,
  draft approval, disconnected numbers (`ACCOUNT_STATE`) and status ordering. The UI only shows them.
- **Never use the service-role client in the browser.** `lib/sendo-realtime.ts` uses the anon key and the
  operator's session; RLS (`sendo_can_access_tenant`) decides what arrives.
- **Motion:** only `transform` and `opacity`, `--sendo-*` tokens, reduced motion keeps fades (see `MOTION.md`).
- **Client components import only client-safe subpaths:** values from `@quami/sendo/snippets` (snippet search,
  variables, limits); `import type` from `@quami/sendo` is fine. A value import from the main entry pulls the
  server runtime (`ai`, `node:crypto`) into the browser bundle.

## Connects to

- **`requireUser()`** in `inbox-config.ts`: return `{ userId, tenantId }` of the signed-in operator (or redirect).
  The other screens (`numbers-config.ts`, `rules-config.ts`, `links-config.ts`, `metrics-config.ts`) can
  re-export it.
- **`lib/sendo.ts` hooks:** `resolveRole` (required: users without a role see "No tienes acceso a la bandeja"),
  `resolveUsers` (names, avatars, assignable people), `resolveAssignees` / `resolveHandoffTargets`,
  `resolveSnippetVariables` (snippet `{{variables}}`).
- **Voice notes and cost (optional):** `createSendo({ transcribe: { model } })` in `lib/sendo.ts` makes voice notes
  show their transcript (or "Sin transcripción"); admins (`costs.view`) see each agent turn's cost on hover and
  the conversation total in "Costo del agente" (`sendo.inbox.cost`, called by the `thread` action).
- **Database:** schema v2+, and replace `sendo_can_access_tenant(tenant_id)` (it returns `false` by default) so
  realtime delivers rows. Optional: `sendo_can_access_internal`, `sendo_can_access_conversation`.
- **Env:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` for live updates (without them, or with
  `inboxRealtimeEnabled()` returning `false`, e.g. Drizzle or Prisma apps, the inbox polls).
- **App shell:** mount `<Toaster />` (`components/ui/sonner`) in the root layout; set `inboxNav` to the screens you
  installed (`/inbox/numbers`, `/inbox/rules`, `/inbox/broadcasts`, `/inbox/metrics`, `/inbox/links`).

## Verify

1. Before implementing `requireUser()`, `/inbox` throws (fails closed). After it, a user without a role sees
   "No tienes acceso a la bandeja"; with `resolveRole` returning `agent` they see their conversations.
2. Send a WhatsApp message to a connected number: the conversation appears (live with realtime, otherwise within
   10 s by polling); reply from the thread and check the ticks update.
3. `npx @quami/sendo doctor` is clean, and `tsc --noEmit` passes in the app.
