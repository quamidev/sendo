/**
 * Cross-flow scenarios (SND-6.1), one per product-spec user flow, written once and run on two
 * adapters: `flows.test.ts` (memory) and `flows.supabase.test.ts` (local Supabase, under
 * `pnpm test:supabase`). Everything goes through real entry points: signed webhooks into
 * `sendo.handleWebhook`, the public `sendo.*` API, `runCli` for `doctor` and `rules sync`,
 * `sendo.maintenance.tick()`, msw for Meta and a scripted model. Assertions read state back
 * through the public API or the adapter interface only (never memory internals), and every
 * scenario uses its own tenant and phone number ids, so the Supabase run can share a database.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import type { setupServer } from "msw/node";
import { expect } from "vitest";
import type { SendoAdapter } from "../../src/adapters/types";
import { scriptedModel, textResult, transcript } from "../../src/agents/test-helpers";
import type { AgentDefinition } from "../../src/agents/types";
import { runCli } from "../../src/cli/main";
import type { CheckResult } from "../../src/cli/doctor";
import {
  SENTINEL_TOKEN,
  WEBHOOK_URL as CLI_WEBHOOK_URL,
  doctorEnv,
  graphHandlers,
} from "../../src/cli/test-helpers";
import type { StoreTokenInput } from "../../src/core/accounts";
import type { MetaDirectShorthandConfig } from "../../src/core/config";
import { getContext } from "../../src/core/context";
import { createSendo } from "../../src/core/create-sendo";
import { GRAPH, captureLogger } from "../../src/core/test-utils";
import type { TeamUser } from "../../src/team/config";
import type { Role } from "../../src/team/permissions";
import type { Account } from "../../src/types/entities";
import { signedPost } from "./harness";

export interface FlowEnv {
  kind: "memory" | "supabase";
  server: ReturnType<typeof setupServer>;
  /** A fresh memory adapter, or the shared Supabase one. */
  adapter: () => SendoAdapter;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Unique ids per scenario so runs never collide in a shared database. */
function ids(flow: string) {
  const run = randomUUID().slice(0, 8);
  const digits = () => `9${String(Date.now()).slice(-8)}${String(Math.random()).slice(2, 8)}`;
  return {
    run,
    // Supabase tenant ids are uuids; `flow` only names the scenario in failures.
    tenantId: randomUUID(),
    flow,
    phoneNumberId: digits(),
    wabaId: digits(),
  };
}

type FlowIds = ReturnType<typeof ids>;

/* ------------------------------------------------------------------ webhook bodies */

function change(phoneNumberId: string, value: Record<string, unknown>): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  });
}

function textBody(
  phoneNumberId: string,
  m: { id: string; from: string; body: string; name?: string },
): string {
  return change(phoneNumberId, {
    contacts: [{ profile: { name: m.name ?? "Contacto" }, wa_id: m.from }],
    messages: [
      {
        from: m.from,
        id: m.id,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: m.body },
      },
    ],
  });
}

function statusBody(
  phoneNumberId: string,
  metaId: string,
  status: "sent" | "delivered" | "read",
  to: string,
): string {
  return change(phoneNumberId, {
    statuses: [
      { id: metaId, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: to },
    ],
  });
}

/* ------------------------------------------------------------------ client and Meta */

type ClientConfig = Partial<Omit<MetaDirectShorthandConfig, "adapter">>;

interface Directory {
  [userId: string]: { role: Role; queues?: string[]; name: string };
}

