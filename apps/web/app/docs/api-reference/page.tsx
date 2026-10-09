import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { CodeBlock, Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P } from "@/components/docs/prose";
import { Table } from "@/components/docs/table";

export const metadata: Metadata = { title: "API reference" };

const toc = [
  { id: "entry-points", title: "Entry points" },
  { id: "config", title: "createWhatsApp config" },
  { id: "events", title: "Events (wa.on)" },
  { id: "send", title: "Sending (wa.send)" },
  { id: "reply", title: "reply" },
  { id: "templates", title: "wa.templates" },
  { id: "conversations", title: "wa.conversations" },
  { id: "inbox", title: "wa.inbox" },
  { id: "events-maintenance", title: "wa.events and wa.maintenance" },
  { id: "handle-webhook", title: "wa.handleWebhook" },
  { id: "next", title: "@quami/wa-li/next" },
  { id: "agents", title: "Agents (wa.agent)" },
  { id: "adapters", title: "Adapters" },
  { id: "transport", title: "Transport" },
  { id: "errors", title: "Typed errors" },
  { id: "utilities", title: "Utilities" },
] as const;

export default function ApiReferencePage() {
  return (
    <DocPage slug="api-reference" toc={toc}>
      <Heading id="entry-points">Entry points</Heading>
      <Table
        head={["Import", "Exports", "Needs"]}
        rows={[
          [
            <C key="i">@quami/wa-li</C>,
            <>
              <C>createWhatsApp</C>, types, errors, <C>metaDirect</C>, <C>quamiCloud</C>,{" "}
              <C>agentTool</C>, utilities, <C>runDoctor</C> / <C>addAccount</C>
            </>,
            <>
              <C>zod</C> 4, <C>ai</C> 6 (peers)
            </>,
          ],
          [<C key="i">@quami/wa-li/adapters/supabase</C>, <C key="e">supabaseAdapter</C>, <C key="n">@supabase/supabase-js</C>],
          [<C key="i">@quami/wa-li/adapters/memory</C>, <C key="e">memoryAdapter</C>, "—"],
          [<C key="i">@quami/wa-li/adapters/contract</C>, <C key="e">runAdapterContract</C>, <C key="n">vitest</C>],
          [<C key="i">@quami/wa-li/next</C>, <C key="e">toNextHandlers</C>, <C key="n">next</C>],
          [<C key="i">npx @quami/wa-li</C>, <A key="e" href="/docs/cli">doctor, accounts add</A>, "—"],
        ]}
      />
      <P>
        Everything runs on the server with the Supabase service role. Never import{" "}
        <C>lib/whatsapp.ts</C> from a client component.
      </P>

      <Heading id="config">createWhatsApp config</Heading>
      <Sample file="whatsapp.ts" region="config" title="lib/whatsapp.ts" />
      <Table
        head={["Option", "Type", "Default / notes"]}
        rows={[
          [<C key="o">adapter</C>, <C key="t">WhatsAppAdapter</C>, "Required. supabaseAdapter or memoryAdapter."],
          [<C key="o">appSecret</C>, <C key="t">string</C>, "Required unless transport is set. Verifies X-Hub-Signature-256."],
          [<C key="o">verifyToken</C>, <C key="t">string</C>, "Required unless transport is set. Webhook GET challenge."],
          [
            <C key="o">resolveToken</C>,
            <C key="t">{"(account) => string | null | undefined | Promise<…>"}</C>,
            "Required unless transport is set. Called per Meta call; empty → ConfigError.",
          ],
          [<C key="o">transport</C>, <C key="t">Transport</C>, "Replaces the three options above (metaDirect(...) or quamiCloud(...))."],
          [<C key="o">graphVersion</C>, <C key="t">string</C>, "GRAPH_API_VERSION (\"v26.0\"). Shorthand config only."],
          [<C key="o">fetch</C>, <C key="t">typeof fetch</C>, "globalThis.fetch. Shorthand config only."],
          [
            <C key="o">linkContact</C>,
            <C key="t">{"({ phone, account, contact }) => string | null"}</C>,
            "Called on a new contact and when the profile name changes; stored in contact.appRef.",
          ],
          [
            <C key="o">resolveHandoffTargets</C>,
            <C key="t">{"({ to, account, conversation, contact }) => string[]"}</C>,
            "Handoff assignees. Exactly one id sets assignedTo.",
          ],
          [<C key="o">agentDefaults</C>, <C key="t">{"{ historyLimit, maxStepsPerTurn, maxMessagesPerMinutePerContact }"}</C>, "20, 5, 10"],
          [<C key="o">eventRetentionDays</C>, <C key="t">number</C>, "30 (wa.maintenance.prune)"],
          [<C key="o">handoffMessage</C>, <C key="t">string | null</C>, "\"Te comunico con una persona del equipo.\"; null sends nothing."],
          [<C key="o">defaultCountry</C>, <C key="t">string</C>, "ISO-2 or calling code for national numbers, e.g. \"GT\"."],
          [<C key="o">logger</C>, <C key="t">Logger</C>, "Console-like. Every line is redacted (tokens, secrets, Authorization)."],
        ]}
      />
      <P>
        <C>createWhatsApp</C> throws <C>ConfigError</C> on invalid config. On first use it checks{" "}
        <C>wa_schema_meta</C> and logs a warning when the tables are missing or older than{" "}
        <C>WA_SCHEMA_VERSION</C>.
      </P>

      <Heading id="events">Events (wa.on)</Heading>
      <P>
        <C>wa.on(event, handler)</C> returns an unsubscribe function. Handlers run one after
        another in the background pipeline; a throwing handler is logged and the pipeline goes on.
      </P>
      <Table
        head={["Event", "Payload", "When"]}
        rows={[
          [<C key="e">message</C>, <C key="p">{"{ message, contact, conversation, account, reply }"}</C>, "Each new inbound message, after it (and its media) is stored. message.media is the Media row or null."],
          [<C key="e">status</C>, <C key="p">{"{ message, status, error? }"}</C>, "A delivery status moved an outbound message forward (sent → delivered → read, or failed)."],
          [<C key="e">handoff</C>, <C key="p">{"{ conversation, contact, account, reason, assignees }"}</C>, "A conversation was handed to humans."],
          [<C key="e">conversation.status</C>, <C key="p">{"{ conversation, from, to, by }"}</C>, "agent / human / closed changes, including a reopen (by \"system\")."],
          [<C key="e">account.error</C>, <C key="p">{"{ account, error }"}</C>, "Meta rejected the account token (error.isInvalidToken, code 190)."],
          [<C key="e">event.unrouted</C>, <C key="p">{"{ phoneNumberId, raw }"}</C>, "A webhook for a phone_number_id with no active wa_accounts row."],
        ]}
      />
      <Sample file="events.ts" region="on" title="ts" />

      <Heading id="send">Sending (wa.send)</Heading>
      <CodeBlock
        title="signatures"
        code={`wa.send.text(to, body, { account?, previewUrl?, replyTo? }): Promise<Message>
wa.send.media(to, { type, url? | file? | id?, mimeType?, caption?, filename? }, { account?, replyTo? })
wa.send.buttons(to, { body, buttons: { id, title }[] /* ≤ 3 */, header?, footer? }, { account?, replyTo? })
wa.send.list(to, { body, button, sections, header?, footer? }, { account?, replyTo? })
wa.send.template(to, name, { language, variables?, headerMedia?, buttons?, account?, replyTo? })
wa.send.markRead(messageId): Promise<void>`}
      />
      <P>Every send:</P>
      <List ordered>
        <li>normalizes the number to E.164 (<C>InvalidPhoneError</C>);</li>
        <li>
          resolves the account (<C>account</C> option, or the only active account;{" "}
          <C>AmbiguousAccountError</C> when several are active);
        </li>
        <li>gets or creates the contact and the conversation;</li>
        <li>
          checks the 24-hour window, except for templates (<C>WindowClosedError</C>, before any
          write or Meta call);
        </li>
        <li>
          inserts a <C>wa_messages</C> row with status <C>pending</C> (sender <C>system</C>);
        </li>
        <li>calls Meta (file media is uploaded first);</li>
        <li>
          stores the Meta id and status <C>sent</C>, or <C>failed</C> with the error and rethrows.
        </li>
      </List>
      <Sample file="send.ts" region="send" title="ts" />
      <Callout>
        <p>
          Templates are read from <C>wa_templates</C>, not from Meta: call{" "}
          <C>wa.templates.sync()</C> after creating or editing templates, or{" "}
          <C>send.template</C> throws <C>TemplateNotFoundError</C>. A wrong number of variables
          throws <C>TemplateVariablesError</C>. Media is checked against Meta&rsquo;s limits
          (image 5 MB, audio/video 16 MB, document 100 MB, sticker 500 KB) before upload.
        </p>
      </Callout>

      <Heading id="reply">reply</Heading>
      <P>
        The <C>reply</C> in the <C>message</C> event is bound to the conversation and stores
        sends with that sender: <C>text(body, opts?)</C>, <C>media(media, opts?)</C>,{" "}
        <C>buttons(input, opts?)</C>, <C>list(input, opts?)</C>, <C>template(name, opts)</C>,{" "}
        <C>react(emoji, messageId?)</C> (<C>&quot;&quot;</C> removes the reaction) and{" "}
        <C>markRead(messageId?)</C>. Both default to the inbound message.
      </P>

      <Heading id="templates">wa.templates</Heading>
      <Sample file="templates-conversations.ts" region="templates" title="ts" />
      <List>
        <li>
          <C>sync({"{ account? }"})</C> pulls templates from Meta, upserts them and marks the ones
          deleted on Meta inactive. Returns <C>Template[]</C>.
        </li>
        <li>
          <C>list({"{ account?, status?, includeInactive? }"})</C> reads <C>wa_templates</C>.
        </li>
      </List>

      <Heading id="conversations">wa.conversations</Heading>
      <Sample file="templates-conversations.ts" region="conversations" title="ts" />
      <List>
        <li>
          <C>handoff(id, {"{ reason, to?, message?, by? }"})</C>: status <C>human</C>, reason
          stored, <C>resolveHandoffTargets</C> called (one assignee → <C>assignedTo</C>), the
          handoff message sent, <C>handoff</C> event emitted.
        </li>
        <li>
          <C>returnToAgent(id)</C> clears <C>assignedTo</C> and <C>handoffReason</C>;{" "}
          <C>close(id)</C> closes it. A new inbound message reopens a closed conversation with
          status <C>agent</C>.
        </li>
        <li>
          <C>assign(id, userId)</C> also moves the conversation to <C>human</C>;{" "}
          <C>assign(id, null)</C> only unassigns.
        </li>
        <li>
          <C>by</C> (default <C>&quot;system&quot;</C>) shows up in the{" "}
          <C>conversation.status</C> event.
        </li>
      </List>

      <Heading id="inbox">wa.inbox</Heading>
      <P>
        Server-side operations behind the inbox server actions. They do no auth: call your own
        check first (<A href="/docs/inbox#auth">Inbox</A>).
      </P>
      <Table
        head={["Method", "Returns", "Notes"]}
        rows={[
          [
            <C key="m">{"list({ tenantId, status?, assignedTo?, accountId?, cursor?, limit? })"}</C>,
            <C key="r">{"Page<InboxConversation>"}</C>,
            "tenantId is required (null for single-tenant apps). Most recent activity first. Limit 30, max 100.",
          ],
          [
            <C key="m">{"thread(conversationId, { tenantId?, cursor?, limit? })"}</C>,
            <C key="r">{"Page<InboxMessage>"}</C>,
            "Newest first (reverse for display). Media has a signed URL valid 300 s. Limit 50, max 100.",
          ],
          [
            <C key="m">{"reply(conversationId, payload, { userId, tenantId? })"}</C>,
            <C key="r">Message</C>,
            "payload: { kind: \"text\" | \"media\" | \"template\", … }. Sender human, senderRef userId. WindowClosedError for free-form outside the window.",
          ],
          [
            <C key="m">{"markSeen(conversationId, { tenantId? })"}</C>,
            <C key="r">Conversation</C>,
            "Resets unreadCount.",
          ],
        ]}
      />
      <P>
        Passing <C>tenantId</C> makes a conversation of another tenant behave as not found (
        <C>RecordNotFoundError</C>). <C>InboxConversation</C> adds <C>window</C>,{" "}
        <C>contact.displayName</C> and <C>lastMessagePreview</C> to the conversation.
      </P>

      <Heading id="events-maintenance">wa.events and wa.maintenance</Heading>
      <P>
        Every webhook POST is stored in <C>wa_events</C> before the 200 and ends as{" "}
        <C>processed</C>, <C>failed</C> (with a redacted error) or <C>unrouted</C>.
      </P>
      <Sample file="events-maintenance.ts" region="events" title="ts" />
      <Sample file="events-maintenance.ts" region="prune" title="ts" />
      <P>
        Scheduling the prune: <A href="/docs/retention">Retention</A>.
      </P>

      <Heading id="handle-webhook">wa.handleWebhook</Heading>
      <P>
        <C>wa.handleWebhook(request, {"{ waitUntil? }"})</C> is the framework-agnostic entry point
        (Web <C>Request</C> → <C>Response</C>):
      </P>
      <Table
        head={["Request", "Response"]}
        rows={[
          ["GET with the matching hub.verify_token", "200 with hub.challenge (text/plain)"],
          ["GET with a wrong or missing token", "403"],
          ["POST with a missing or invalid X-Hub-Signature-256", "401, nothing stored"],
          ["POST with a body that isn't JSON", "400"],
          ["POST, event could not be stored", "500 (Meta retries)"],
          ["POST, event stored", "200 immediately; processing continues via waitUntil"],
          ["Any other method", "405"],
        ]}
      />
      <Sample file="handle-webhook.ts" region="generic" title="ts" />

      <Heading id="next">@quami/wa-li/next</Heading>
      <P>
        <C>toNextHandlers(wa, {"{ waitUntil? }"})</C> returns <C>{"{ GET, POST }"}</C> for an App
        Router route. <C>POST</C> keeps the pipeline alive with <C>after()</C> from{" "}
        <C>next/server</C> (loaded lazily); pass <C>waitUntil</C> to override it.
      </P>
      <Sample file="webhook-route.ts" title="app/api/whatsapp/route.ts" />

      <Heading id="agents">Agents (wa.agent)</Heading>
      <P>
        <C>wa.agent(definition)</C> registers an agent and returns{" "}
        <C>{"{ name, remove() }"}</C>. It answers inbound messages in conversations whose status
        is <C>agent</C> on the accounts it matches. Only one agent may match an account.
      </P>
      <Table
        head={["Field", "Notes"]}
        rows={[
          [<C key="f">name</C>, "Unique; stored as senderRef of the agent's messages."],
          [<C key="f">accounts?</C>, "Account ids / phone number ids, or (account) => boolean. Default: all."],
          [<C key="f">model</C>, "Gateway id string (\"openai/gpt-5-mini\") or an AI SDK LanguageModel."],
          [<C key="f">instructions</C>, "string or ({ account, contact, conversation, wa }) => string | Promise<string>."],
          [<C key="f">tools?</C>, "{ [name]: { description?, input: zod schema, run(ctx) } }. Use agentTool() for typed input."],
          [<C key="f">handoff?</C>, "{ when, to, message? } adds the transferir_a_humano({ motivo }) tool."],
          [<C key="f">historyLimit? / maxStepsPerTurn? / maxMessagesPerMinutePerContact?</C>, "Default agentDefaults (20 / 5 / 10)."],
          [<C key="f">fallbackMessage?</C>, "Sent when the model or a turn fails. Default: nothing."],
          [<C key="f">vision?</C>, "Default true: images go to the model as image parts; false describes them in text."],
          [<C key="f">timezone?</C>, "IANA zone for the date in the system prompt. Default: the account's."],
        ]}
      />
      <Sample file="agents.ts" region="tool" title="ts" />
      <Sample file="agents.ts" region="agent" title="ts" />
      <P>One turn, per conversation:</P>
      <List ordered>
        <li>
          Takes the <C>{"conv:<id>"}</C> lock (60 s); if another turn holds it, that turn picks up
          the new message.
        </li>
        <li>
          Skips the turn when the contact sent more than{" "}
          <C>maxMessagesPerMinutePerContact</C> messages in the last minute (messages are still
          stored).
        </li>
        <li>
          Builds the system prompt (instructions, handoff clause, contact name / phone /{" "}
          <C>appRef</C>, current date and time) and the last <C>historyLimit</C> messages of this
          conversation only.
        </li>
        <li>
          Runs <C>generateText</C> with <C>stopWhen: stepCountIs(maxStepsPerTurn)</C>. Tool input
          is validated with zod before <C>run</C>; each tool receives{" "}
          <C>{"{ input, contact, conversation, account, wa }"}</C>.
        </li>
        <li>
          Sends the final text as sender <C>agent</C>; tool calls and results go to{" "}
          <C>wa_messages.metadata</C>, never to the user.
        </li>
        <li>
          Loops while new inbound messages arrived (at most 3 turns), then releases the lock. On
          errors: logs, sends <C>fallbackMessage</C> if set, never leaves the lock held.
        </li>
      </List>
      <P>
        When the model calls <C>transferir_a_humano</C>, wa-li runs{" "}
        <C>wa.conversations.handoff</C> (by <C>{"agent:<name>"}</C>) and the agent stays silent
        until the conversation returns to <C>agent</C>.
      </P>

      <Heading id="adapters">Adapters</Heading>
      <P>
        All storage goes through a <C>WhatsAppAdapter</C>. Two ship with the package; both pass the
        same contract suite.
      </P>
      <Heading level={3} id="adapter-supabase">supabaseAdapter</Heading>
      <Sample file="supabase-adapter.ts" region="supabase" title="ts" />
      <P>
        Uses the service-role client, the <C>wa_*</C> tables and RPCs from the migration, and the
        given Storage bucket for media (signed URLs, default TTL 300 s). Database errors surface as{" "}
        <C>SupabaseAdapterError</C> (<C>code</C>, <C>operation</C>, <C>details</C>,{" "}
        <C>hint</C>).
      </P>
      <Heading level={3} id="adapter-memory">memoryAdapter</Heading>
      <Sample file="adapters.ts" region="memory" title="ts" />
      <P>
        Options: <C>now</C> (clock), <C>signedUrlBase</C>, and <C>schemaVersion</C> /{" "}
        <C>missingTables</C> / <C>bucketExists</C> to simulate broken setups. Use it in unit tests
        with a mocked <C>fetch</C> for Meta.
      </P>
      <Heading level={3} id="adapter-contract">runAdapterContract</Heading>
      <P>
        A Vitest suite every adapter must pass (accounts, contacts, conversations, messages
        including the forward-only status rule and the status race, media, templates, events,
        locks, storage, schema version). Write your own adapter and run:
      </P>
      <Sample file="adapter-contract.ts" title="my-adapter.contract.test.ts" />

      <Heading id="transport">Transport</Heading>
      <P>
        Graph API calls go through a <C>Transport</C>. The config shorthand builds{" "}
        <C>metaDirect</C> for you; build it yourself to change the Graph version or{" "}
        <C>fetch</C>:
      </P>
      <Sample file="transport.ts" region="metaDirect" title="ts" />
      <Sample file="transport.ts" region="quamiCloud" title="ts" />
      <P>
        The interface (<C>send</C>, <C>fetchMedia</C>, optional <C>uploadMedia</C>,{" "}
        <C>markRead</C>, <C>handleWebhook</C>, <C>subscribe</C>) is on the{" "}
        <A href="/docs/roadmap#v3">roadmap</A> page.
      </P>

      <Heading id="errors">Typed errors</Heading>
      <P>
        Every error extends <C>WhatsAppError</C> and carries a stable string <C>code</C>. Branch on{" "}
        <C>instanceof</C> or on <C>code</C>; <C>toJSON()</C> never includes <C>cause</C> or{" "}
        <C>stack</C>, and Meta error strings are redacted.
      </P>
      <Table
        head={["Class", "code", "Fields / thrown when"]}
        rows={[
          [<C key="c">WindowClosedError</C>, <C key="k">WINDOW_CLOSED</C>, "conversationId, expiresAt. Free-form send outside the 24-hour window."],
          [<C key="c">TemplateNotFoundError</C>, <C key="k">TEMPLATE_NOT_FOUND</C>, "templateName, language, accountId, reason (missing | not_approved | inactive)."],
          [<C key="c">TemplateVariablesError</C>, <C key="k">TEMPLATE_VARIABLES</C>, "templateName, expected, received."],
          [<C key="c">MetaApiError</C>, <C key="k">META_API_ERROR</C>, "status, metaCode (Meta's numeric code), subcode, fbtraceId, type, details; isInvalidToken for 190."],
          [<C key="c">AccountNotFoundError</C>, <C key="k">ACCOUNT_NOT_FOUND</C>, "account. Unknown or inactive account, or no account at all."],
          [<C key="c">AmbiguousAccountError</C>, <C key="k">AMBIGUOUS_ACCOUNT</C>, "candidates (account ids). Several active accounts and no account option."],
          [<C key="c">DuplicateAccountError</C>, <C key="k">ACCOUNT_EXISTS</C>, "phoneNumberId. accounts add / insert of an existing number."],
          [<C key="c">MediaTooLargeError</C>, <C key="k">MEDIA_TOO_LARGE</C>, "mediaType, sizeBytes, limitBytes."],
          [<C key="c">UnsupportedMediaTypeError</C>, <C key="k">UNSUPPORTED_MEDIA_TYPE</C>, "mediaType, mimeType."],
          [<C key="c">SignatureError</C>, <C key="k">INVALID_SIGNATURE</C>, "Invalid webhook signature (handleWebhook answers 401 instead of throwing)."],
          [<C key="c">InvalidPhoneError</C>, <C key="k">INVALID_PHONE</C>, "input. Number can't be normalized to E.164."],
          [<C key="c">PayloadValidationError</C>, <C key="k">INVALID_PAYLOAD</C>, "field, limit. A Meta message limit was exceeded (e.g. > 3 buttons)."],
          [<C key="c">RecordNotFoundError</C>, <C key="k">RECORD_NOT_FOUND</C>, "entity, id. Unknown conversation / message / event, or another tenant's."],
          [<C key="c">ConfigError</C>, <C key="k">CONFIG_ERROR</C>, "Invalid config, missing token, agent conflicts."],
          [<C key="c">NotImplementedError</C>, <C key="k">NOT_IMPLEMENTED</C>, "feature. quamiCloud and other reserved APIs."],
        ]}
      />
      <Sample file="errors.ts" region="handle" title="ts" />

      <Heading id="utilities">Utilities</Heading>
      <Sample file="utilities.ts" region="utils" title="ts" />
      <P>
        Also exported: <C>signBody</C>, <C>verifyChallenge</C>, <C>parseInboundMessage</C>,{" "}
        <C>parseStatusUpdate</C>, <C>windowExpiresAt</C>, <C>canTransition</C> /{" "}
        <C>nextStatus</C>, <C>createGraphClient</C>, the payload builders (<C>buildTextPayload</C>…)
        and <C>createRedactingLogger</C>.
      </P>
    </DocPage>
  );
}
