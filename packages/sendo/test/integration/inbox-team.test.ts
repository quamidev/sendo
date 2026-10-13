/**
 * Product spec 3.1 "Inbox operations" (SND-3.2), end to end: signed webhooks → pipeline → agent
 * runtime with a scripted model → `sendo.inbox.*` with real actors (`sendo.actor` + `resolveRole`)
 * → msw Graph API, on the memory adapter.
 *
 * Ways it could fail (one test each):
 * [AC-IB-1a] Step-in changes the status, the assignment or pauses the agent; or the agent's next
 *            turn doesn't see the person's message as `[operador] …`.
 * [AC-IB-1b] "Tomar" doesn't assign the actor and move to `human`; `conversation.assigned` or the
 *            rules hook `onEnterHuman` is skipped on a transition into `human` (handoff, take, assign).
 * [AC-IB-2a] A paused conversation still runs turns; the pause/resume is silent (no event, no
 *            system line); after a resume the agent answers what arrived during the pause
 *            (a late dispatch, conversation or number pause).
 * [AC-IB-2b] A pause set while a turn runs cuts that turn short, or lets the next one run.
 * [AC-IB-3]  A note is sent to Meta, reaches the model, or counts as an answer (clears
 *            `awaitingReplySince`).
 * [AC-IB-4a] Draft mode sends the reply, skips the tools, keeps two drafts, or loses the usage.
 * [AC-IB-4b] Approving sends after the window closed, loses the edit, changes the sender, or
 *            doesn't record `approvedBy` / `edited`.
 * [AC-IB-4c] A human reply leaves the stale draft; discard leaves it; a handoff after the draft
 *            doesn't label it.
 * [AC-IB-5]  The assignee isn't resolved through `resolveUsers` (one call per page, `null` name
 *            fallback), or the assign menu ignores `resolveAssignees({ tenantId, queue, account })`.
 * [AC-IB-6]  The handoff banner data (`reason`, `by`, `at`) is missing while `human`.
 * [AC-IB-8]  Replying, noting or approving on a disconnected number is not a typed error, or it
 *            also blocks reading the thread.
 * [AC-TG-2]  `inbox.tags.add/remove` doesn't reach the conversation's `tags` or the tag filter.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { agentTool } from "../../src/agents/runtime";
import {
  scriptedModel,
  storeInbound,
  textResult,
  textWebhook,
  toolCallResult,
  transcript,
} from "../../src/agents/test-helpers";
import type { AgentDefinition } from "../../src/agents/types";
import { createNoopRulesHooks } from "../../src/core/context";
import {
  acceptSends,
  burstWebhook,
  useGraphServer,
  type ClientOptions,
} from "../../src/core/test-utils";
import { AccountStateError, WindowClosedError } from "../../src/errors/errors";
import type {
  ConversationAgentPausedEvent,
  ConversationAssignedEvent,
} from "../../src/team/events";
import type { ResolveAssigneesInput, ResolveRole } from "../../src/team/config";
import { createHarness } from "./harness";

const graph = useGraphServer();

const DIRECTORY: Record<string, { role: "agent" | "supervisor" | "admin"; queues?: string[] }> = {
  ana: { role: "agent", queues: ["cobranza"] },
  sofia: { role: "supervisor" },
  alma: { role: "admin" },
};
const NAMES: Record<string, string> = { ana: "Ana López", sofia: "Sofía Ruiz", alma: "Alma Díaz" };

const resolveRole: ResolveRole = ({ userId, tenantId }) =>
  Promise.resolve(tenantId === "tenant-a" ? (DIRECTORY[userId] ?? null) : null);

async function setup(options: ClientOptions = {}) {
  const sent: { text?: { body?: string } }[] = [];
  graph.server.use(acceptSends(sent));
  const resolveUsers = vi.fn((ids: string[]) =>
    Promise.resolve(
      ids.flatMap((id) => {
        const name = NAMES[id];
        return name === undefined ? [] : [{ id, name, avatarUrl: `https://img.test/${id}.png` }];
      }),
    ),
  );
  const h = await createHarness({ resolveRole, resolveUsers, handoffMessage: null, ...options });
  const actors = {
    ana: await h.sendo.actor("ana", "tenant-a"),
    sofia: await h.sendo.actor("sofia", "tenant-a"),
    alma: await h.sendo.actor("alma", "tenant-a"),
  };
  const paused: ConversationAgentPausedEvent[] = [];
  const assigned: ConversationAssignedEvent[] = [];
  h.sendo.on("conversation.agent_paused", (e) => {
    paused.push(e);
  });
  h.sendo.on("conversation.assigned", (e) => {
    assigned.push(e);
  });
  /** The conversation of the fixture contact. */
  const conversationId = () => h.messages("in")[0]?.conversationId ?? "";
  return { ...h, sent, actors, paused, assigned, resolveUsers, conversationId };
}