/** `createSendo` on `adapter` with the flow's tenant directory; every webhook is signed. */
function client(adapter: SendoAdapter, f: FlowIds, config: ClientConfig = {}, team?: Directory) {
  const { logs, logger } = captureLogger();
  const sendo = createSendo({
    adapter,
    appSecret: "app-secret-value",
    verifyToken: "verify-token-value",
    resolveToken: () => `token-${f.run}`,
    logger,
    handoffMessage: null,
    ...(team && {
      resolveRole: ({ userId, tenantId }) => {
        const entry = tenantId === f.tenantId ? team[userId] : undefined;
        return Promise.resolve(entry ? { role: entry.role, queues: entry.queues ?? [] } : null);
      },
      resolveUsers: (userIds: string[]) =>
        Promise.resolve(
          userIds.flatMap((id): TeamUser[] => {
            const entry = team[id];
            return entry ? [{ id, name: entry.name }] : [];
          }),
        ),
      resolveAssignees: () =>
        Promise.resolve(Object.keys(team).filter((id) => team[id]?.role === "agent")),
    }),
    ...config,
  });
  /** Posts a signed body and waits for the background work. */
  async function deliver(body: string): Promise<number> {
    const tasks: Promise<unknown>[] = [];
    const response = await sendo.handleWebhook(signedPost(body), {
      waitUntil: (p) => tasks.push(p),
    });
    await Promise.all(tasks);
    return response.status;
  }
  return { sendo, logs, deliver, ctx: getContext(sendo) };
}

interface MetaSend {
  to: string;
  type: string;
  text?: string;
  template?: string;
}

/** Meta's /messages: unique wamids per run; `failNext(code)` fails the next send once. */
function metaSends(env: FlowEnv, f: FlowIds) {
  const sends: MetaSend[] = [];
  const failures: number[] = [];
  let n = 0;
  let last = "";
  env.server.use(
    http.post(`${GRAPH}/:phoneNumberId/messages`, async ({ request, params }) => {
      const body = (await request.json()) as {
        to?: string;
        type?: string;
        status?: string;
        text?: { body?: string };
        template?: { name?: string };
      };
      if (body.status === "read") return HttpResponse.json({ success: true });
      n++;
      const id = `wamid.FLOW.${f.run}.${String(n)}`;
      // On a shared database a tick may also send for other suites' numbers: answer them, but
      // only this scenario's number is recorded (and can be failed on purpose).
      if (params.phoneNumberId !== f.phoneNumberId)
        return HttpResponse.json({ messages: [{ id }] });
      const code = failures.shift();
      if (code !== undefined) {
        return HttpResponse.json(
          { error: { code, message: "Meta says no", type: "OAuthException", fbtrace_id: "TR" } },
          { status: 400 },
        );
      }
      sends.push({
        to: body.to ?? "",
        type: body.type ?? "",
        ...(body.text?.body !== undefined && { text: body.text.body }),
        ...(body.template?.name !== undefined && { template: body.template.name }),
      });
      last = id;
      return HttpResponse.json({ messages: [{ id }] });
    }),
  );
  return {
    sends,
    failNext: (code: number) => void failures.push(code),
    /** Meta id of the last recorded send of this scenario's number. */
    lastId: () => last,
  };
}

/** Graph reads the tick and doctor may make for any number: billing ready, phone healthy. */
function graphReads(env: FlowEnv) {
  env.server.use(
    http.get(`${GRAPH}/:id`, ({ params, request }) => {
      const fields = new URL(request.url).searchParams.get("fields") ?? "";
      if (fields === "primary_funding_id") {
        return HttpResponse.json({ id: params.id, primary_funding_id: "987654321" });
      }
      return HttpResponse.json({
        id: params.id,
        display_phone_number: "+1 555-000-1111",
        verified_name: "Clínica Demo",
        quality_rating: "GREEN",
        code_verification_status: "VERIFIED",
      });
    }),
  );
}

async function addAccount(adapter: SendoAdapter, f: FlowIds, tokenRef = "SENDO_TOKEN_MAIN") {
  return adapter.accounts.insert({
    tenantId: f.tenantId,
    phoneNumberId: f.phoneNumberId,
    wabaId: f.wabaId,
    displayPhone: "+1 555-000-1111",
    tokenRef,
  });
}

async function conversationOf(adapter: SendoAdapter, account: Account, waId: string) {
  const page = await adapter.conversations.list({
    tenantId: account.tenantId,
    accountId: account.id,
    limit: 50,
  });
  const match = page.items.find((c) => c.contact.waId === waId);
  if (!match) throw new Error(`no conversation for ${waId}`);
  return match;
}

