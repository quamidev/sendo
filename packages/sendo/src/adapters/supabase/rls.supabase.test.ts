/**
 * RLS for internal notes and per-conversation reads (AC-CH-2), and the default-account RPC,
 * against a local Supabase with real `authenticated` users (signed in through GoTrue).
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
 *
 * Needs `pnpm supabase start && pnpm supabase db reset`, with postgres-meta running (hook
 * replacement goes through `/pg/query`). The playground migration's `sendo_can_access_tenant`
 * grants access by `app_metadata.tenant_id`. Replaced hooks only deny this suite's own rows and
 * are restored afterwards, so other suites sharing the database are unaffected.
 * Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (defaults read from
 * `supabase status -o env`). Skips when Supabase is unreachable unless `SENDO_REQUIRE_SUPABASE=1`.
 */
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Conversation, Message } from "../../types/entities";
import type { SendoAdapter } from "../types";
import { supabaseAdapter } from ".";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "http://127.0.0.1:55321").replace(/\/+$/, "");
const BUCKET = process.env.SENDO_TEST_STORAGE_BUCKET ?? "sendo-media";
const REQUIRED = process.env.SENDO_REQUIRE_SUPABASE === "1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const PASSWORD = "sendo-rls-test-password";

const DEFAULT_INTERNAL_HOOK = `
create or replace function public.sendo_can_access_internal(tenant_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.sendo_can_access_tenant(sendo_can_access_internal.tenant_id);
$$;`;
const DEFAULT_CONVERSATION_HOOK = `
create or replace function public.sendo_can_access_conversation(conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select true;
$$;`;

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function readKeys(): Promise<{ service: string | null; anon: string | null }> {
  let service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  let anon = process.env.SUPABASE_ANON_KEY ?? null;
  if (service && anon) return { service, anon };
  try {
    const { stdout } = await promisify(execFile)(
      "npx",
      ["pnpm@10.34.6", "supabase", "status", "-o", "env"],
      { cwd: REPO_ROOT, timeout: 20_000 },
    );
    const read = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(stdout)?.[1];
    service ??= read("SERVICE_ROLE_KEY") ?? read("SECRET_KEY") ?? null;
    anon ??= read("ANON_KEY") ?? read("PUBLISHABLE_KEY") ?? null;
  } catch {
    // reported as unavailable below
  }
  return { service, anon };
}

const reachable = await isReachable(SUPABASE_URL);
const keys = reachable ? await readKeys() : { service: null, anon: null };
const unavailable = !reachable
  ? "Supabase unreachable"
  : !keys.service || !keys.anon
    ? "SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY not found"
    : null;

if (unavailable && REQUIRED) {
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

describe.skipIf(unavailable !== null)("supabase RLS: internal notes and conversation hooks", () => {
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
    const email = `rls-${crypto.randomUUID()}@sendo.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { tenant_id: tenant },
    });
    if (error) throw error;
    userIds.push(data.user.id);
    const client = browserClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    if (signInError) throw signInError;
    return client;
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
});
