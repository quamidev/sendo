import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
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
  { id: "realtime", title: "Realtime and RLS" },
  { id: "strings", title: "Strings" },
  { id: "motion", title: "Motion tokens" },
] as const;

export default function InboxPage() {
  return (
    <DocPage slug="inbox" toc={toc}>
      <P>
        <C>@quami/wa-li-inbox</C> is the staff inbox: conversations filtered by Humano / Agente /
        Cerradas and &ldquo;Asignadas a mí&rdquo;, the thread with media and status ticks, a
        composer that switches to the template picker when the 24-hour window is closed, and the
        Tomar / Devolver al agente / Cerrar actions. The files are copied into your app, so you
        own and edit them.
      </P>
      <Callout variant="warning" title="Status">
        <p>
          The registry item currently installs only <C>components/whatsapp/motion.css</C>. The
          components, page, server actions and realtime hook are being built; this page documents
          the parts that already exist (motion tokens, the <C>wa.inbox</C> server API) and the
          contract the components follow.
        </p>
      </Callout>

      <Heading id="files">What gets installed</Heading>
      <Table
        head={["Path", "Purpose"]}
        rows={[
          [<C key="p">components/whatsapp/*.tsx</C>, "inbox, conversation-list, thread, message-bubble, composer, template-picker, window-indicator, status-ticks, media-preview"],
          [<C key="p">components/whatsapp/motion.css</C>, "Motion tokens (below)"],
          [<C key="p">app/(protected)/whatsapp/page.tsx</C>, "The inbox page"],
          [<C key="p">app/(protected)/whatsapp/actions.ts</C>, "Server actions calling wa.inbox.* and wa.conversations.* after requireUser()"],
          [<C key="p">hooks/use-whatsapp-realtime.ts</C>, "Supabase Realtime subscription; does nothing with a null client"],
        ]}
      />
      <P>
        shadcn dependencies (button, input, textarea, badge, avatar, scroll-area, tabs, dialog,
        select, tooltip, sonner) are installed with it. Styling uses your theme tokens, light and
        dark.
      </P>

      <Heading id="auth">Server-action auth</Heading>
      <P>
        <C>wa.inbox</C> runs with the service role and does no auth. Every server action must call
        your auth check first, and the template&rsquo;s <C>requireUser()</C> throws until you
        implement it (fail closed):
      </P>
      <Sample file="inbox-actions.ts" region="auth" title="app/(protected)/whatsapp/actions.ts" />
      <P>
        Then pass the user&rsquo;s tenant to every call. <C>tenantId</C> is required for{" "}
        <C>list</C>; for <C>thread</C>, <C>reply</C> and <C>markSeen</C> it turns another
        tenant&rsquo;s conversation into a <C>RecordNotFoundError</C>. <C>wa.conversations.*</C>{" "}
        take no tenant, so check it yourself:
      </P>
      <Sample file="inbox-actions.ts" region="actions" title="app/(protected)/whatsapp/actions.ts" />
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

      <Heading id="realtime">Realtime and RLS</Heading>
      <P>
        The migration adds <C>wa_conversations</C> and <C>wa_messages</C> to the{" "}
        <C>supabase_realtime</C> publication. Browser clients use your anon key and the
        user&rsquo;s session, so they only receive rows for which{" "}
        <C>wa_can_access_tenant(tenant_id)</C> is true. With the default (<C>false</C>) the inbox
        gets no live updates: implement it as in{" "}
        <A href="/docs/quickstart#migration">Quickstart step 4</A>.
      </P>

      <Heading id="strings">Strings</Heading>
      <P>
        The inbox is in Spanish (es-GT) by default. Every user-facing string comes from one
        defaults module and can be overridden through a <C>strings</C> prop, so you can rephrase or
        translate without editing the components. Dates use <C>date-fns</C> with the{" "}
        <C>es</C> locale and the <C>America/Guatemala</C> timezone by default.
      </P>

      <Heading id="motion">Motion tokens</Heading>
      <P>
        Inbox components animate only <C>transform</C> and <C>opacity</C>, with durations and
        curves from these custom properties:
      </P>
      <CodeBlock
        title="components/whatsapp/motion.css"
        code={readRepoFile("registry/items/wa-li-inbox/components/whatsapp/motion.css")}
      />
      <Table
        head={["Token", "Used for"]}
        rows={[
          [<C key="t">--wa-dur-press</C>, "Press feedback on Tomar / Devolver / Cerrar (scale 0.97 on pointer-down)"],
          [<C key="t">--wa-dur-fast</C>, "Status badge and status tick cross-fades"],
          [<C key="t">--wa-dur-menu</C>, "New conversation rows and bubbles entering; composer ↔ template picker"],
          [<C key="t">--wa-dur-sheet</C>, "Dialogs; mobile sheets use springs with drag-to-dismiss"],
          [<C key="t">--wa-ease-out / --wa-ease-in-out</C>, "Entering elements / on-screen movement. Never ease-in."],
        ]}
      />
      <P>
        Override them after importing <C>motion.css</C>. Under{" "}
        <C>prefers-reduced-motion: reduce</C> durations drop to 0 and <C>.wa-motion-transform</C>{" "}
        removes movement.
      </P>
      <Sample file="motion-overrides.css" title="app/globals.css" />
    </DocPage>
  );
}