/** Removes what a scenario stored: its numbers (cascading to everything) and its rules. */
export async function purgeTenant(adapter: SendoAdapter, tenantId: string): Promise<void> {
  for (const account of await adapter.accounts.list({ tenantId })) {
    if (account.active) await adapter.accounts.update(account.id, { active: false });
    await adapter.accounts.purge(account.id);
  }
  for (const rule of await adapter.rules.list({ tenantId })) await adapter.rules.delete(rule.id);
  for (const tag of await adapter.tags.list({ tenantId })) await adapter.tags.delete(tag.id);
}

/* ===================================================================== Flow A */

/**
 * Flow A (quickstart): `accounts.add` → `sendo doctor` all green → an inbound message gets the
 * agent's answer → the status ticks reach "read".
 */
export async function flowA(env: FlowEnv): Promise<void> {
  const f = ids("a");
  const adapter = env.adapter();
  const meta = metaSends(env, f);
  env.server.use(...[graphHandlers.subscribed(), graphHandlers.templatesOk()]);
  env.server.use(graphHandlers.webhookEcho());
  graphReads(env);
  const c = client(adapter, f, { resolveToken: () => SENTINEL_TOKEN });
  try {
    const model = scriptedModel(textResult("¡Hola! Soy la recepción, ¿en qué te ayudo?"));
    c.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });
    const account = await c.sendo.accounts.add({
      tenantId: f.tenantId,
      phoneNumberId: f.phoneNumberId,
      wabaId: f.wabaId,
      displayPhone: "+1 555-000-1111",
      tokenRef: "SENDO_TOKEN_MAIN",
    });
    expect(account).toMatchObject({ isDefault: true, active: true, onboardedVia: "manual" });

    const out: string[] = [];
    const code = await runCli(
      ["doctor", "--account", f.phoneNumberId, "--url", CLI_WEBHOOK_URL, "--json"],
      {
        env: doctorEnv(),
        cwd: "/app",
        stdout: (t) => out.push(t),
        stderr: () => undefined,
        readFile: () => null,
        createAdapter: () => Promise.resolve(adapter),
        version: "0.0.0",
      },
    );
    const results = JSON.parse(out.join("")) as CheckResult[];
    const failing = results.filter((r) => !r.ok && !r.warning);
    expect(failing, JSON.stringify(failing)).toEqual([]);
    expect(code).toBe(0);
    expect(results.map((r) => r.id)).toEqual(
      expect.arrayContaining([`account:${f.phoneNumberId}:phone`]),
    );

    const from = "50255550101";
    expect(
      await c.deliver(textBody(f.phoneNumberId, { id: `wamid.IN.${f.run}.1`, from, body: "Hola" })),
    ).toBe(200);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(meta.sends).toEqual([
      { to: `+${from}`, type: "text", text: "¡Hola! Soy la recepción, ¿en qué te ayudo?" },
    ]);
    const replyId = meta.lastId();
    for (const status of ["sent", "delivered", "read"] as const) {
      expect(await c.deliver(statusBody(f.phoneNumberId, replyId, status, from))).toBe(200);
    }
    expect(await adapter.messages.getByMetaId(replyId)).toMatchObject({
      direction: "out",
      sender: "agent",
      status: "read",
    });
  } finally {
    await purgeTenant(adapter, f.tenantId);
  }
}

/* ===================================================================== Flow B */

/**
 * Flow B (Embedded Signup): the first number of a tenant becomes its default; Meta doesn't say
 * whether it can pay (billing unknown); the first send failing with 131042 resolves it to
 * "no payment method"; "Ya lo agregué, verificar" (`refreshBilling`) clears it once Meta has it.
 */
