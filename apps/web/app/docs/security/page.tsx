import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Security" };

const toc = [
  { id: "data", title: "Where data lives" },
  { id: "storage", title: "Private bucket and signed URLs" },
  { id: "retention-encryption", title: "Retention and encryption are yours" },
  { id: "tools", title: "Authorization inside tools" },
  { id: "tokens", title: "Tokens and secrets" },
  { id: "webhook", title: "Webhook verification" },
  { id: "access", title: "Database access" },
] as const;

export default function SecurityPage() {
  return (
    <DocPage slug="security" toc={toc}>
      <Heading id="data">Where data lives</Heading>
      <P>
        wa-li has no server of its own. Messages, contacts, media and raw webhooks are stored only
        in your Supabase project (<C>wa_*</C> tables and your Storage bucket), behind your RLS.
        Quami never receives them. For sensitive data (health, finance, minors) that means your
        app is the data controller for WhatsApp content too: apply the same policies you apply to
        the rest of your records.
      </P>

      <Heading id="storage">Private bucket and signed URLs</Heading>
      <List>
        <li>
          Inbound media is downloaded from Meta right away (Meta&rsquo;s URLs expire in minutes)
          and stored at{" "}
          <C>{"{tenant_id | _}/{account_id}/{conversation_id}/{meta_media_id}.{ext}"}</C> in{" "}
          <C>WA_STORAGE_BUCKET</C>.
        </li>
        <li>
          The bucket <strong>must be private</strong> (<C>public = false</C>). <C>doctor</C>{" "}
          checks that it exists, not its visibility, so check it in Supabase Studio.
        </li>
        <li>
          The inbox only shows media through signed URLs valid for 300 seconds (
          <C>wa.inbox.thread</C>). Don&rsquo;t persist signed URLs or make objects public to
          &ldquo;fix&rdquo; previews.
        </li>
        <li>
          Don&rsquo;t add Storage policies that let browser clients read the bucket directly.
        </li>
      </List>

      <Heading id="retention-encryption">Retention and encryption are yours</Heading>
      <P>
        wa-li prunes only <C>wa_events</C> (raw webhook payloads, 30 days by default). It never
        deletes <C>wa_messages</C> or <C>wa_media</C>, and it doesn&rsquo;t encrypt message content:
      </P>
      <List>
        <li>
          Decide how long conversations and files are kept and delete them on a schedule (see the
          example in <A href="/docs/retention#messages-media">Retention</A>).
        </li>
        <li>
          Encryption at rest is your database&rsquo;s and storage provider&rsquo;s (Supabase
          encrypts disks and backups). If you need column-level encryption, add it in your app;
          note that <C>wa_messages.text</C> holds a plain-text copy of the body for previews and
          search.
        </li>
        <li>
          Raw payloads in <C>wa_events.payload</C> contain message text and phone numbers; keep
          <C> eventRetentionDays</C> as short as your reprocessing needs allow.
        </li>
      </List>

      <Heading id="tools">Authorization inside tools</Heading>
      <P>
        The agent&rsquo;s context is limited to one contact and one conversation, and tool input
        is validated with zod before <C>run</C>. That doesn&rsquo;t make the input trustworthy: a
        user can write anything, including instructions aimed at the model (prompt injection). So:
      </P>
      <List>
        <li>
          Authorize in <C>run</C> from the context wa-li gives you (<C>contact.appRef</C>,{" "}
          <C>account.tenantId</C>), never from ids the model passes in.
        </li>
        <li>
          Handle <C>contact.appRef === null</C> (unlinked contacts): ask for an identifier and
          verify it, don&rsquo;t guess.
        </li>
        <li>Return only what this contact may see. Tool results go back to the model.</li>
        <li>Give tools the narrowest scope: read-only where possible, no generic SQL.</li>
      </List>
      <Sample file="agents.ts" region="tool" title="ts" />

      <Heading id="tokens">Tokens and secrets</Heading>
      <List>
        <li>
          <C>wa_accounts.token_ref</C> stores the <strong>name</strong> of an env var or secret.
          Tokens are resolved per call through <C>resolveToken(account)</C> and never written to
          the database.
        </li>
        <li>
          Logs are redacted: the logger strips <C>Authorization</C> headers,{" "}
          <C>access_token</C> parameters, the app secret, the verify token and every token it
          resolved. <C>MetaApiError</C> messages are redacted too, and <C>toJSON()</C> omits{" "}
          <C>cause</C> and <C>stack</C>. <C>doctor</C> never prints a token.
        </li>
        <li>
          <C>SUPABASE_SERVICE_ROLE_KEY</C> bypasses RLS: server only, never in a{" "}
          <C>NEXT_PUBLIC_*</C> variable.
        </li>
      </List>
      <Callout variant="danger">
        <p>
          A token pasted into <C>wa_accounts.token_ref</C> is a leaked token. Rotate it in Meta
          Business Settings and store the variable name instead.
        </p>
      </Callout>

      <Heading id="webhook">Webhook verification</Heading>
      <P>
        POSTs are checked with HMAC-SHA256 of the raw body against{" "}
        <C>X-Hub-Signature-256</C> using your app secret, compared in constant time; a bad
        signature returns 401 and stores nothing. The GET verify token is also compared in constant
        time.
      </P>

      <Heading id="access">Database access</Heading>
      <P>
        RLS is enabled on every <C>wa_*</C> table, with only SELECT policies through{" "}
        <C>wa_can_access_tenant(tenant_id)</C> (default <C>false</C>). Events, locks and schema
        metadata are service-role only, and browser clients can&rsquo;t write. Keep it that way:
        writes go through server actions that call your auth check (
        <A href="/docs/inbox#auth">Inbox</A>).
      </P>
    </DocPage>
  );
}
