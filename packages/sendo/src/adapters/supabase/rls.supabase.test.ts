/**
 * RLS for internal notes and per-conversation reads (AC-CH-2), the default-account RPC, and the
 * schema v2 team tables (snippets, tags, conversation tags, rules), against a local Supabase
 * with real `authenticated` users (signed in through GoTrue).
 * Isolated because RLS is a security boundary the memory adapter cannot model.
 *
 * Failure modes, one test each:
 * [RLS-1] An anonymous client, or a user of another tenant, can read a tenant's conversations
 *         or messages.
 * [RLS-2] A user of the tenant cannot read an internal note while `sendo_can_access_internal`
 *         keeps its default (tenant access), or the note leaks status placeholders.
 * [RLS-3] Internal notes stay readable after the app replaces `sendo_can_access_internal` to
 *         deny them, or regular messages and the conversation disappear with them.
 * [RLS-4] A conversation or its messages stay readable after the app replaces
 *         `sendo_can_access_conversation` to deny it.
 * [RLS-5] `sendo_set_default_account` leaves two defaults in a tenant (or touches another
 *         tenant), or a browser role can call it.
 * [RLS-6] An anonymous client, or a user of another tenant, can read a tenant's snippets, tags,
 *         conversation tags or rules.
 * [RLS-7] A tenant member cannot read the tenant's team snippets, tags, conversation tags or
 *         rules, or conversation tags stay readable after `sendo_can_access_conversation` denies
 *         their conversation.
 * [RLS-8] A tenant member can read another member's personal snippet.
 * [RLS-9] Personal snippets ignore a replaced `sendo_current_user_id` (apps whose user ids are
 *         not Supabase Auth ids).
 * [RLS-10] A browser role can write the team tables or call the v2 service-role functions
 *          (`sendo_merge_rule_state`, `sendo_escalation_candidates`, `sendo_count_by_source`).
 * [RLS-11] An anonymous client, or a user of another tenant, can read a tenant's broadcasts,
 *          broadcast recipients or metrics view rows; or a tenant member cannot.
 * [RLS-12] A metrics view ignores the reader's RLS (not `security_invoker`): a conversation
 *          denied by `sendo_can_access_conversation` still shows up in
 *          `sendo_metrics_first_response`.
 * [RLS-13] A browser role can write broadcasts or recipients.
 *
 * Needs `pnpm supabase start && pnpm supabase db reset`, with postgres-meta running (hook
 * replacement goes through `/pg/query`). The playground migration's `sendo_can_access_tenant`
 * grants access by `app_metadata.tenant_id`. Replaced hooks only deny this suite's own rows and
 * are restored afterwards, so other suites sharing the database are unaffected.
 * Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (defaults read from
 * `supabase status -o env`). Skips when Supabase is unreachable unless `SENDO_REQUIRE_SUPABASE=1`.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  Broadcast,
  Conversation,
  Message,
  Snippet,
  StoredRule,
  Tag,
} from "../../types/entities";
import type { SendoAdapter } from "../types";
import { supabaseAdapter } from ".";
import { servicesRequired, supabaseAvailable } from "../../../test/support/services";

const guard = await supabaseAvailable({ anonKey: true });
const SUPABASE_URL = guard.url;
const BUCKET = process.env.SENDO_TEST_STORAGE_BUCKET ?? "sendo-media";
const PASSWORD = "sendo-rls-test-password";

const DEFAULT_INTERNAL_HOOK = `
create or replace function public.sendo_can_access_internal(tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.sendo_can_access_tenant(sendo_can_access_internal.tenant_id);
$$;`;
const DEFAULT_CURRENT_USER_HOOK = `
create or replace function public.sendo_current_user_id()
returns text language sql stable security definer set search_path = '' as $$
  select (select auth.uid())::text;
$$;`;
const DEFAULT_CONVERSATION_HOOK = `
create or replace function public.sendo_can_access_conversation(conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select true;
$$;`;

const { unavailable } = guard;
const keys = { service: guard.serviceRoleKey, anon: guard.anonKey };

if (unavailable && servicesRequired) {
  describe("supabase RLS prerequisites", () => {
    it("has a reachable local Supabase with service role and anon keys", () => {
      expect.fail(
        `${unavailable} at ${SUPABASE_URL}. Run \`pnpm supabase start && pnpm supabase db reset\` ` +
          "or set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY.",
      );
    });
  });
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

/** A browser-role client (anon key); signed in, it acts as `authenticated`. */
function browserClient() {
  return createClient(SUPABASE_URL, keys.anon ?? "missing", clientOptions);
}
type BrowserClient = ReturnType<typeof browserClient>;