export async function flowB(env: FlowEnv): Promise<void> {
  const f = ids("b");
  const adapter = env.adapter();
  const code = `AQD-flow-b-${f.run}`;
  const token = `EAAB-flow-b-${f.run}`;
  let funding: "error" | "present" = "error";
  env.server.use(
    http.get(`${GRAPH}/oauth/access_token`, () =>
      HttpResponse.json({ access_token: token, token_type: "bearer" }),
    ),
    http.post(`${GRAPH}/:waba/subscribed_apps`, () => HttpResponse.json({ success: true })),
    http.delete(`${GRAPH}/:waba/subscribed_apps`, () => HttpResponse.json({ success: true })),
    http.post(`${GRAPH}/:phone/register`, () => HttpResponse.json({ success: true })),
    http.get(`${GRAPH}/:id`, ({ params, request }) => {
      const fields = new URL(request.url).searchParams.get("fields") ?? "";
      if (fields !== "primary_funding_id") {
        return HttpResponse.json({ id: params.id, display_phone_number: "+502 5555 0077" });
      }
      return funding === "present"
        ? HttpResponse.json({ id: params.id, primary_funding_id: "987654321" })
        : HttpResponse.json(
            {
              error: {
                code: 2,
                message: "Service temporarily unavailable",
                type: "OAuthException",
              },
            },
            { status: 500 },
          );
    }),
  );
  const meta = metaSends(env, f);
  const tokens = new Map<string, string>();
  const c = client(adapter, f, {
    meta: { appId: "1234567890" },
    storeToken: (input: StoreTokenInput) => {
      const ref = `vault:${input.account.phoneNumberId ?? ""}`;
      tokens.set(ref, input.token);
      return Promise.resolve(ref);
    },
    deleteToken: (ref: string) => {
      tokens.delete(ref);
      return Promise.resolve();
    },
    resolveToken: (account) => tokens.get(account.tokenRef),
  });
  const defaults: unknown[] = [];
  const billing: { billingReady: boolean | null; previous: boolean | null }[] = [];
  c.sendo.on("account.default", (e) => void defaults.push(e.account?.id));
  c.sendo.on(
    "account.billing",
    (e) => void billing.push({ billingReady: e.billingReady, previous: e.previous }),
  );
  try {
    const account = await c.sendo.accounts.completeEmbeddedSignup({
      code,
      tenantId: f.tenantId,
      wabaId: f.wabaId,
      phoneNumberId: f.phoneNumberId,
    });
    expect(account).toMatchObject({
      tenantId: f.tenantId,
      onboardedVia: "embedded_signup",
      isDefault: true,
      billingReady: null,
      tokenRef: `vault:${f.phoneNumberId}`,
    });
    expect(account.billingCheckedAt).toBeInstanceOf(Date);
    expect(defaults).toEqual([account.id]);
    expect(tokens.get(account.tokenRef)).toBe(token);

    const from = "50255550201";
    await c.deliver(textBody(f.phoneNumberId, { id: `wamid.IN.${f.run}.1`, from, body: "Hola" }));
    meta.failNext(131042);
    await expect(
      c.sendo.send.text(`+${from}`, "Bienvenido", { tenant: f.tenantId }),
    ).rejects.toMatchObject({
      code: "META_API_ERROR",
      hint: "billing_not_ready",
    });
    expect(await c.sendo.accounts.get(account.id)).toMatchObject({ billingReady: false });
    expect(billing).toEqual([{ billingReady: false, previous: null }]);

    funding = "present";
    expect(await c.sendo.accounts.refreshBilling(account.id)).toMatchObject({ billingReady: true });
    await c.sendo.send.text(`+${from}`, "Bienvenido", { tenant: f.tenantId });
    expect(meta.sends.map((s) => s.text)).toEqual(["Bienvenido"]);
    expect(billing.at(-1)).toEqual({ billingReady: true, previous: false });
    expect(JSON.stringify(await adapter.accounts.list({ tenantId: f.tenantId }))).not.toContain(
      token,
    );
  } finally {
    await purgeTenant(adapter, f.tenantId);
  }
}

/* ================================================================== Flow D/E */

const TEAM: Directory = {
  ana: { role: "agent", queues: ["cobranza"], name: "Ana López" },
  beto: { role: "agent", queues: ["cobranza"], name: "Beto Ruiz" },
  sofia: { role: "supervisor", name: "Sofía Ruiz" },
  alma: { role: "admin", name: "Alma Díaz" },
};

/**
 * Flow D/E (a team day): a route rule sends "factura" to the cobranza queue and a person;
 * auto-assign gives it to Ana; on another chat the agent proposes drafts: Ana steps in (the
 * draft is discarded and the AI keeps the chat), leaves a note the AI never sees, approves an
 * edited draft; Sofía pauses the AI, a message arrives, she resumes and the AI doesn't catch up.
 */
