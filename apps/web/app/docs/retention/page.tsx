import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Retention" };

const toc = [
  { id: "events", title: "wa_events (built in)" },
  { id: "pg-cron", title: "Option A: pg_cron" },
  { id: "vercel-cron", title: "Option B: Vercel Cron" },
  { id: "messages-media", title: "Messages and media (your policy)" },
] as const;

export default function RetentionPage() {
  return (
    <DocPage slug="retention" toc={toc}>
      <Heading id="events">wa_events (built in)</Heading>
      <P>
        Every webhook POST is stored raw in <C>wa_events</C> so failed events can be reprocessed.
        Rows older than 30 days should be deleted. Pick one of the two options below; running both
        is harmless.
      </P>

      <Heading id="pg-cron">Option A: pg_cron</Heading>
      <P>
        If the <C>pg_cron</C> extension is enabled when the <C>wa-li-schema</C> migration runs (
        Supabase: <strong>Database &rsaquo; Extensions</strong>), the migration schedules a daily
        job:
      </P>
      <Sample file="sql/pg-cron.sql" region="installed" title="sql" />
      <P>
        <C>wa_prune_events(days)</C> deletes events received more than <C>days</C> ago and returns
        the count. It is service-role only. If you enable pg_cron later, or want another period:
      </P>
      <Sample file="sql/pg-cron.sql" region="late" title="sql" />

      <Heading id="vercel-cron">Option B: Vercel Cron</Heading>
      <P>
        Without pg_cron, call <C>wa.maintenance.prune()</C> from a scheduled route. It deletes
        events older than <C>eventRetentionDays</C> (default 30) and returns the count; pass{" "}
        <C>{"{ olderThanDays }"}</C> to override.
      </P>
      <Sample file="cron-route.ts" title="app/api/cron/wa-prune/route.ts" />
      <Sample file="vercel.json" title="vercel.json" />
      <P>
        Set <C>CRON_SECRET</C> in the Vercel project; Vercel sends it as a bearer token on cron
        requests. Any other scheduler (GitHub Actions, Supabase scheduled functions) can call the
        same route.
      </P>

      <Heading id="messages-media">Messages and media (your policy)</Heading>
      <P>
        wa-li never deletes <C>wa_messages</C>, <C>wa_media</C> or stored files. How long
        conversations are kept is your app&rsquo;s decision (and, for health or financial data,
        often a legal one). A starting point that deletes files through the Storage API and then
        the messages (their <C>wa_media</C> rows cascade):
      </P>
      <Sample file="message-retention.ts" title="app/api/cron/wa-message-retention/route.ts" />
      <Callout>
        <List>
          <li>
            Delete files before rows: once the <C>wa_media</C> row is gone you lose the storage
            path.
          </li>
          <li>
            The sample handles up to 1,000 files per run; schedule it often enough or loop.
          </li>
          <li>
            Deleting messages also removes them from the inbox and from agent history. Archive
            first if you need an audit trail. See <A href="/docs/security">Security</A>.
          </li>
        </List>
      </Callout>
    </DocPage>
  );
}
