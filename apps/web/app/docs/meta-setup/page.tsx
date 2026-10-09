import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { CodeBlock } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P, ScreenshotPlaceholder } from "@/components/docs/prose";
import { Table } from "@/components/docs/table";

export const metadata: Metadata = { title: "Meta setup" };

const toc = [
  { id: "app", title: "1. Create the Meta app" },
  { id: "whatsapp-product", title: "2. Add the WhatsApp product" },
  { id: "test-number", title: "3. Test number and recipients" },
  { id: "system-user", title: "4. System user token" },
  { id: "app-secret", title: "5. App secret" },
  { id: "tunnel", title: "6. Tunnel for local development" },
  { id: "webhook", title: "7. Webhook and the messages field" },
  { id: "ids", title: "Where each value goes" },
] as const;

export default function MetaSetupPage() {
  return (
    <DocPage slug="meta-setup" toc={toc}>
      <P>
        wa-li only talks to the official WhatsApp Cloud API. You need a Meta Business account
        (business.facebook.com) and a developer account (developers.facebook.com). Meta renames
        menu items from time to time; the names below match the dashboard at the time of writing.
      </P>

      <Heading id="app">1. Create the Meta app</Heading>
      <List ordered>
        <li>
          developers.facebook.com &rsaquo; <strong>My Apps</strong> &rsaquo;{" "}
          <strong>Create app</strong>.
        </li>
        <li>
          Choose the <strong>Business</strong> type (or the &ldquo;Connect with customers through
          WhatsApp&rdquo; use case) and link it to your Meta Business account.
        </li>
      </List>
      <ScreenshotPlaceholder caption="Create app: Business type, linked business portfolio." />

      <Heading id="whatsapp-product">2. Add the WhatsApp product</Heading>
      <P>
        In the app dashboard, <strong>Add product</strong> &rsaquo; <strong>WhatsApp</strong>{" "}
        &rsaquo; <strong>Set up</strong>. Meta creates a WhatsApp Business Account (WABA) for the
        business and opens <strong>WhatsApp &rsaquo; API Setup</strong>.
      </P>
      <ScreenshotPlaceholder caption="WhatsApp > API Setup with the test number, Phone number ID and WhatsApp Business Account ID." />

      <Heading id="test-number">3. Test number and recipients</Heading>
      <List>
        <li>
          API Setup shows a free <strong>test number</strong> with its <strong>Phone number ID</strong>{" "}
          and the <strong>WhatsApp Business Account ID</strong>. Copy both.
        </li>
        <li>
          Under <strong>To</strong>, add up to five recipient numbers and verify them with the code
          Meta sends. The test number can only message verified recipients.
        </li>
        <li>
          For production, add your own number under <strong>WhatsApp &rsaquo; API Setup &rsaquo; Add
          phone number</strong> (it must not be registered in the WhatsApp app) and complete the
          display name review.
        </li>
      </List>

      <Heading id="system-user">4. System user token</Heading>
      <P>
        The temporary token on API Setup expires after 24 hours. Use a system user token, which
        doesn&rsquo;t expire:
      </P>
      <List ordered>
        <li>
          business.facebook.com &rsaquo; <strong>Settings</strong> &rsaquo;{" "}
          <strong>Users &rsaquo; System users</strong> &rsaquo; <strong>Add</strong> (role Admin).
        </li>
        <li>
          <strong>Assign assets</strong>: your app, and the WhatsApp account with full control.
        </li>
        <li>
          <strong>Generate token</strong>: pick the app, expiration <strong>Never</strong>, and the
          permissions <C>whatsapp_business_messaging</C> and{" "}
          <C>whatsapp_business_management</C>.
        </li>
        <li>
          Put it in an env var such as <C>WA_TOKEN_MAIN</C> (locally and in your deployment). Never
          commit it and never store it in the database.
        </li>
      </List>
      <ScreenshotPlaceholder caption="System user > Generate token with both WhatsApp permissions selected." />
      <Callout variant="warning">
        <p>
          <C>whatsapp_business_management</C> is required for template sync and for{" "}
          <C>doctor</C>&rsquo;s subscription and template checks. A revoked or expired token
          surfaces as <C>MetaApiError</C> with <C>metaCode</C> 190, fires the{" "}
          <C>account.error</C> event, and fails <C>doctor</C>.
        </p>
      </Callout>

      <Heading id="app-secret">5. App secret</Heading>
      <P>
        App dashboard &rsaquo; <strong>App settings &rsaquo; Basic</strong> &rsaquo;{" "}
        <strong>App secret</strong> &rsaquo; Show. This is <C>WA_APP_SECRET</C>: wa-li verifies the{" "}
        <C>X-Hub-Signature-256</C> HMAC of every webhook POST with it and answers 401 on a
        mismatch. The <strong>App ID</strong> on the same page is the optional <C>WA_APP_ID</C>{" "}
        that <C>doctor</C> uses to confirm the app is subscribed to your WABA.
      </P>

      <Heading id="tunnel">6. Tunnel for local development</Heading>
      <P>
        Meta must reach your webhook over public HTTPS. Start the dev server, then one of:
      </P>
      <CodeBlock title="shell" code={"ngrok http 3000\n# or\ncloudflared tunnel --url http://localhost:3000"} />
      <P>
        Use the printed <C>https://…</C> host as the callback URL. Free ngrok and quick
        cloudflared tunnels change host on every start, so update the callback URL (and rerun{" "}
        <C>doctor --url</C>) when they do.
      </P>

      <Heading id="webhook">7. Webhook and the messages field</Heading>
      <List ordered>
        <li>
          Pick a random verify token and set it as <C>WA_VERIFY_TOKEN</C>, e.g.{" "}
          <C>openssl rand -hex 24</C>. Restart the dev server.
        </li>
        <li>
          App dashboard &rsaquo; <strong>WhatsApp &rsaquo; Configuration</strong> &rsaquo; Webhook
          &rsaquo; <strong>Edit</strong>: Callback URL <C>{"https://<host>/api/whatsapp"}</C>,
          Verify token = <C>WA_VERIFY_TOKEN</C>, <strong>Verify and save</strong>. Meta sends a GET
          challenge; wa-li answers it only when the token matches (403 otherwise).
        </li>
        <li>
          Under <strong>Webhook fields</strong>, <strong>Subscribe</strong> to <C>messages</C>. It
          carries inbound messages and the sent / delivered / read / failed statuses.
        </li>
        <li>
          If <C>doctor</C> reports the app isn&rsquo;t subscribed to the WABA, subscribe it with
          the token:
        </li>
      </List>
      <CodeBlock
        title="shell"
        code={'curl -X POST "https://graph.facebook.com/v26.0/<WABA_ID>/subscribed_apps" \\\n  -H "Authorization: Bearer $WA_TOKEN_MAIN"'}
      />
      <ScreenshotPlaceholder caption="WhatsApp > Configuration: callback URL verified, messages field subscribed." />

      <Heading id="ids">Where each value goes</Heading>
      <Table
        head={["Meta value", "wa-li"]}
        rows={[
          [
            "Phone number ID",
            <>
              <C>wa_accounts.phone_number_id</C> (<C>--phone-number-id</C>); webhooks are routed
              by it
            </>,
          ],
          [
            "WhatsApp Business Account ID",
            <>
              <C>wa_accounts.waba_id</C> (<C>--waba-id</C>, auto-detected when possible)
            </>,
          ],
          [
            "System user token",
            <>
              env var named by <C>wa_accounts.token_ref</C> (<C>--token-env</C>)
            </>,
          ],
          ["App secret", <C key="v">WA_APP_SECRET</C>],
          ["Verify token (yours)", <C key="v">WA_VERIFY_TOKEN</C>],
          ["App ID (optional)", <C key="v">WA_APP_ID</C>],
        ]}
      />
      <P>
        Back to <A href="/docs/quickstart#account">Quickstart step 6</A>.
      </P>
    </DocPage>
  );
}