export async function flowDE(env: FlowEnv): Promise<void> {
  const f = ids("de");
  const adapter = env.adapter();
  const meta = metaSends(env, f);
  const c = client(adapter, f, {}, TEAM);
  const model = scriptedModel(
    textResult("Hola, ¿en qué te ayudo?"),
    textResult("Abrimos de 8 a 17."),
    textResult("¡Con gusto!"),
  );
  const agent: AgentDefinition = {
    name: "recepcion",
    model,
    instructions: "Recepción.",
    mode: "draft",
  };
  c.sendo.agent(agent);
  try {
    const account = await addAccount(adapter, f);
    const [ana, sofia, alma] = await Promise.all(
      ["ana", "sofia", "alma"].map((id) => c.sendo.actor(id, f.tenantId)),
    );
    if (!ana || !sofia || !alma) throw new Error("actors");
    await c.sendo.rules.upsert(
      {
        key: "cobranza",
        type: "route",
        params: {
          match: { keywords: ["factura"] },
          action: { queue: "cobranza", to: "human", reason: "Pregunta por su factura" },
        },
      },
      { actor: alma },
    );
    await c.sendo.rules.upsert(
      { key: "turno", type: "auto_assign", params: { queue: "cobranza", strategy: "round_robin" } },
      { actor: alma },
    );

    // 1. Routing and auto-assign.
    const billingFrom = "50255550301";
    await c.deliver(
      textBody(f.phoneNumberId, {
        id: `wamid.IN.${f.run}.1`,
        from: billingFrom,
        body: "Tengo una duda con mi FÁCTURA",
      }),
    );
    const billingChat = await conversationOf(adapter, account, billingFrom);
    const routed = await c.sendo.inbox.get(billingChat.id, { actor: ana });
    expect(routed).toMatchObject({
      status: "human",
      queue: "cobranza",
      assignedTo: "ana",
      assignee: { id: "ana", name: "Ana López" },
      handoff: { reason: "Pregunta por su factura", by: "rule:cobranza" },
    });
    expect(model.doGenerateCalls).toHaveLength(0);
    const lines = (await c.sendo.inbox.thread(billingChat.id, { actor: ana })).items
      .filter((m) => m.systemLine !== null)
      .map((m) => [m.systemLine?.kind, m.systemLine?.by, m.text]);
    // The handoff alone can't pick between Ana and Beto; the auto_assign rule does.
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        ["rule", "rule:cobranza", "Handed to a person by rule «cobranza» (queue «cobranza»)"],
        ["rule", "rule:turno", "Assigned to Ana López by rule «turno»"],
      ]),
    );

    // 2. Draft mode on another chat; Ana steps in.
    const from = "50255550302";
    let seq = 1;
    const say = (body: string) =>
      c.deliver(
        textBody(f.phoneNumberId, { id: `wamid.IN.${f.run}.${String(++seq)}`, from, body }),
      );
    await say("Hola");
    const chat = await conversationOf(adapter, account, from);
    expect((await c.sendo.inbox.get(chat.id, { actor: ana })).hasPendingDraft).toBe(true);
    expect(meta.sends).toEqual([]);

    const stepIn = await c.sendo.inbox.reply(
      chat.id,
      { kind: "text", body: "Soy Ana, del equipo." },
      { actor: ana },
    );
    expect(stepIn).toMatchObject({ sender: "human", senderRef: "ana", status: "sent" });
    expect(await c.sendo.inbox.get(chat.id, { actor: ana })).toMatchObject({
      status: "agent",
      assignedTo: null,
      hasPendingDraft: false,
    });

    // 3. A note: stored, never sent, never in the model's prompt.
    await c.sendo.inbox.note(chat.id, "Cliente VIP, nota interna", { actor: ana });
    expect(meta.sends.map((s) => s.text)).toEqual(["Soy Ana, del equipo."]);

    // 4. The next turn proposes a draft; Ana approves it edited.
    await say("¿A qué hora abren?");
    expect(model.doGenerateCalls).toHaveLength(2);
    const prompt = transcript(model, 1).join("\n");
    expect(prompt).toContain("[operator] Soy Ana, del equipo.");
    expect(prompt).not.toContain("Cliente VIP");
    const draft = (await c.sendo.inbox.thread(chat.id, { actor: ana })).items.find((m) => m.draft);
    expect(draft).toMatchObject({ sender: "agent", text: "Abrimos de 8 a 17." });
    const approved = await c.sendo.inbox.approveDraft(draft?.id ?? "", {
      actor: ana,
      text: "Abrimos de 8:00 a 17:00, ¡te esperamos!",
    });
    expect(approved).toMatchObject({
      sender: "agent",
      approvedBy: "ana",
      edited: true,
      draft: false,
    });
    expect(meta.sends.at(-1)?.text).toBe("Abrimos de 8:00 a 17:00, ¡te esperamos!");

    // 5. Pause and resume without catch-up.
    await expect(c.sendo.inbox.pauseAgent(chat.id, true, { actor: ana })).rejects.toMatchObject({
      code: "FORBIDDEN",
      capability: "conversations.pause_agent",
    });
    await c.sendo.inbox.pauseAgent(chat.id, true, { actor: sofia });
    await say("¿Siguen ahí?");
    expect(model.doGenerateCalls).toHaveLength(2);
    const paused = (await c.sendo.inbox.thread(chat.id, { actor: sofia })).items;
    const waiting = paused.find((m) => m.direction === "in" && m.text === "¿Siguen ahí?");
    const resumed = await c.sendo.inbox.pauseAgent(chat.id, false, { actor: sofia });
    expect(resumed).toMatchObject({ agentPaused: false });
    // A dispatch for the message that arrived during the pause, run after the resume.
    const stored = waiting ? await adapter.messages.get(waiting.id) : null;
    const conversation = await adapter.conversations.get(chat.id);
    const contact = conversation ? await adapter.contacts.get(conversation.contactId) : null;
    if (!stored || !conversation || !contact) throw new Error("missing rows");
    await c.ctx.agentDispatcher?.handleInbound({ account, contact, conversation, message: stored });
    expect(model.doGenerateCalls).toHaveLength(2);

    await say("Gracias");
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(transcript(model, 2).at(-1)).toBe("user: Gracias");
    expect((await c.sendo.inbox.get(chat.id, { actor: ana })).hasPendingDraft).toBe(true);
  } finally {
    await purgeTenant(adapter, f.tenantId);
  }
}

