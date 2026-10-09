import type { Metadata } from "next";
import { CodeBlock, Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { readRepoFile } from "@/components/docs/read-sample";
import { A, C, List, P } from "@/components/docs/prose";
import { Table } from "@/components/docs/table";

export const metadata: Metadata = { title: "Inbox" };

const toc = [
  { id: "files", title: "What gets installed" },
  { id: "auth", title: "Server-action auth" },
  { id: "actions", title: "The actions contract" },
  { id: "realtime", title: "Realtime and RLS" },
  { id: "strings", title: "Strings" },
  { id: "motion", title: "Motion tokens" },
] as const;

export default function InboxPage() {
  return (
    <DocPage slug="inbox" toc={toc}>
      <P>
        <C>@sendo/sendo-inbox</C> is the staff inbox: conversations filtered by Humano / Agente /
        Cerradas and &ldquo;Asignadas a mí&rdquo;, the thread with media and status ticks, a
        composer that switches to the template picker when the 24-hour window is closed, and the
        Tomar / Devolver al agente / Cerrar actions. The files are copied into your app, so you own
        and edit them.
      </P>

      <Heading id="files">What gets installed</Heading>
      <Table
        head={["Path", "Purpose"]}
        rows={[
          [
            <C key="p">components/sendo/*.tsx</C>,
            "inbox, conversation-list, thread, message-bubble, composer, template-picker, window-indicator, status-ticks, media-preview, motion-sheet, transitions, sendo-inbox (client boundary)",
          ],
          [
            <C key="p">components/sendo/strings.ts, types.ts, utils.ts</C>,
            "Spanish defaults, view types and the actions contract, formatters",
          ],
          [<C key="p">components/sendo/motion.css</C>, "Motion tokens (below)"],
          [<C key="p">app/(protected)/inbox/page.tsx</C>, "The inbox page"],
          [
            <C key="p">app/(protected)/inbox/actions.ts</C>,
            "Server actions calling sendo.inbox.* and sendo.conversations.* after requireUser()",
          ],
          [
            <C key="p">app/(protected)/inbox/inbox-config.ts</C>,
            "Yours to edit: requireUser() (throws until implemented) and whether realtime is on",
          ],
          [
            <C key="p">hooks/use-sendo-realtime.ts</C>,
            "Supabase Realtime subscription; does nothing with a null client",
          ],
          [
            <C key="p">lib/sendo-realtime.ts</C>,
            "Browser Supabase client factory for live updates",
          ],
        ]}
      />
      <P>
        shadcn dependencies (button, input, textarea, badge, avatar, scroll-area, tabs, dialog,
        select, tooltip, sonner) and the npm packages <C>date-fns</C>, <C>motion</C> and{" "}
        <C>radix-ui</C> are installed with it. Styling uses your theme tokens, light and dark.
      </P>

      <Heading id="auth">Server-action auth</Heading>
      <P>
        <C>sendo.inbox</C> runs with the service role and does no auth. Every server action must
        call your auth check first, and the template&rsquo;s <C>requireUser()</C> throws until you
        implement it (fail closed):
      </P>
      <Sample file="inbox-actions.ts" region="auth" title="app/(protected)/inbox/actions.ts" />
      <P>
        Then pass the user&rsquo;s tenant to every call. <C>tenantId</C> is required for <C>list</C>
        ; for <C>thread</C>, <C>reply</C> and <C>markSeen</C> it turns another tenant&rsquo;s
        conversation into a <C>RecordNotFoundError</C>. <C>sendo.conversations.*</C> take no tenant,
        so check it yourself:
      </P>
      <Sample file="inbox-actions.ts" region="actions" title="app/(protected)/inbox/actions.ts" />
      <List>
        <li>
          <C>reply</C> stores the message as sender <C>human</C> with <C>senderRef</C> = your user
          id. Outside the window, free-form replies throw <C>WindowClosedError</C> before calling
          Meta, and the composer switches to the template picker.
        </li>
        <li>
          Media URLs in <C>thread</C> are signed for 300 seconds; request the thread again rather
          than storing them.
        </li>
      </List>

      <Heading id="actions">The actions contract</Heading>
      <P>
        <C>{"<Inbox actions={...} />"}</C> receives the server actions as one object. The page
        passes the ones in <C>actions.ts</C>; you can pass your own implementation (another backend,
        a test double). Every action resolves to a result instead of throwing, so the inbox can show
        the right message:
      </P>
      <Sample file="inbox-contract.ts" region="actions" title="components/sendo/types.ts" />
      <List>
        <li>
          <C>WINDOW_CLOSED</C> from <C>reply</C> switches the composer to the template picker and
          keeps the draft.
        </li>
        <li>
          Failures show a <C>sonner</C> toast; successful actions don&rsquo;t (the badge change is
          the feedback).
        </li>
      </List>

      <Heading id="realtime">Realtime and RLS</Heading>
      <P>
        The migration adds <C>sendo_conversations</C> and <C>sendo_messages</C> to the{" "}
        <C>supabase_realtime</C> publication. Browser clients use your anon key and the user&rsquo;s
        session, so they only receive rows for which <C>sendo_can_access_tenant(tenant_id)</C> is
        true. With the default (<C>false</C>) the inbox gets no live updates: implement it as in{" "}
        <A href="/docs/quickstart#migration">Quickstart step 4</A>.
      </P>

      <Heading id="strings">Strings</Heading>
      <P>
        The inbox is in Spanish (es-GT) by default. Every user-facing string comes from one defaults
        module and can be overridden through a <C>strings</C> prop, so you can rephrase or translate
        without editing the components. Dates use <C>date-fns</C> with the <C>es</C> locale and the{" "}
        <C>America/Guatemala</C> timezone by default (<C>timeZone</C> prop).
      </P>
      <Table
        head={["Group", "Keys (examples)"]}
        rows={[
          [
            "Conversation list",
            <C key="k">
              filterHuman, filterAgent, filterClosed, filterAll, assignedToMe, listEmpty,
              unreadCount(n)
            </C>,
          ],
          ["Status badge", <C key="k">statusHuman, statusAgent, statusClosed</C>],
          [
            "Thread",
            <C key="k">
              loadOlder, threadEmpty, threadEmptyHint, senderContact, senderAgent, senderHuman
            </C>,
          ],
          [
            "Message content and media",
            <C key="k">
              messageTypeLabel(type), messageReaction(emoji), mediaUnavailable, mediaPreviewTitle,
              sheetClose
            </C>,
          ],
          [
            "Status ticks",
            <C key="k">
              tickPending, tickSent, tickDelivered, tickRead, tickFailed, errorCode(code)
            </C>,
          ],
          [
            "Actions and window",
            <C key="k">
              take, returnToAgent, close, actionFailed, windowOpen(remaining), windowClosed
            </C>,
          ],
          [
            "Composer and templates",
            <C key="k">
              composerPlaceholder, send, sendFailed, templateExplanation, templateOpen,
              templateVariable(i), templateSend
            </C>,
          ],
        ]}
      />
      <P>
        The full list with defaults is <C>InboxStrings</C> / <C>defaultInboxStrings</C> in{" "}
        <C>components/sendo/strings.ts</C>. Some keys are functions (plurals, codes):
      </P>
      <Sample file="inbox-contract.ts" region="strings" title="Overriding strings" />

      <Heading id="motion">Motion tokens</Heading>
      <P>
        Inbox components animate only <C>transform</C> and <C>opacity</C>, with durations and curves
        from these custom properties:
      </P>
      <CodeBlock
        title="components/sendo/motion.css"
        code={readRepoFile("registry/items/sendo-inbox/components/sendo/motion.css")}
      />
      <Table
        head={["Token", "Used for"]}
        rows={[
          [
            <C key="t">--sendo-dur-press</C>,
            "Press feedback on Tomar / Devolver / Cerrar and the send buttons (scale 0.97 on pointer-down)",
          ],
          [<C key="t">--sendo-dur-fast</C>, "Status badge and status tick cross-fades"],
          [
            <C key="t">--sendo-dur-menu</C>,
            "New conversation rows and bubbles entering; composer ↔ template picker",
          ],
          [
            <C key="t">--sendo-dur-sheet</C>,
            "Reserved for dialogs you add. The mobile sheets (template picker, media preview) use a critically damped motion spring with drag-to-dismiss instead",
          ],
          [
            <C key="t">--sendo-ease-out / --sendo-ease-in-out</C>,
            "Entering elements / on-screen movement. Never ease-in.",
          ],
        ]}
      />
      <P>
        Override them after importing <C>motion.css</C>. Under <C>prefers-reduced-motion: reduce</C>{" "}
        the durations stay, so opacity and colour still fade (they help to follow a state change),
        and movement is removed: every element that moves carries <C>.sendo-motion-transform</C>,
        whose transform (the short rise of new rows and bubbles, the press scale) is neutralised.
        The mobile sheets read <C>useReducedMotion()</C> and only fade, without the slide or the
        drag handle. The recipes and the reasons behind each one are in the item&rsquo;s{" "}
        <C>MOTION.md</C>.
      </P>
      <Sample file="motion-overrides.css" title="app/globals.css" />
    </DocPage>
  );
}