/** Creates a confirmed user with `app_metadata` and returns a client signed in as them. */
async function signIn(
  admin: BrowserClient,
  appMetadata: Record<string, string>,
  userIds: string[],
): Promise<{ client: BrowserClient; userId: string }> {
  const email = `rls-${crypto.randomUUID()}@sendo.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: appMetadata,
  });
  if (error) throw error;
  userIds.push(data.user.id);
  const client = browserClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
  return { client, userId: data.user.id };
}

/** Runs SQL as `postgres` through postgres-meta (service role only). */
async function sql(query: string): Promise<void> {
  const key = keys.service ?? "";
  const response = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok)
    throw new Error(`pg/query ${String(response.status)}: ${await response.text()}`);
}

describe.skipIf(!guard.available)(
  "supabase RLS: internal notes and conversation hooks",
  { meta: { skipReason: "supabase" } },
  () => {
    const admin = createClient(SUPABASE_URL, keys.service ?? "missing", clientOptions);
    const adapter: SendoAdapter = supabaseAdapter(admin, { storageBucket: BUCKET });
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const accountIds: string[] = [];
    const userIds: string[] = [];
    let member: BrowserClient;
    let outsider: BrowserClient;
    let anon: BrowserClient;
    let conversation: Conversation;
    let regular: Message;
    let note: Message;

    async function signedInUser(tenant: string): Promise<BrowserClient> {
      return (await signIn(admin, { tenant_id: tenant }, userIds)).client;
    }

    async function visible(client: BrowserClient) {
      const [conversations, messages] = await Promise.all([
        client.from("sendo_conversations").select("id").eq("id", conversation.id),
        client.from("sendo_messages").select("id").eq("conversation_id", conversation.id),
      ]);
      if (conversations.error) throw conversations.error;
      if (messages.error) throw messages.error;
      return {
        conversations: conversations.data.map((r: { id: string }) => r.id),
        messages: messages.data.map((r: { id: string }) => r.id).sort(),
      };
    }

    async function seedAccount(tenant: string, isDefault = false) {
      const account = await adapter.accounts.insert({
        tenantId: tenant,
        phoneNumberId: `pn${crypto.randomUUID()}`,
        wabaId: "waba-rls",
        displayPhone: "+502 5555 0000",
        tokenRef: "SENDO_TEST_TOKEN",
        isDefault,
      });
      accountIds.push(account.id);
      return account;
    }

    beforeAll(async () => {
      const account = await seedAccount(tenantId);
      const { contact } = await adapter.contacts.upsert({
        accountId: account.id,
        tenantId,
        phone: "+50255557777",
      });
      ({ conversation } = await adapter.conversations.getOpenOrCreate({
        contactId: contact.id,
        accountId: account.id,
        tenantId,
      }));
      const inbound = await adapter.messages.insertInbound({
        tenantId,
        conversationId: conversation.id,
        type: "text",
        content: { body: "Hola" },
        text: "Hola",
        metaMessageId: `wamid.rls.${crypto.randomUUID()}`,
        sentAt: new Date(),
      });
      if (!inbound) throw new Error("inbound not stored");
      regular = inbound;
      note = await adapter.messages.insertOutbound({
        tenantId,
        conversationId: conversation.id,
        type: "text",
        content: { body: "Paciente VIP, revisar saldo" },
        text: "Paciente VIP, revisar saldo",
        sender: "human",
        senderRef: "user-luis",
        internal: true,
      });
      [member, outsider] = await Promise.all([signedInUser(tenantId), signedInUser(otherTenantId)]);
      anon = browserClient();
    }, 60_000);

    afterAll(async () => {
      await sql(DEFAULT_INTERNAL_HOOK + DEFAULT_CONVERSATION_HOOK);
      if (accountIds.length > 0) await admin.from("sendo_accounts").delete().in("id", accountIds);
      await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
    });

    it("[RLS-1] anonymous clients and other tenants read nothing", async () => {
      expect(await visible(anon)).toEqual({ conversations: [], messages: [] });
      expect(await visible(outsider)).toEqual({ conversations: [], messages: [] });
    });

    it("[RLS-2] tenant members read internal notes by default", async () => {
      expect(await visible(member)).toEqual({
        conversations: [conversation.id],
        messages: [regular.id, note.id].sort(),
      });
      const { data, error } = await member
        .from("sendo_messages")
        .select("id, internal")
        .eq("id", note.id)
        .single();
      expect(error).toBeNull();
      expect(data).toEqual({ id: note.id, internal: true });
    });

    it("[RLS-3] replacing sendo_can_access_internal hides only the notes", async () => {
      await sql(`
      create or replace function public.sendo_can_access_internal(tenant_id uuid)
      returns boolean language sql stable security definer set search_path = '' as $$
        select sendo_can_access_internal.tenant_id is distinct from '${tenantId}'::uuid
          and public.sendo_can_access_tenant(sendo_can_access_internal.tenant_id);
      $$;`);
      try {
        expect(await visible(member)).toEqual({
          conversations: [conversation.id],
          messages: [regular.id],
        });
      } finally {
        await sql(DEFAULT_INTERNAL_HOOK);
      }
      expect((await visible(member)).messages).toContain(note.id);
    });

    it("[RLS-4] replacing sendo_can_access_conversation hides the conversation and its messages", async () => {
      await sql(`
      create or replace function public.sendo_can_access_conversation(conversation_id uuid)
      returns boolean language sql stable security definer set search_path = '' as $$
        select sendo_can_access_conversation.conversation_id <> '${conversation.id}'::uuid;
      $$;`);
      try {
        expect(await visible(member)).toEqual({ conversations: [], messages: [] });
      } finally {
        await sql(DEFAULT_CONVERSATION_HOOK);
      }
      expect((await visible(member)).conversations).toEqual([conversation.id]);
    });

    it("[RLS-5] sendo_set_default_account moves the tenant default atomically, service role only", async () => {
      const first = await seedAccount(otherTenantId, true);
      const second = await seedAccount(otherTenantId);
      const elsewhere = await seedAccount(crypto.randomUUID(), true);

      const moved = await admin.rpc("sendo_set_default_account", { id: second.id });
      expect(moved).toMatchObject({
        error: null,
        data: [expect.objectContaining({ id: second.id, is_default: true })],
      });
      const defaults = await adapter.accounts.list({ tenantId: otherTenantId });
      expect(defaults.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id]);
      expect((await adapter.accounts.getById(first.id))?.isDefault).toBe(false);
      expect((await adapter.accounts.getById(elsewhere.id))?.isDefault).toBe(true);

      const unknown = await admin.rpc("sendo_set_default_account", { id: crypto.randomUUID() });
      expect(unknown).toMatchObject({ error: null, data: [] });

      const denied = await member.rpc("sendo_set_default_account", { id: first.id });
      expect(denied.error).not.toBeNull();
      expect((await adapter.accounts.getById(first.id))?.isDefault).toBe(false);
    });
  },
);

describe.skipIf(!guard.available)(
  "supabase RLS: schema v2 team tables",
  { meta: { skipReason: "supabase" } },
  () => {
    const admin = createClient(SUPABASE_URL, keys.service ?? "missing", clientOptions);
    const adapter: SendoAdapter = supabaseAdapter(admin, { storageBucket: BUCKET });
    const tenantId = crypto.randomUUID();
    const otherTenantId = crypto.randomUUID();
    const accountIds: string[] = [];
    const userIds: string[] = [];
    let ana: { client: BrowserClient; userId: string };
    let luis: { client: BrowserClient; userId: string };
    let outsider: BrowserClient;
    let anon: BrowserClient;
    let conversation: Conversation;
    let teamSnippet: Snippet;
    let anaSnippet: Snippet;
    let appUserSnippet: Snippet;
    let tag: Tag;
    let rule: StoredRule;

    /** Ids each client can read from the four team tables (this suite's rows only). */
    async function readable(client: BrowserClient) {
      const [snippets, tags, conversationTags, rules] = await Promise.all([
        client.from("sendo_snippets").select("id").eq("tenant_id", tenantId),
        client.from("sendo_tags").select("id").eq("tenant_id", tenantId),
        client
          .from("sendo_conversation_tags")
          .select("tag_id")
          .eq("conversation_id", conversation.id),
        client.from("sendo_rules").select("id").eq("tenant_id", tenantId),
      ]);
      for (const r of [snippets, tags, conversationTags, rules]) if (r.error) throw r.error;
      const ids = (rows: { id: string }[] | null) => (rows ?? []).map((r) => r.id).sort();
      return {
        snippets: ids(snippets.data),
        tags: ids(tags.data),
        conversationTags: (conversationTags.data ?? []).map((r: { tag_id: string }) => r.tag_id),
        rules: ids(rules.data),
      };
    }

    beforeAll(async () => {
      const account = await adapter.accounts.insert({
        tenantId,
        phoneNumberId: `pn${crypto.randomUUID()}`,
        wabaId: "waba-rls",
        displayPhone: "+502 5555 0000",
        tokenRef: "SENDO_TEST_TOKEN",
      });
      accountIds.push(account.id);
      const { contact } = await adapter.contacts.upsert({
        accountId: account.id,
        tenantId,
        phone: "+50255558888",
      });
      ({ conversation } = await adapter.conversations.getOpenOrCreate({
        contactId: contact.id,
        accountId: account.id,
        tenantId,
      }));
      [ana, luis] = await Promise.all([
        signIn(admin, { tenant_id: tenantId }, userIds),
        signIn(admin, { tenant_id: tenantId, app_user_id: "app-user-77" }, userIds),
      ]);
      outsider = (await signIn(admin, { tenant_id: otherTenantId }, userIds)).client;
      anon = browserClient();

      teamSnippet = await adapter.snippets.upsert({
        tenantId,
        shortcut: "horario",
        body: "8 a 17",
      });
      anaSnippet = await adapter.snippets.upsert({
        tenantId,
        shortcut: "firma",
        body: "Saludos, Ana",
        visibility: "personal",
        ownerUserId: ana.userId,
      });
      appUserSnippet = await adapter.snippets.upsert({
        tenantId,
        shortcut: "firma",
        body: "Saludos, Luis",
        visibility: "personal",
        ownerUserId: "app-user-77",
      });
      tag = await adapter.tags.upsert({ tenantId, name: "VIP", color: "violet" });
      await adapter.tags.addToConversation(conversation.id, tag.id, { by: ana.userId });
      ({ rule } = await adapter.rules.upsert({
        tenantId,
        key: "cierre-7",
        type: "auto_close",
        params: { afterDays: 7 },
      }));
    }, 60_000);

    afterAll(async () => {
      await sql(DEFAULT_CURRENT_USER_HOOK + DEFAULT_CONVERSATION_HOOK);
      await Promise.all([
        admin.from("sendo_snippets").delete().eq("tenant_id", tenantId),
        admin.from("sendo_tags").delete().eq("tenant_id", tenantId),
        admin.from("sendo_rules").delete().eq("tenant_id", tenantId),
      ]);
      if (accountIds.length > 0) await admin.from("sendo_accounts").delete().in("id", accountIds);
      await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
    });

    it("[RLS-6] anonymous clients and other tenants read none of the team rows", async () => {
      const none = { snippets: [], tags: [], conversationTags: [], rules: [] };
      expect(await readable(anon)).toEqual(none);
      expect(await readable(outsider)).toEqual(none);
    });

    it("[RLS-7] tenant members read team snippets, tags, conversation tags and rules", async () => {
      expect(await readable(luis.client)).toMatchObject({
        tags: [tag.id],
        conversationTags: [tag.id],
        rules: [rule.id],
      });
      expect((await readable(ana.client)).snippets).toContain(teamSnippet.id);

      await sql(`
      create or replace function public.sendo_can_access_conversation(conversation_id uuid)
      returns boolean language sql stable security definer set search_path = '' as $$
        select sendo_can_access_conversation.conversation_id <> '${conversation.id}'::uuid;
      $$;`);
      try {
        expect(await readable(ana.client)).toMatchObject({ tags: [tag.id], conversationTags: [] });
      } finally {
        await sql(DEFAULT_CONVERSATION_HOOK);
      }
    });

    it("[RLS-8] personal snippets are only readable by their owner", async () => {
      expect((await readable(ana.client)).snippets).toEqual([teamSnippet.id, anaSnippet.id].sort());
      expect((await readable(luis.client)).snippets).toEqual([teamSnippet.id]);
    });

    it("[RLS-9] a replaced sendo_current_user_id decides who owns personal snippets", async () => {
      await sql(`
      create or replace function public.sendo_current_user_id()
      returns text language sql stable security definer set search_path = '' as $$
        select (select auth.jwt() -> 'app_metadata' ->> 'app_user_id');
      $$;`);
      try {
        expect((await readable(luis.client)).snippets).toEqual(
          [teamSnippet.id, appUserSnippet.id].sort(),
        );
        expect((await readable(ana.client)).snippets).toEqual([teamSnippet.id]);
      } finally {
        await sql(DEFAULT_CURRENT_USER_HOOK);
      }
      expect((await readable(ana.client)).snippets).toContain(anaSnippet.id);
    });

    it("[RLS-10] browser roles cannot write the team tables or call the v2 functions", async () => {
      const member = ana.client;
      const insertTag = await member
        .from("sendo_tags")
        .insert({ tenant_id: tenantId, name: "Intruso", color: "red" });
      expect(insertTag.error).not.toBeNull();
      // Without write policies, updates and deletes match no rows (or fail).
      const changed = await Promise.all([
        member
          .from("sendo_snippets")
          .update({ body: "hackeado" })
          .eq("id", teamSnippet.id)
          .select(),
        member.from("sendo_rules").delete().eq("id", rule.id).select(),
        member.from("sendo_conversation_tags").delete().eq("tag_id", tag.id).select(),
      ]);
      for (const result of changed) {
        const rows: unknown[] | null = result.data;
        expect(result.error !== null || rows === null || rows.length === 0).toBe(true);
      }
      expect(await adapter.snippets.get(teamSnippet.id)).toMatchObject({ body: "8 a 17" });
      expect(await adapter.rules.get(rule.id)).not.toBeNull();
      expect(await adapter.tags.usage(tag.id)).toBe(1);
      expect((await adapter.tags.list({ tenantId })).map((t) => t.name)).toEqual(["VIP"]);

      const calls = await Promise.all([
        member.rpc("sendo_merge_rule_state", { rule_id: rule.id, patch: { cursor: 9 } }),
        member.rpc("sendo_escalation_candidates", {
          tenant_id: tenantId,
          waiting_since: new Date().toISOString(),
          max_rows: 10,
        }),
        member.rpc("sendo_count_by_source", { tenant_id: tenantId }),
        anon.rpc("sendo_count_by_source", { tenant_id: tenantId }),
      ]);
      for (const call of calls) expect(call.error).not.toBeNull();
      expect((await adapter.rules.get(rule.id))?.state).toEqual({});
    });
  },
);

describe.skipIf(!guard.available)(
  "supabase RLS: schema v3 broadcasts and metrics views",
  { meta: { skipReason: "supabase" } },
  () => {
    const admin = createClient(SUPABASE_URL, keys.service ?? "missing", clientOptions);
    const adapter: SendoAdapter = supabaseAdapter(admin, { storageBucket: BUCKET });
    const tenantId = crypto.randomUUID();
    const accountIds: string[] = [];
    const userIds: string[] = [];
    let member: BrowserClient;
    let outsider: BrowserClient;
    let anon: BrowserClient;
    let conversation: Conversation;
    let broadcast: Broadcast;

    /** This suite's rows each client can read from the v3 tables and two of the views. */
    async function readable(client: BrowserClient) {
      const [broadcasts, recipients, daily, firstResponse] = await Promise.all([
        client.from("sendo_broadcasts").select("id").eq("tenant_id", tenantId),
        client.from("sendo_broadcast_recipients").select("id").eq("broadcast_id", broadcast.id),
        client.from("sendo_metrics_daily").select("inbound").eq("tenant_id", tenantId),
        client
          .from("sendo_metrics_first_response")
          .select("conversation_id")
          .eq("tenant_id", tenantId),
      ]);
      for (const r of [broadcasts, recipients, daily, firstResponse]) if (r.error) throw r.error;
      return {
        broadcasts: (broadcasts.data ?? []).length,
        recipients: (recipients.data ?? []).length,
        dailyInbound: (daily.data ?? []).reduce(
          (total: number, r: { inbound: number }) => total + r.inbound,
          0,
        ),
        firstResponse: (firstResponse.data ?? []).map(
          (r: { conversation_id: string }) => r.conversation_id,
        ),
      };
    }

    beforeAll(async () => {
      const account = await adapter.accounts.insert({
        tenantId,
        phoneNumberId: `pn${crypto.randomUUID()}`,
        wabaId: "waba-rls",
        displayPhone: "+502 5555 0000",
        tokenRef: "SENDO_TEST_TOKEN",
      });
      accountIds.push(account.id);
      const { contact } = await adapter.contacts.upsert({
        accountId: account.id,
        tenantId,
        phone: "+50255559999",
      });
      ({ conversation } = await adapter.conversations.getOpenOrCreate({
        contactId: contact.id,
        accountId: account.id,
        tenantId,
      }));
      await adapter.messages.insertInbound({
        tenantId,
        conversationId: conversation.id,
        type: "text",
        content: { body: "Hola" },
        text: "Hola",
        metaMessageId: `wamid.rls.${crypto.randomUUID()}`,
        sentAt: new Date(),
      });
      broadcast = await adapter.broadcasts.insert({
        tenantId,
        accountId: account.id,
        templateName: "aviso",
        language: "es",
        category: "UTILITY",
      });
      await adapter.broadcasts.insertRecipients(broadcast.id, [{ contactId: contact.id }]);
      member = (await signIn(admin, { tenant_id: tenantId }, userIds)).client;
      outsider = (await signIn(admin, { tenant_id: crypto.randomUUID() }, userIds)).client;
      anon = browserClient();
    }, 60_000);

    afterAll(async () => {
      await sql(DEFAULT_CONVERSATION_HOOK);
      if (accountIds.length > 0) await admin.from("sendo_accounts").delete().in("id", accountIds);
      await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)));
    });

    it("[RLS-11] only tenant members read broadcasts, recipients and metrics rows", async () => {
      const none = { broadcasts: 0, recipients: 0, dailyInbound: 0, firstResponse: [] };
      expect(await readable(anon)).toEqual(none);
      expect(await readable(outsider)).toEqual(none);
      expect(await readable(member)).toEqual({
        broadcasts: 1,
        recipients: 1,
        dailyInbound: 1,
        firstResponse: [conversation.id],
      });
    });

    it("[RLS-12] metrics views apply the reader's RLS hooks (security_invoker)", async () => {
      await sql(`
      create or replace function public.sendo_can_access_conversation(conversation_id uuid)
      returns boolean language sql stable security definer set search_path = '' as $$
        select sendo_can_access_conversation.conversation_id <> '${conversation.id}'::uuid;
      $$;`);
      try {
        expect(await readable(member)).toMatchObject({ dailyInbound: 0, firstResponse: [] });
        const service = await admin
          .from("sendo_metrics_first_response")
          .select("conversation_id")
          .eq("conversation_id", conversation.id);
        expect(service.data).toEqual([{ conversation_id: conversation.id }]);
      } finally {
        await sql(DEFAULT_CONVERSATION_HOOK);
      }
      expect((await readable(member)).firstResponse).toEqual([conversation.id]);
    });

    it("[RLS-13] browser roles cannot write broadcasts or recipients", async () => {
      const insert = await member.from("sendo_broadcasts").insert({
        tenant_id: tenantId,
        account_id: accountIds[0],
        template_name: "intruso",
        language: "es",
        category: "MARKETING",
      });
      expect(insert.error).not.toBeNull();
      const changed = await Promise.all([
        member
          .from("sendo_broadcasts")
          .update({ status: "cancelled" })
          .eq("id", broadcast.id)
          .select(),
        member
          .from("sendo_broadcast_recipients")
          .update({ status: "sent" })
          .eq("broadcast_id", broadcast.id)
          .select(),
        member
          .from("sendo_broadcast_recipients")
          .delete()
          .eq("broadcast_id", broadcast.id)
          .select(),
      ]);
      for (const result of changed) {
        const rows: unknown[] | null = result.data;
        expect(result.error !== null || rows === null || rows.length === 0).toBe(true);
      }
      expect(await adapter.broadcasts.get(broadcast.id)).toMatchObject({ status: "queued" });
      expect(await adapter.broadcasts.counts(broadcast.id)).toMatchObject({ pending: 1, sent: 0 });
    });
  },
);