/* ===================================================================== Flow F */

/**
 * Flow F (rules): `sendo rules sync` stores the code rules; a conversation handed to a person
 * waits; the tick escalates it once `afterMinutes` pass (and never twice for the same wait).
 */
export async function flowF(env: FlowEnv): Promise<void> {
  const f = ids("f");
  const adapter = env.adapter();
  metaSends(env, f);
  graphReads(env);
  const c = client(adapter, f, {}, TEAM);
  const dir = mkdtempSync(join(tmpdir(), "sendo-flow-f-"));
  try {
    const account = await addAccount(adapter, f);
    writeFileSync(
      join(dir, "sendo-rules.ts"),
      [
        "export const rules = [",
        '  { key: "sin-respuesta", type: "escalate", params: { afterMinutes: 15, action: "notify" } },',
        '  { key: "cierre", type: "auto_close", params: { afterDays: 30 } },',
        "];",
      ].join("\n"),
    );
    const out: string[] = [];
    const sync = await runCli(
      ["rules", "sync", "--config", "sendo-rules.ts", "--tenant", f.tenantId],
      {
        env: {},
        cwd: dir,
        stdout: (t) => out.push(t),
        stderr: (t) => out.push(t),
        readFile: () => null,
        createAdapter: () => Promise.resolve(adapter),
      },
    );
    expect(sync, out.join("")).toBe(0);
    const alma = await c.sendo.actor("alma", f.tenantId);
    const rules = await c.sendo.rules.list({ actor: alma });
    expect(rules.map((r) => [r.key, r.origin, r.active, r.valid])).toEqual([
      ["sin-respuesta", "code", true, true],
      ["cierre", "code", true, true],
    ]);

    const escalations: { conversation: string; rule: string; minutes: number }[] = [];
    c.sendo.on("escalation", (e) => {
      if (e.conversation.tenantId === f.tenantId) {
        escalations.push({
          conversation: e.conversation.id,
          rule: e.rule.key,
          minutes: e.minutesWaiting,
        });
      }
    });
    const from = "50255550401";
    await c.deliver(
      textBody(f.phoneNumberId, { id: `wamid.IN.${f.run}.1`, from, body: "Necesito ayuda" }),
    );
    const chat = await conversationOf(adapter, account, from);
    await c.sendo.conversations.handoff(chat.id, { reason: "Pide una persona" });
    const waitingSince = (await c.sendo.conversations.get(chat.id))?.awaitingReplySince;
    expect(waitingSince).toBeInstanceOf(Date);
    const at = (minutes: number) => new Date((waitingSince?.getTime() ?? 0) + minutes * MINUTE);

    const early = await c.sendo.maintenance.tick({ now: at(10) });
    expect(early.skipped).toBe(false);
    expect(escalations).toEqual([]);
    const due = await c.sendo.maintenance.tick({ now: at(16) });
    expect(due.steps.escalations.ran).toBe(true);
    expect(escalations).toEqual([{ conversation: chat.id, rule: "sin-respuesta", minutes: 16 }]);
    await c.sendo.maintenance.tick({ now: at(40) });
    expect(escalations).toHaveLength(1);
    expect((await c.sendo.conversations.get(chat.id))?.escalatedAt).toBeInstanceOf(Date);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await purgeTenant(adapter, f.tenantId);
  }
}

