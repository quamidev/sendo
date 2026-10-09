import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { CodeBlock, Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { A, C, List, P, Step } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Quickstart" };

export default function QuickstartPage() {
  return (
    <DocPage slug="quickstart">
      <P>
        Nine steps from an existing Next.js App Router + Supabase app to an AI agent answering
        &ldquo;hola&rdquo; on WhatsApp. Budget under an hour; most of it is the{" "}
        <A href="/docs/meta-setup">Meta setup</A>, so open that page in another tab.
      </P>
      <Callout title="Before you start">
        <List>
          <li>
            Next.js 15+ (App Router), Node 20+, a Supabase project (or <C>supabase start</C>{" "}
            locally) and the Supabase CLI.
          </li>
          <li>
            A Meta developer app with the WhatsApp product, a test number and a system user token
            (see <A href="/docs/meta-setup">Meta setup</A>).
          </li>
          <li>
            A <C>QUAMI_REGISTRY_TOKEN</C> for the registry and an npm token with read access to
            the private <C>@quami</C> scope. Ask the Quami team for both.
          </li>
        </List>
      </Callout>

      <Step n={1} id="registry" title="Add the @quami registry to components.json">
        <P>
          Registry items are installed with the standard shadcn CLI. Add the private registry
          next to your existing shadcn config; the token is read from the environment.
        </P>
        <Sample file="components.json" title="components.json" />
        <CodeBlock title="shell" code={`echo "QUAMI_REGISTRY_TOKEN=<token from Quami>" >> .env.local`} />
      </Step>

      <Step n={2} id="install" title="Install the package">
        <P>
          <C>@quami/wa-li</C> lives in a private npm scope. Point the scope at npm with your token
          (locally and in CI / Vercel), then install. <C>zod</C> (v4) and <C>ai</C> (v6) are peer
          dependencies; npm 7+ installs them automatically.
        </P>
        <Sample file="npmrc" title=".npmrc" />
        <CodeBlock title="shell" code="npm install @quami/wa-li" />
      </Step>

      <Step n={3} id="add-items" title="Add the webhook, schema and inbox items">
        <CodeBlock
          title="shell"
          code="npx shadcn add @quami/wa-li-webhook @quami/wa-li-schema @quami/wa-li-inbox"
        />
        <List>
          <li>
            <C>wa-li-webhook</C>: <C>app/api/whatsapp/route.ts</C> and <C>lib/whatsapp.ts</C> (the
            client config with TODO hooks). Adds <C>@supabase/supabase-js</C>.
          </li>
          <li>
            <C>wa-li-schema</C>: <C>supabase/migrations/20261006000000_quami_whatsapp_v1.sql</C>.
          </li>
          <li>
            <C>wa-li-inbox</C>: the staff inbox (see <A href="/docs/inbox">Inbox</A>).
          </li>
        </List>
        <P>The installed route is three lines:</P>
        <Sample file="webhook-route.ts" title="app/api/whatsapp/route.ts" />
      </Step>

      <Step n={4} id="migration" title="Run the migration and implement wa_can_access_tenant">
        <CodeBlock title="shell" code={"supabase migration up   # local\nsupabase db push        # linked project"} />
        <P>
          The migration creates the <C>wa_*</C> tables with RLS on every table. The package uses
          the service role and bypasses RLS; browser clients (the inbox&rsquo;s realtime
          subscriptions) only see rows for which <C>wa_can_access_tenant(tenant_id)</C> returns
          true. It returns <C>false</C> by default, so replace it in a migration of your own (keep
          the signature and the parameter name):
        </P>
        <Sample file="sql/wa-can-access-tenant.sql" region="multi" title="supabase/migrations/<ts>_wa_can_access_tenant.sql" />
        <P>For a single-tenant app, where every <C>tenant_id</C> is null:</P>
        <Sample file="sql/wa-can-access-tenant.sql" region="single" title="sql" />
        <P>
          Inbound media goes to a <strong>private</strong> Storage bucket, which the migration
          does not create:
        </P>
        <Sample file="sql/storage-bucket.sql" title="sql" />
      </Step>

      <Step n={5} id="env" title="Set the environment variables">
        <Sample file="env.local" title=".env.local" />
        <P>
          <C>WA_TOKEN_MAIN</C> is only a name: each <C>wa_accounts</C> row stores the name of the
          env var holding its token in <C>token_ref</C>, and <C>resolveToken</C> reads it at call
          time. The token is never written to the database or logs. A gateway model id such as{" "}
          <C>openai/gpt-5-mini</C> needs AI Gateway credentials; any AI SDK v6{" "}
          <C>LanguageModel</C> works too.
        </P>
        <P>
          Then fill in the hooks in <C>lib/whatsapp.ts</C> and register an agent. The complete
          file:
        </P>
        <Sample file="whatsapp.ts" region="config" title="lib/whatsapp.ts" />
        <P>Append the agent to the same file:</P>
        <Sample file="whatsapp.ts" region="agent" title="lib/whatsapp.ts (continued)" />
      </Step>

      <Step n={6} id="account" title="Register the number in wa_accounts">
        <CodeBlock
          title="shell"
          code="npx @quami/wa-li accounts add --phone-number-id 123456789012345 --token-env WA_TOKEN_MAIN"
        />
        <P>
          It reads <C>.env.local</C>, refuses to run when the token variable is empty, fetches the
          display phone and (when possible) the WABA id from Meta, and stores only the variable
          name. Flags and prompts: <A href="/docs/cli#accounts-add">CLI</A>. Or insert the row
          yourself:
        </P>
        <Sample file="sql/wa-account.sql" title="sql" />
      </Step>

      <Step n={7} id="webhook" title="Point the Meta webhook at your app">
        <P>
          In the Meta App Dashboard, <strong>WhatsApp &rsaquo; Configuration</strong>: set the
          Callback URL to <C>{"https://<app>/api/whatsapp"}</C> and the Verify token to the value
          of <C>WA_VERIFY_TOKEN</C>, click <strong>Verify and save</strong>, then subscribe the{" "}
          <C>messages</C> webhook field. In development, expose your dev server with a tunnel (
          <A href="/docs/meta-setup#tunnel">ngrok or cloudflared</A>).
        </P>
      </Step>

      <Step n={8} id="doctor" title="Run doctor">
        <CodeBlock title="shell" code="npx @quami/wa-li doctor --url https://<app>/api/whatsapp" />
        <P>
          Every check should pass: env vars, tables and schema version, the storage bucket, each
          account&rsquo;s token and phone status, the WABA subscription, template listing and the
          webhook verify round-trip. Each failure prints a fix hint (in Spanish) and the command
          exits with code 1. See <A href="/docs/cli#doctor">all checks</A>.
        </P>
      </Step>

      <Step n={9} id="hola" title="Send “hola”">
        <P>
          From a phone added as a test recipient, send <C>hola</C> to the test number. The webhook
          returns 200 immediately, stores the message, and the <C>recepcion</C> agent answers
          within seconds. Ask for a person to see the handoff: the conversation moves to{" "}
          <C>human</C> and shows up in the inbox.
        </P>
        <Callout variant="warning" title="No reply?">
          <List>
            <li>
              Run <C>doctor</C> again and check your server logs for <C>[wa-li]</C> lines.
            </li>
            <li>
              Look at <C>wa_events</C>: <C>unrouted</C> means the <C>phone_number_id</C> isn&rsquo;t
              in <C>wa_accounts</C>; <C>failed</C> carries the error. Fix it and call{" "}
              <C>wa.events.reprocess(id)</C>.
            </li>
            <li>
              Nothing in <C>wa_events</C>: the webhook isn&rsquo;t reaching you (URL, tunnel,{" "}
              <C>messages</C> subscription) or the signature fails (wrong <C>WA_APP_SECRET</C>, 401).
            </li>
          </List>
        </Callout>
        <P>
          Next: <A href="/docs/api-reference">API reference</A>,{" "}
          <A href="/docs/security">Security</A> and <A href="/docs/retention">Retention</A>.
        </P>
      </Step>
    </DocPage>
  );
}
