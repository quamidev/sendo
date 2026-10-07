import type { Metadata } from "next";
import { CodeBlock, Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Multi-number" };

const toc = [
  { id: "model", title: "Accounts and tenants" },
  { id: "add", title: "Adding numbers" },
  { id: "routing", title: "Inbound routing" },
  { id: "sending", title: "Sending from a number" },
  { id: "agents", title: "Agents per number" },
  { id: "access", title: "Access per tenant" },
] as const;

export default function MultiNumberPage() {
  return (
    <DocPage slug="multi-number" toc={toc}>
      <Heading id="model">Accounts and tenants</Heading>
      <P>
        One deployment can serve many WhatsApp numbers. Each number is a <C>wa_accounts</C> row
        with its <C>phone_number_id</C>, <C>waba_id</C>, its own token env var (
        <C>token_ref</C>), a <C>timezone</C> and an optional <C>tenant_id</C> (for example one
        number per clinic or building). Every contact, conversation and message copies the
        account&rsquo;s <C>tenant_id</C>.
      </P>
      <List>
        <li>
          Contacts are unique per account and phone: the same person writing to two tenants&rsquo;
          numbers becomes two contacts, each with its own history.
        </li>
        <li>
          Set <C>active = false</C> to stop routing and sending for a number without deleting its
          data.
        </li>
      </List>

      <Heading id="add">Adding numbers</Heading>
      <CodeBlock
        title="shell"
        code={`# .env.local / deployment env
WA_TOKEN_CLINICA_NORTE=...
WA_TOKEN_CLINICA_SUR=...

npx @quami/wa-li accounts add --phone-number-id 111111111111111 --token-env WA_TOKEN_CLINICA_NORTE \\
  --tenant-id 6f1c0c3e-0000-4000-8000-000000000001 --timezone America/Guatemala --yes
npx @quami/wa-li accounts add --phone-number-id 222222222222222 --token-env WA_TOKEN_CLINICA_SUR \\
  --tenant-id 6f1c0c3e-0000-4000-8000-000000000002 --yes`}
      />
      <P>
        Numbers in different WABAs can use different tokens; numbers in the same WABA can share
        one env var. Then subscribe each WABA&rsquo;s webhook (<A href="/docs/meta-setup#webhook">
        Meta setup</A>) and run <C>doctor</C>, or <C>doctor --account &lt;id&gt;</C> for one.
      </P>

      <Heading id="routing">Inbound routing</Heading>
      <P>
        All numbers share one webhook URL. Each change in a payload carries{" "}
        <C>metadata.phone_number_id</C>, which is looked up in <C>wa_accounts</C>:
      </P>
      <List>
        <li>Active match: processed for that account and tenant.</li>
        <li>
          No match or inactive: the event is marked <C>unrouted</C>, a warning is logged, the{" "}
          <C>event.unrouted</C> event fires, and nothing else is written. Add the account and{" "}
          <C>wa.events.reprocess(id)</C> it.
        </li>
      </List>
      <Sample file="multi-number.ts" region="reply" title="ts" />

      <Heading id="sending">Sending from a number</Heading>
      <P>
        With exactly one active account, sends use it by default. With more than one, every{" "}
        <C>wa.send.*</C> and <C>wa.templates.sync</C> call must pass <C>account</C>: the wa-li
        account id, the Meta phone number id, or the <C>Account</C> object. Otherwise the call
        throws <C>AmbiguousAccountError</C> (or <C>AccountNotFoundError</C> for an unknown or
        inactive one). Replies (<C>reply</C>, agents, <C>wa.inbox.reply</C>) always go out from the
        conversation&rsquo;s own number.
      </P>
      <Sample file="multi-number.ts" region="account" title="ts" />
      <Sample file="multi-number.ts" region="ambiguous" title="ts" />

      <Heading id="agents">Agents per number</Heading>
      <P>
        An agent&rsquo;s <C>accounts</C> option is a list of account ids / phone number ids or a
        predicate. Only one agent may match each account: overlapping lists throw{" "}
        <C>ConfigError</C> at registration; overlaps found later (predicates, new accounts) are
        logged and no agent answers on that account until you fix them. The prompt uses the account&rsquo;s <C>timezone</C> unless the agent sets one.
      </P>
      <Sample file="multi-number.ts" region="agents" title="ts" />
      <P>
        Full agent options: <A href="/docs/api-reference#agents">API reference</A>.
      </P>

      <Heading id="access">Access per tenant</Heading>
      <List>
        <li>
          Browser reads (inbox realtime) are filtered by <C>wa_can_access_tenant(tenant_id)</C>:
          implement it with your membership table (
          <A href="/docs/quickstart#migration">Quickstart step 4</A>).
        </li>
        <li>
          Server actions pass the user&rsquo;s <C>tenantId</C> to <C>wa.inbox.*</C>, and{" "}
          <C>linkContact</C> / <C>resolveHandoffTargets</C> receive the <C>account</C> so you can
          scope lookups by <C>account.tenantId</C>.
        </li>
      </List>
    </DocPage>
  );
}