function agent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "recepcion",
    model: scriptedModel(textResult("¡Hola!")),
    instructions: "Eres la recepcionista de la clínica.",
    ...overrides,
  };
}

let seq = 0;
const text = (body: string) => textWebhook({ id: `wamid.IT${String(++seq)}`, body });

describe("Team inbox operations", () => {
  it("[AC-IB-1a] step-in sends as the person without taking over; the agent sees it as [operador]", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("¡Hola! ¿En qué te ayudo?"), textResult("Claro."));
    h.sendo.agent(agent({ model }));
    await h.deliver(text("Hola"));
    const id = h.conversationId();

    const message = await h.sendo.inbox.reply(
      id,
      { kind: "text", body: "Soy Ana, del equipo." },
      { actor: h.actors.ana },
    );
    expect(message).toMatchObject({ sender: "human", senderRef: "ana", status: "sent" });
    expect(await h.sendo.conversations.get(id)).toMatchObject({
      status: "agent",
      assignedTo: null,
      agentPaused: false,
    });

    await h.deliver(text("¿Y el horario?"));
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(transcript(model, 1)).toEqual([
      "user: Hola",
      "assistant: ¡Hola! ¿En qué te ayudo?\n[operador] Soy Ana, del equipo.",
      "user: ¿Y el horario?",
    ]);
    expect(h.sent.map((s) => s.text?.body)).toEqual([
      "¡Hola! ¿En qué te ayudo?",
      "Soy Ana, del equipo.",
      "Claro.",
    ]);
  });

  it("[AC-IB-1b] take assigns the actor, emits conversation.assigned and runs onEnterHuman on every entry into human", async () => {
    const h = await setup();
    const entered: string[] = [];
    h.ctx.rulesHooks = {
      ...createNoopRulesHooks(),
      onEnterHuman: ({ conversation, by }) => {
        entered.push(by);
        return Promise.resolve(conversation);
      },
    };
    await h.deliver(text("Hola"));
    const id = h.conversationId();

    const taken = await h.sendo.inbox.take(id, { actor: h.actors.ana });
    expect(taken).toMatchObject({
      status: "human",
      assignedTo: "ana",
      assignee: { id: "ana", name: "Ana López", avatarUrl: "https://img.test/ana.png" },
    });
    expect(h.assigned.map((e) => [e.from, e.to, e.by])).toEqual([[null, "ana", "ana"]]);

    await h.sendo.inbox.returnToAgent(id, { actor: h.actors.ana });
    await h.sendo.conversations.handoff(id, { reason: "Pide un doctor", by: "agent:recepcion" });
    await h.sendo.inbox.returnToAgent(id, { actor: h.actors.sofia });
    await h.sendo.inbox.assign(id, "ana", { actor: h.actors.sofia });
    expect(entered).toEqual(["ana", "agent:recepcion", "sofia"]);

    const lines = (await h.sendo.inbox.thread(id, { actor: h.actors.sofia })).items
      .filter((m) => m.systemLine !== null)
      .map((m) => [m.systemLine?.event, m.text])
      .reverse();
    expect(lines).toEqual([
      ["assigned", "Ana López tomó la conversación"],
      ["returned", "Ana López devolvió la conversación al agente"],
      ["handoff", "El agente recepcion pasó la conversación a una persona · Pide un doctor"],
      ["returned", "Sofía Ruiz devolvió la conversación al agente"],
      ["assigned", "Sofía Ruiz asignó la conversación a Ana López"],
    ]);
    expect(h.sent).toEqual([]);
  });

  it("[AC-IB-2a] a paused conversation runs no turns, and the agent never answers what arrived during the pause", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("uno"), textResult("dos"));
    h.sendo.agent(agent({ model }));
    await h.deliver(text("Hola"));
    const id = h.conversationId();

    await h.sendo.inbox.pauseAgent(id, true, { actor: h.actors.sofia });
    await h.deliver(text("¿Siguen ahí?"));
    expect(model.doGenerateCalls).toHaveLength(1);

    // A message stored during the pause whose dispatch runs only after the resume.
    const late = await storeInbound(h.ctx, h.account, { text: "mensaje tardío" });
    const resumed = await h.sendo.inbox.pauseAgent(id, false, { actor: h.actors.sofia });
    expect(resumed).toMatchObject({ agentPaused: false, agentPausedOn: null });
    await h.ctx.agentDispatcher?.handleInbound({ ...late, account: h.account });
    expect(model.doGenerateCalls).toHaveLength(1);

    expect(h.paused.map((e) => [e.paused, e.by])).toEqual([
      [true, "sofia"],
      [false, "sofia"],
    ]);
    const lines = h.messages("out").filter((m) => m.internal);
    expect(lines.map((m) => m.text)).toEqual([
      "Sofía Ruiz pausó al agente en esta conversación",
      "Sofía Ruiz reanudó al agente",
    ]);
    expect(lines[1]?.metadata.agentResumeFrom).toBe(late.message.id);

    await h.deliver(text("Ahora sí, una cita"));
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(transcript(model, 1).at(-1)).toBe("user: Ahora sí, una cita");
    expect(h.sent.map((s) => s.text?.body)).toEqual(["uno", "dos"]);
  });

  it("[AC-IB-2a] a number paused and resumed doesn't catch up either", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("uno"));
    h.sendo.agent(agent({ model }));
    await h.sendo.accounts.pauseAgent(h.account.id, true);
    await h.deliver(text("Hola"));
    const [listed] = (await h.sendo.inbox.list({ actor: h.actors.alma })).items;
    expect(listed).toMatchObject({ agentPaused: true, agentPausedOn: "account" });

    await h.sendo.accounts.pauseAgent(h.account.id, false);
    const [message] = h.messages("in");
    if (!message) throw new Error("no inbound");
    const contact = await h.adapter.contacts.get(listed?.contact.id ?? "");
    const conversation = await h.sendo.conversations.get(h.conversationId());
    if (!contact || !conversation) throw new Error("missing rows");
    await h.ctx.agentDispatcher?.handleInbound({
      account: h.account,
      contact,
      conversation,
      message,
    });
    expect(model.doGenerateCalls).toHaveLength(0);

    await h.deliver(text("¿Hola?"));
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("[AC-IB-2b] a pause while a turn runs lets that turn finish and stops the next one", async () => {
    const h = await setup();
    let injected = false;
    const model = scriptedModel(async () => {
      if (!injected) {
        injected = true;
        await h.sendo.inbox.pauseAgent(h.conversationId(), true, { actor: h.actors.alma });
        await h.deliver(text("y otra cosa"));
      }
      return textResult("primera");
    }, textResult("segunda"));
    h.sendo.agent(agent({ model }));

    await h.deliver(text("quiero una cita"));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.sent.map((s) => s.text?.body)).toEqual(["primera"]);

    await h.sendo.inbox.pauseAgent(h.conversationId(), false, { actor: h.actors.alma });
    const pending = h.messages("in").at(-1);
    const conversation = await h.sendo.conversations.get(h.conversationId());
    const contact = await h.adapter.contacts.get(conversation?.contactId ?? "");
    if (!pending || !conversation || !contact) throw new Error("missing rows");
    await h.ctx.agentDispatcher?.handleInbound({
      account: h.account,
      contact,
      conversation,
      message: pending,
    });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("[AC-IB-3] notes are stored, never sent, hidden from the model and never answer the contact", async () => {
    const h = await setup();
    await h.deliver(text("¿Me ayudan con mi saldo?"));
    const id = h.conversationId();
    const waiting = (await h.sendo.conversations.get(id))?.awaitingReplySince;
    expect(waiting).toBeInstanceOf(Date);

    const note = await h.sendo.inbox.note(id, "Cliente VIP, ofrecer descuento", {
      actor: h.actors.ana,
    });
    expect(note).toMatchObject({
      internal: true,
      sender: "human",
      senderRef: "ana",
      status: "sent",
      metaMessageId: null,
      systemLine: null,
    });
    expect(graph.requests).toHaveLength(0);
    expect((await h.sendo.conversations.get(id))?.awaitingReplySince).toEqual(waiting);
    const [row] = (await h.sendo.inbox.list({ actor: h.actors.sofia })).items;
    expect(row?.lastMessagePreview?.text).toBe("¿Me ayudan con mi saldo?");

    const model = scriptedModel(textResult("Claro"));
    h.sendo.agent(agent({ model }));
    await h.deliver(text("¿Siguen?"));
    expect(transcript(model, 0)).toEqual(["user: ¿Me ayudan con mi saldo?", "user: ¿Siguen?"]);
    const thread = await h.sendo.inbox.thread(id, { actor: h.actors.sofia });
    expect(thread.items.find((m) => m.id === note.id)).toMatchObject({ internal: true });
  });

  it("[AC-IB-4a] draft mode stores one draft per conversation, runs tools, keeps usage and sends nothing", async () => {
    const h = await setup();
    const lookups: unknown[] = [];
    const model = scriptedModel(
      toolCallResult("consultar_saldo", { cuenta: "123" }),
      textResult("Tu saldo es Q100."),
      textResult("Tu saldo sigue siendo Q100."),
    );
    h.sendo.agent(
      agent({
        model,
        mode: "draft",
        tools: {
          consultar_saldo: agentTool({
            input: z.object({ cuenta: z.string() }),
            run: ({ input }) => {
              lookups.push(input);
              return Promise.resolve({ saldo: 100 });
            },
          }),
        },
      }),
    );
    await h.deliver(text("¿Cuál es mi saldo?"));
    const id = h.conversationId();

    expect(lookups).toEqual([{ cuenta: "123" }]);
    expect(h.sent).toEqual([]);
    const [draft] = h.messages("out");
    expect(draft).toMatchObject({
      sender: "agent",
      senderRef: "recepcion",
      draft: true,
      status: "pending",
      text: "Tu saldo es Q100.",
      tokensIn: 2,
      tokensOut: 2,
    });
    expect((await h.sendo.inbox.get(id, { actor: h.actors.ana })).hasPendingDraft).toBe(true);
    expect((await h.sendo.conversations.get(id))?.awaitingReplySince).toBeInstanceOf(Date);

    await h.deliver(text("¿Seguro?"));
    const drafts = h.messages("out").filter((m) => m.draft);
    expect(drafts.map((m) => m.text)).toEqual(["Tu saldo sigue siendo Q100."]);
    expect(transcript(model, 2)).toEqual(["user: ¿Cuál es mi saldo?", "user: ¿Seguro?"]);
    expect(h.sent).toEqual([]);
  });

  it("[AC-IB-4a] the account's agentMode overrides the agent's mode", async () => {
    const h = await setup();
    h.sendo.agent(agent({ mode: "auto" }));
    await h.sendo.accounts.setAgentMode(h.account.id, "draft");
    await h.deliver(text("Hola"));
    expect(h.sent).toEqual([]);
    expect(h.messages("out")[0]).toMatchObject({ draft: true });
  });

  it("[AC-IB-4b] approving sends the edited draft as the agent, records approvedBy and edited", async () => {
    const h = await setup();
    h.sendo.agent(agent({ mode: "draft", model: scriptedModel(textResult("Mañana a las 9.")) }));
    await h.deliver(text("¿Cuándo abren?"));
    const id = h.conversationId();
    const draft = h.messages("out")[0];
    if (!draft) throw new Error("no draft");

    const approved = await h.sendo.inbox.approveDraft(draft.id, {
      actor: h.actors.ana,
      text: "Mañana a las 9:00, ¡te esperamos!",
    });
    expect(approved).toMatchObject({
      id: draft.id,
      sender: "agent",
      senderRef: "recepcion",
      draft: false,
      status: "sent",
      text: "Mañana a las 9:00, ¡te esperamos!",
      approvedBy: "ana",
      edited: true,
    });
    expect(h.sent.map((s) => s.text?.body)).toEqual(["Mañana a las 9:00, ¡te esperamos!"]);
    expect((await h.sendo.conversations.get(id))?.awaitingReplySince).toBeNull();
    expect((await h.sendo.inbox.get(id, { actor: h.actors.ana })).hasPendingDraft).toBe(false);
    await expect(
      h.sendo.inbox.approveDraft(draft.id, { actor: h.actors.ana }),
    ).rejects.toMatchObject({ code: "RECORD_NOT_FOUND" });
  });

  it("[AC-IB-4b] approving after the window closed throws WINDOW_CLOSED and keeps the draft", async () => {
    const h = await setup();
    h.sendo.agent(agent({ mode: "draft" }));
    await h.deliver(text("Hola"));
    const id = h.conversationId();
    const draft = h.messages("out")[0];
    if (!draft) throw new Error("no draft");
    await h.adapter.conversations.update(id, {
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });

    await expect(
      h.sendo.inbox.approveDraft(draft.id, { actor: h.actors.ana }),
    ).rejects.toBeInstanceOf(WindowClosedError);
    expect(graph.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    expect(await h.adapter.messages.get(draft.id)).toMatchObject({ draft: true });
  });

  it("[AC-IB-4c] a human reply discards the draft; discardDraft deletes it; a later handoff labels it", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("borrador 1"), textResult("borrador 2"));
    h.sendo.agent(agent({ mode: "draft", model }));
    await h.deliver(text("Hola"));
    const id = h.conversationId();

    await h.sendo.inbox.reply(
      id,
      { kind: "text", body: "Te atiendo yo." },
      { actor: h.actors.ana },
    );
    expect(h.messages("out").filter((m) => m.draft)).toEqual([]);

    await h.deliver(text("Gracias"));
    const second = h.messages("out").find((m) => m.draft);
    if (!second) throw new Error("no draft");
    await h.sendo.conversations.handoff(id, { reason: "Quiere hablar con caja" });
    const labelled = (await h.sendo.inbox.thread(id, { actor: h.actors.sofia })).items.find(
      (m) => m.id === second.id,
    );
    expect(labelled).toMatchObject({ draft: true, handoffAfterDraft: true });

    await h.sendo.inbox.discardDraft(second.id, { actor: h.actors.sofia });
    expect(await h.adapter.messages.get(second.id)).toBeNull();
    expect(h.sent.map((s) => s.text?.body)).toEqual(["Te atiendo yo."]);
  });

  it("[AC-IB-5] assignees come from resolveUsers once per page; the menu uses resolveAssignees", async () => {
    const resolveAssignees = vi.fn((_input: ResolveAssigneesInput) =>
      Promise.resolve(["ana", "desconocido"]),
    );
    const h = await setup({ resolveAssignees });
    await h.deliver(text("Hola"));
    await h.deliver(burstWebhook([{ id: "wamid.IT-OTHER", body: "Hola", from: "50255559999" }]));
    const ids = [...h.adapter.__state.conversations.keys()];
    expect(ids).toHaveLength(2);
    await h.sendo.inbox.assign(ids[0] ?? "", "ana", { actor: h.actors.sofia });
    await h.sendo.inbox.assign(ids[1] ?? "", "desconocido", { actor: h.actors.sofia });
    expect(h.assigned.map((e) => [e.from, e.to, e.by])).toEqual([
      [null, "ana", "sofia"],
      [null, "desconocido", "sofia"],
    ]);

    h.resolveUsers.mockClear();
    const page = await h.sendo.inbox.list({ actor: h.actors.sofia });
    expect(h.resolveUsers).toHaveBeenCalledTimes(1);
    expect(
      page.items.map((c) => c.assignee).sort((a, b) => (a?.id ?? "").localeCompare(b?.id ?? "")),
    ).toEqual([
      { id: "ana", name: "Ana López", avatarUrl: "https://img.test/ana.png" },
      { id: "desconocido", name: null, avatarUrl: null },
    ]);

    const menu = await h.sendo.inbox.assignees(ids[0] ?? "", { actor: h.actors.sofia });
    expect(menu).toEqual([
      { id: "ana", name: "Ana López", avatarUrl: "https://img.test/ana.png" },
      { id: "desconocido", name: null, avatarUrl: null },
    ]);
    const [input] = resolveAssignees.mock.lastCall ?? [];
    expect(input).toMatchObject({ tenantId: "tenant-a", queue: null });
    expect(input?.account.id).toBe(h.account.id);
  });

  it("[AC-IB-6] the handoff banner carries the reason, who handed off and when", async () => {
    const h = await setup();
    await h.deliver(text("Hola"));
    const id = h.conversationId();
    const before = Date.now();
    await h.sendo.conversations.handoff(id, {
      reason: "Pide hablar con el doctor",
      by: "agent:recepcion",
    });
    const conversation = await h.sendo.inbox.get(id, { actor: h.actors.ana });
    expect(conversation.handoff).toMatchObject({
      reason: "Pide hablar con el doctor",
      by: "agent:recepcion",
    });
    expect(conversation.handoff?.at?.getTime()).toBeGreaterThanOrEqual(before);

    await h.sendo.inbox.returnToAgent(id, { actor: h.actors.ana });
    expect((await h.sendo.inbox.get(id, { actor: h.actors.ana })).handoff).toBeNull();
  });

  it("[AC-IB-8] a disconnected number is read-only: reply, note and approve throw ACCOUNT_STATE", async () => {
    const h = await setup();
    h.sendo.agent(agent({ mode: "draft" }));
    await h.deliver(text("Hola"));
    const id = h.conversationId();
    const draft = h.messages("out")[0];
    if (!draft) throw new Error("no draft");
    await h.sendo.accounts.disconnect(h.account.id);

    const actor = { actor: h.actors.alma };
    for (const call of [
      () => h.sendo.inbox.reply(id, { kind: "text", body: "hola" }, actor),
      () => h.sendo.inbox.note(id, "nota", actor),
      () => h.sendo.inbox.approveDraft(draft.id, actor),
    ]) {
      const error: unknown = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccountStateError);
      expect(error).toMatchObject({ code: "ACCOUNT_STATE", state: "inactive" });
    }
    expect(h.sent).toEqual([]);
    expect((await h.sendo.inbox.thread(id, actor)).items.length).toBeGreaterThan(0);
    expect(await h.sendo.inbox.get(id, actor)).toMatchObject({ accountActive: false });
  });

  it("[AC-TG-2] tags added from the inbox show on the conversation and filter the list", async () => {
    const h = await setup();
    await h.deliver(text("Hola"));
    const id = h.conversationId();
    const tag = await h.adapter.tags.upsert({ tenantId: "tenant-a", name: "VIP", color: "amber" });

    const tags = await h.sendo.inbox.tags.add(id, tag.id, { actor: h.actors.ana });
    expect(tags).toEqual([{ id: tag.id, name: "VIP", color: "amber" }]);
    expect((await h.sendo.inbox.get(id, { actor: h.actors.ana })).tags).toEqual(tags);
    const filtered = await h.sendo.inbox.list({ actor: h.actors.ana, tagIds: [tag.id] });
    expect(filtered.items.map((c) => c.id)).toEqual([id]);

    expect(await h.sendo.inbox.tags.remove(id, tag.id, { actor: h.actors.ana })).toEqual([]);
    expect((await h.sendo.inbox.list({ actor: h.actors.ana, tagIds: [tag.id] })).items).toEqual([]);
  });
});
