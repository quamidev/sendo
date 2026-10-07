import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { CodeBlock, Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { C, List, P } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Roadmap" };

const toc = [
  { id: "v2", title: "V2" },
  { id: "embedded-signup", title: "Embedded Signup" },
  { id: "broadcasts", title: "Broadcasts" },
  { id: "metrics", title: "Metrics" },
  { id: "adapters", title: "Drizzle and Prisma adapters" },
  { id: "voice", title: "Voice notes" },
  { id: "diff", title: "diff CLI" },
  { id: "v3", title: "V3: Quami Cloud transport" },
] as const;

export default function RoadmapPage() {
  return (
    <DocPage slug="roadmap" toc={toc}>
      <Callout variant="warning" title="Not available">
        <p>
          Everything on this page is a planned interface. None of it ships in V1 and the names may
          change. Only the <C>Transport</C> interface and the <C>quamiCloud</C> stub exist today.
        </p>
      </Callout>

      <Heading id="v2">V2</Heading>
      <P>V2 adds onboarding, outbound campaigns and insight on top of the same tables.</P>

      <Heading level={3} id="embedded-signup">Embedded Signup</Heading>
      <P>
        A <C>wa-li-connect</C> registry item (a &ldquo;Conectar número&rdquo; button using the
        Facebook JS SDK) lets each tenant connect their own number. Requires Quami to be a Meta Tech
        Provider.
      </P>
      <CodeBlock
        title="proposed"
        code={`wa.accounts.completeEmbeddedSignup({ code, tenantId }): Promise<Account>
// exchanges the code, registers the number, subscribes the app, inserts wa_accounts

createWhatsApp({
  // app-provided: persist the token in your secret store, return its reference
  storeToken: (account: Account, token: string) => Promise<string /* tokenRef */>,
})`}
      />

      <Heading level={3} id="broadcasts">Broadcasts</Heading>
      <CodeBlock
        title="proposed"
        code={`wa.broadcasts.create({ template, recipients, variables })
// tables: wa_broadcasts, wa_broadcast_recipients (per-recipient result)
// MARKETING templates only go to contacts with marketing_opt_in = true
// throttled to the account's messaging tier`}
      />

      <Heading level={3} id="metrics">Metrics</Heading>
      <P>
        SQL views (<C>wa_metrics_daily</C>: messages, response time, conversations per agent,
        handoff rate) plus a registry dashboard item.
      </P>

      <Heading level={3} id="adapters">Drizzle and Prisma adapters</Heading>
      <P>
        New subpath exports (<C>@quami/wa-li/adapters/drizzle</C>,{" "}
        <C>@quami/wa-li/adapters/prisma</C>) implementing <C>WhatsAppAdapter</C>. Both must pass{" "}
        <C>runAdapterContract</C>, which already exists.
      </P>

      <Heading level={3} id="voice">Voice notes</Heading>
      <P>
        A <C>transcribe</C> option (AI SDK <C>experimental_transcribe</C>) stores the transcript in{" "}
        <C>wa_messages.text</C> before the agent turn, so agents can answer audio.
      </P>

      <Heading level={3} id="diff">diff CLI</Heading>
      <P>
        <C>npx @quami/wa-li diff</C> fetches the latest registry items and compares them with your
        installed files and <C>wa_schema_meta.version</C>, with a changelog. Until then the package
        warns at startup when the installed schema is older than it expects.
      </P>

      <Heading id="v3">V3: Quami Cloud transport</Heading>
      <P>
        An optional hosted mode: <C>transport: quamiCloud({"{ apiKey }"})</C> sends traffic through
        Quami, which receives webhooks, stores data and delivers the same events. App code stays the
        same. It needs Meta Tech Provider status, encryption at rest, configurable retention, a DPA
        and its own spec before it&rsquo;s built.
      </P>
      <List>
        <li>
          <C>quamiCloud({"{ apiKey }"})</C> exists as a stub: every method rejects with{" "}
          <C>NotImplementedError</C> (<C>NOT_IMPLEMENTED</C>).
        </li>
        <li>
          The <C>Transport</C> interface is final for V1. Any object implementing it can be passed
          as <C>transport</C>:
        </li>
      </List>
      <Sample file="custom-transport.ts" region="transport" title="ts" />
      <P>
        With a transport that isn&rsquo;t <C>metaDirect</C>, <C>wa.handleWebhook</C> delegates to{" "}
        <C>transport.handleWebhook</C> (and throws <C>ConfigError</C> when it has none), and{" "}
        <C>wa.templates.sync()</C> throws <C>NotImplementedError</C>.
      </P>
    </DocPage>
  );
}