/* ===================================================================== Flow G */

/**
 * Flow G (link and QR): `links.create` → the contact sends the prefilled text → the conversation
 * is attributed to the source, the agent reads the text without the code → metrics by source.
 */
export async function flowG(env: FlowEnv): Promise<void> {
  const f = ids("g");
  const adapter = env.adapter();
  metaSends(env, f);
  const c = client(adapter, f, {}, TEAM);
  const model = scriptedModel(textResult("¡Bienvenido!"), textResult("¡Hola!"));
  c.sendo.agent({ name: "recepcion", model, instructions: "Recepción." });
  try {
    await addAccount(adapter, f);
    const link = await c.sendo.links.create({
      tenant: f.tenantId,
      text: "Hola, vengo de la garita",
      source: "garita",
    });
    expect(link).toMatchObject({ code: "[#garita]", text: "Hola, vengo de la garita [#garita]" });
    const url = new URL(link.url);
    expect(url.hostname).toBe("wa.me");
    expect(url.searchParams.get("text")).toBe(link.text);

    await c.deliver(
      textBody(f.phoneNumberId, {
        id: `wamid.IN.${f.run}.1`,
        from: "50255550501",
        body: link.text,
      }),
    );
    await c.deliver(
      textBody(f.phoneNumberId, { id: `wamid.IN.${f.run}.2`, from: "50255550502", body: "Hola" }),
    );
    expect(transcript(model, 0)).toEqual(["user: Hola, vengo de la garita"]);

    const alma = await c.sendo.actor("alma", f.tenantId);
    const list = await c.sendo.inbox.list({ actor: alma });
    expect(list.items.map((i) => i.source).sort()).toEqual(["garita", null]);
    const attributed = list.items.find((i) => i.source === "garita");
    const thread = await c.sendo.inbox.thread(attributed?.id ?? "", { actor: alma });
    expect(thread.items.find((m) => m.direction === "in")).toMatchObject({ source: "garita" });

    const range = { from: new Date(Date.now() - DAY), to: new Date(Date.now() + DAY) };
    const bySource = await c.sendo.metrics.bySource({ actor: alma, ...range });
    const totals = new Map<string | null, number>();
    for (const row of bySource)
      totals.set(row.source, (totals.get(row.source) ?? 0) + row.conversations);
    expect(Object.fromEntries(totals)).toEqual({ garita: 1, null: 1 });
    const sources = await c.sendo.links.sources({ actor: alma });
    expect(sources).toEqual(
      expect.arrayContaining([
        { source: "garita", conversations: 1 },
        { source: null, conversations: 1 },
      ]),
    );
    const sofia = await c.sendo.actor("sofia", f.tenantId);
    await expect(c.sendo.links.sources({ actor: sofia })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  } finally {
    await purgeTenant(adapter, f.tenantId);
  }
}

/* ===================================================================== Flow H */

/**
 * Flow H (broadcast): an approved UTILITY template to three contacts at one per minute, sent
 * across ticks; the second contact writes "BAJA" mid-run and is skipped; delivery statuses reach
 * the recipient rows; the broadcast ends `done` and replies land in normal conversations.
 */
export async function flowH(env: FlowEnv): Promise<void> {
  const f = ids("h");
  const adapter = env.adapter();
  const meta = metaSends(env, f);
  graphReads(env);
  const c = client(adapter, f, {}, TEAM);
  const model = scriptedModel(textResult("¡Gracias por escribir!"));
  c.sendo.agent({ name: "recepcion", model, instructions: "Recepción." });
  try {
    const account = await addAccount(adapter, f);
    await adapter.templates.upsertMany(account.id, [
      {
        name: "cobro_emitido",
        language: "es",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Tu cobro de noviembre fue emitido." }],
        variableCount: 0,
      },
    ]);
    const phones = ["50255550601", "50255550602", "50255550603"];
    const e164 = phones.map((waId) => `+${waId}`);
    const contacts = [];
    for (const waId of phones) {
      const { contact } = await adapter.contacts.upsert({
        accountId: account.id,
        tenantId: f.tenantId,
        phone: `+${waId}`,
        waId,
      });
      contacts.push(contact);
    }
    const alma = await c.sendo.actor("alma", f.tenantId);
    const broadcast = await c.sendo.broadcasts.create({
      actor: alma,
      template: "cobro_emitido",
      language: "es",
      recipients: contacts.map((contact) => contact.id),
      ratePerMinute: 1,
    });
    expect(broadcast.status).toBe("queued");

    const status = async () => {
      const page = await c.sendo.broadcasts.recipients(broadcast.id, { actor: alma, limit: 10 });
      return Object.fromEntries(page.items.map((r) => [r.contact?.phone ?? r.contactId, r]));
    };
    const templatesTo = () => meta.sends.filter((m) => m.type === "template").map((m) => m.to);
    const start = Date.now();
    await c.sendo.maintenance.tick({ now: new Date(start) });
    // One per minute. The order among recipients is not part of the contract.
    expect(templatesTo()).toHaveLength(1);
    const first = templatesTo()[0] ?? "";
    const firstId = meta.lastId();
    const [optOut, last] = e164.filter((phone) => phone !== first);
    if (optOut === undefined || last === undefined) throw new Error("recipients");

    // Mid-run: a contact still pending opts out; the confirmation goes out inside the window.
    await c.deliver(
      textBody(f.phoneNumberId, {
        id: `wamid.IN.${f.run}.1`,
        from: optOut.slice(1),
        body: " baja ",
      }),
    );
    expect(meta.sends.at(-1)).toMatchObject({ to: optOut, type: "text" });
    expect(model.doGenerateCalls).toHaveLength(0);

    for (let minute = 1; minute <= 4; minute++) {
      await c.sendo.maintenance.tick({ now: new Date(start + minute * MINUTE) });
    }
    expect(templatesTo()).toEqual([first, last]);
    await c.deliver(statusBody(f.phoneNumberId, firstId, "delivered", first.slice(1)));
    const rows = await status();
    expect(rows[first]).toMatchObject({ status: "delivered" });
    expect(rows[optOut]).toMatchObject({ status: "skipped", skipReason: "opted_out" });
    expect(rows[last]).toMatchObject({ status: "sent" });
    const view = await c.sendo.broadcasts.get(broadcast.id, { actor: alma });
    expect(view).toMatchObject({ status: "done", counts: { delivered: 1, sent: 1, skipped: 1 } });

    // A reply to the broadcast is a normal conversation the agent answers.
    await c.deliver(
      textBody(f.phoneNumberId, {
        id: `wamid.IN.${f.run}.2`,
        from: first.slice(1),
        body: "Gracias",
      }),
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    const chat = await conversationOf(adapter, account, first.slice(1));
    expect(chat.status).toBe("agent");
  } finally {
    await purgeTenant(adapter, f.tenantId);
  }
}
