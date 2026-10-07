import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FIXTURE_IDS } from "../../test/support/fixtures";
import { getContext } from "../core/context";
import { createWhatsApp } from "../core/create-whatsapp";
import type { HandoffEvent } from "../core/events";
import {
  acceptSends,
  accountInput,
  burstWebhook,
  makeClient,
  useGraphServer,
  type ClientOptions,
} from "../core/test-utils";
import { ConfigError } from "../errors/errors";
import * as waLi from "../index";
import type { Account } from "../types/entities";
import { HANDOFF_TOOL_NAME } from "./prompt";
import { agentTool } from "./runtime";
import {
  failingModel,
  promptOf,
  scriptedModel,
  storeInbound,
  systemOf,
  textResult,
  textWebhook,
  toolCallResult,
  transcript,
  webhookRequest,
} from "./test-helpers";
import type { AgentDefinition } from "./types";

const graph = useGraphServer();

async function setup(options: ClientOptions = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(
    accountInput({ phoneNumberId: FIXTURE_IDS.phoneNumberId, wabaId: FIXTURE_IDS.wabaId }),
  );
  const sent: unknown[] = [];
  graph.server.use(acceptSends(sent));

  /** Posts a signed webhook and waits for the background pipeline (and agent turns). */
  async function deliver(body: string) {
    const tasks: Promise<unknown>[] = [];
    const response = await client.wa.handleWebhook(webhookRequest(body), {
      waitUntil: (p) => tasks.push(p),
    });
    expect(response.status).toBe(200);
    await Promise.all(tasks);
  }

  function outbound() {
    return [...client.adapter.__state.messages.values()]
      .filter((m) => m.direction === "out")
      .sort((a, b) => a.seq - b.seq);
  }

  return { ...client, account, sent, deliver, outbound };
}

function agentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "recepcion",
    model: scriptedModel(textResult("¡Hola! ¿En qué te ayudo?")),
    instructions: "Eres la recepcionista de la clínica.",
    ...overrides,
  };
}

describe("wa.agent — registration", () => {
  it("is exported from the main entry and returns a handle", () => {
    const { wa } = makeClient();
    const handle = wa.agent(agentDef());
    expect(handle.name).toBe("recepcion");
    expect(waLi.HANDOFF_TOOL_NAME).toBe("transferir_a_humano");
    expect(waLi.agentTool).toBeTypeOf("function");
  });

  it.each([
    ["name", { name: "" }],
    ["model", { model: undefined }],
    ["instructions", { instructions: "" }],
    ["historyLimit", { historyLimit: 0 }],
    ["handoff", { handoff: { when: "", to: "admins" } }],
    ["tool schema", { tools: { x: { input: {}, run: () => Promise.resolve(1) } } }],
    [
      "built-in tool name",
      {
        tools: {
          [HANDOFF_TOOL_NAME]: agentTool({ input: z.object({}), run: () => Promise.resolve(1) }),
        },
      },
    ],
  ])("rejects an invalid %s with ConfigError", (_label, patch) => {
    const { wa } = makeClient();
    expect(() => wa.agent({ ...agentDef(), ...(patch as Partial<AgentDefinition>) })).toThrow(
      ConfigError,
    );
  });

  it("rejects two agents matching the same accounts", () => {
    const { wa } = makeClient();
    wa.agent(agentDef({ name: "a" }));
    expect(() => wa.agent(agentDef({ name: "b" }))).toThrow(ConfigError);
    expect(() => wa.agent(agentDef({ name: "a", accounts: ["PN_X"] }))).toThrow(ConfigError);

    const other = makeClient().wa;
    other.agent(agentDef({ name: "a", accounts: ["PN_A", "PN_B"] }));
    expect(() => other.agent(agentDef({ name: "b", accounts: ["PN_B"] }))).toThrow(ConfigError);
    expect(other.agent(agentDef({ name: "c", accounts: ["PN_C"] })).name).toBe("c");
  });

  it("logs a ConfigError and runs no turn when predicates overlap at dispatch", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("hola"));
    t.wa.agent(agentDef({ name: "a", model, accounts: () => true }));
    t.wa.agent(agentDef({ name: "b", model, accounts: () => true }));
    await t.deliver(textWebhook({ id: "wamid.P1", body: "hola" }));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(t.logs.of("error").some((line) => line.includes("only one agent"))).toBe(true);
  });

  it("filters accounts by id, phone number id or predicate", async () => {
    const t = await setup();
    const other: Account = await t.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OTHER", wabaId: "WABA_O", tokenRef: "WA_TOKEN_B" }),
    );
    const byPhone = scriptedModel(textResult("desde phone id"));
    const byPredicate = scriptedModel(textResult("desde predicado"));
    t.wa.agent(agentDef({ name: "a", model: byPhone, accounts: [FIXTURE_IDS.phoneNumberId] }));
    t.wa.agent(agentDef({ name: "b", model: byPredicate, accounts: (a) => a.id === other.id }));
    await t.deliver(textWebhook({ id: "wamid.F1", body: "hola" }));
    expect(byPhone.doGenerateCalls).toHaveLength(1);
    expect(byPredicate.doGenerateCalls).toHaveLength(0);

    const { message, ...target } = await storeInbound(t.ctx, other, { text: "hola" });
    await t.ctx.agentDispatcher?.handleInbound({ ...target, account: other, message });
    expect(byPredicate.doGenerateCalls).toHaveLength(1);

    const byId = makeClient();
    const acc = await byId.adapter.accounts.insert(accountInput());
    const idModel = scriptedModel(textResult("ok"));
    byId.wa.agent(agentDef({ model: idModel, accounts: [acc.id] }));
    const stored = await storeInbound(byId.ctx, acc);
    await byId.ctx.agentDispatcher?.handleInbound({ ...stored, account: acc });
    expect(idModel.doGenerateCalls).toHaveLength(1);
  });

  it("remove() stops the agent from answering", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("hola"));
    t.wa.agent(agentDef({ model })).remove();
    await t.deliver(textWebhook({ id: "wamid.R1", body: "hola" }));
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});

describe("wa.agent — turns", () => {
  it("answers through the pipeline with sender agent and senderRef name", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("¡Hola Ana!"));
    t.wa.agent(agentDef({ model }));
    await t.deliver(textWebhook({ id: "wamid.S1", body: "Quiero una cita" }));

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(transcript(model)).toEqual(["user: Quiero una cita"]);
    const system = systemOf(model);
    expect(system).toContain("Eres la recepcionista de la clínica.");
    expect(system).toContain("+50255550001");
    expect(system).toContain("Ana Pérez");
    expect(system).toContain("sin vincular");
    expect(system).toContain("(America/Guatemala)");
    expect(system).not.toContain(HANDOFF_TOOL_NAME);

    const [reply] = t.outbound();
    expect(reply).toMatchObject({
      sender: "agent",
      senderRef: "recepcion",
      text: "¡Hola Ana!",
      status: "sent",
    });
    expect(reply?.metadata).toMatchObject({ agent: "recepcion", steps: [{ toolCalls: [] }] });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ to: `+${FIXTURE_IDS.waId}`, text: { body: "¡Hola Ana!" } });
  });

  it("passes contact info and the date to function instructions", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    const instructions = vi.fn(
      ({ contact }: { contact: { phone: string } }) => `Atiende a ${contact.phone}`,
    );
    t.wa.agent(agentDef({ model, instructions, timezone: "Europe/Madrid" }));
    await t.deliver(textWebhook({ id: "wamid.I1", body: "hola" }));
    const info = instructions.mock.calls[0]?.[0] as unknown as { wa: unknown; account: Account };
    expect(info.wa).toBe(t.wa);
    expect(info.account.id).toBe(t.account.id);
    expect(systemOf(model)).toContain("Atiende a +50255550001");
    expect(systemOf(model)).toContain("(Europe/Madrid)");
  });

  it("sends nothing when the final text is empty", async () => {
    const t = await setup();
    t.wa.agent(agentDef({ model: scriptedModel(textResult("   ")) }));
    await t.deliver(textWebhook({ id: "wamid.E1", body: "hola" }));
    expect(t.outbound()).toHaveLength(0);
  });

  it("runs a tool with validated input and the turn context", async () => {
    const t = await setup();
    const run = vi.fn(({ input }: { input: { fecha: string } }) =>
      Promise.resolve({ horarios: [`${input.fecha} 09:00`] }),
    );
    const model = scriptedModel(
      toolCallResult("buscar_horarios", { fecha: "2026-10-07" }),
      textResult("Tengo las 09:00."),
    );
    t.wa.agent(
      agentDef({
        model,
        tools: {
          buscar_horarios: agentTool({
            description: "Busca horarios libres",
            input: z.object({ fecha: z.string() }),
            run,
          }),
        },
      }),
    );
    await t.deliver(textWebhook({ id: "wamid.T1", body: "¿Hay espacio mañana?" }));

    expect(run).toHaveBeenCalledTimes(1);
    const toolCtx = run.mock.calls[0]?.[0] as unknown as Record<string, { id?: string }>;
    expect(toolCtx.input).toEqual({ fecha: "2026-10-07" });
    expect(toolCtx.contact?.id).toBeTypeOf("string");
    expect(toolCtx.account?.id).toBe(t.account.id);
    expect(toolCtx.conversation?.id).toBeTypeOf("string");
    expect(toolCtx.wa).toBe(t.wa);
    expect(model.doGenerateCalls[0]?.tools?.map((tool) => tool.name)).toEqual(["buscar_horarios"]);

    const [reply] = t.outbound();
    expect(reply?.text).toBe("Tengo las 09:00.");
    expect(reply?.metadata.steps).toEqual([
      expect.objectContaining({
        toolCalls: [{ id: "call-1", name: "buscar_horarios", input: { fecha: "2026-10-07" } }],
        toolResults: [
          { id: "call-1", name: "buscar_horarios", output: { horarios: ["2026-10-07 09:00"] } },
        ],
      }),
      expect.objectContaining({ text: "Tengo las 09:00.", toolCalls: [] }),
    ]);
  });

  it("does not run a tool when the model's input is invalid and reports the error", async () => {
    const t = await setup();
    const run = vi.fn(() => Promise.resolve("never"));
    const model = scriptedModel(
      toolCallResult("buscar_horarios", { fecha: 20261007 }),
      textResult("¿Para qué fecha?"),
    );
    t.wa.agent(
      agentDef({
        model,
        tools: { buscar_horarios: agentTool({ input: z.object({ fecha: z.string() }), run }) },
      }),
    );
    await t.deliver(textWebhook({ id: "wamid.T2", body: "mañana" }));

    expect(run).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(2);
    const toolMessage = promptOf(model, 1).find((m) => m.role === "tool");
    expect(toolMessage?.content[0]).toMatchObject({
      type: "tool-result",
      toolName: "buscar_horarios",
      output: { type: "error-text" },
    });
    expect(t.outbound()[0]?.text).toBe("¿Para qué fecha?");
  });

  it("hands off with the built-in tool and stops answering", async () => {
    const t = await setup({ resolveHandoffTargets: () => ["user-ana"] });
    const handoffs: HandoffEvent[] = [];
    t.wa.on("handoff", (e) => {
      handoffs.push(e);
    });
    const model = scriptedModel(
      toolCallResult(HANDOFF_TOOL_NAME, { motivo: "Pide hablar con un doctor" }),
      textResult("no debería llegar"),
    );
    t.wa.agent(
      agentDef({
        model,
        handoff: {
          when: "el paciente pide hablar con un doctor",
          to: "doctores",
          message: "Te paso con el equipo.",
        },
      }),
    );
    await t.deliver(textWebhook({ id: "wamid.H1", body: "Quiero hablar con el doctor" }));

    expect(systemOf(model)).toContain(
      "Llama a la herramienta `transferir_a_humano` con un `motivo` breve cuando: el paciente pide hablar con un doctor",
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    const conversation = [...t.adapter.__state.conversations.values()][0];
    expect(conversation).toMatchObject({
      status: "human",
      assignedTo: "user-ana",
      handoffReason: "Pide hablar con un doctor",
    });
    expect(handoffs).toEqual([
      expect.objectContaining({ reason: "Pide hablar con un doctor", assignees: ["user-ana"] }),
    ]);
    expect(t.outbound().map((m) => [m.sender, m.text])).toEqual([
      ["system", "Te paso con el equipo."],
    ]);

    await t.deliver(textWebhook({ id: "wamid.H2", body: "¿Hola?" }));
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("sends only the last historyLimit messages of this conversation", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    t.wa.agent(agentDef({ model, historyLimit: 3 }));
    await storeInbound(t.ctx, t.account, {
      phone: "+50255559999",
      text: "SECRETO de otro contacto",
    });
    for (const text of ["m1", "m2", "m3", "m4"]) await storeInbound(t.ctx, t.account, { text });
    const last = await storeInbound(t.ctx, t.account, { text: "m5" });
    await t.ctx.agentDispatcher?.handleInbound({ ...last, account: t.account });

    expect(transcript(model)).toEqual(["user: m3", "user: m4", "user: m5"]);
    expect(JSON.stringify(promptOf(model))).not.toContain("SECRETO");
  });

  it("maps agent, human and system messages to assistant turns", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    t.wa.agent(agentDef({ model }));
    const first = await storeInbound(t.ctx, t.account, { text: "hola" });
    const target = { account: t.account, contact: first.contact, conversation: first.conversation };
    await t.ctx.services.messages.send(
      { ...target, sender: "human", senderRef: "u1" },
      { kind: "text", body: "Soy Luis" },
    );
    await t.ctx.services.messages.send(
      { ...target, sender: "system" },
      { kind: "text", body: "Aviso" },
    );
    const next = await storeInbound(t.ctx, t.account, { text: "gracias" });
    await t.ctx.agentDispatcher?.handleInbound({ ...next, account: t.account });
    expect(transcript(model)).toEqual([
      "user: hola",
      "assistant: [operador] Soy Luis\nAviso",
      "user: gracias",
    ]);
  });

  it("answers a burst of stored messages in one combined turn", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("Respondo todo"));
    t.wa.agent(agentDef({ model }));
    const burst = [];
    for (const text of ["hola", "quiero una cita", "para mañana"]) {
      burst.push(await storeInbound(t.ctx, t.account, { text }));
    }
    for (const stored of burst) {
      await t.ctx.agentDispatcher?.handleInbound({ ...stored, account: t.account });
    }
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(transcript(model)).toEqual(["user: hola", "user: quiero una cita", "user: para mañana"]);
    expect(promptOf(model).filter((m) => m.role === "user")).toHaveLength(1);
    expect(t.outbound()).toHaveLength(1);
  });

  it("loops for a message that arrived during the turn", async () => {
    const t = await setup();
    let delivered = false;
    const model = scriptedModel(async () => {
      if (!delivered) {
        delivered = true;
        await t.deliver(textWebhook({ id: "wamid.L2", body: "y otra cosa" }));
      }
      return textResult("primera");
    }, textResult("segunda"));
    t.wa.agent(agentDef({ model }));
    await t.deliver(textWebhook({ id: "wamid.L1", body: "hola" }));

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(transcript(model, 0)).toEqual(["user: hola"]);
    expect(transcript(model, 1)).toEqual(["user: hola", "assistant: primera", "user: y otra cosa"]);
    expect(t.outbound().map((m) => m.text)).toEqual(["primera", "segunda"]);
  });

  it("skips turns over the per-contact rate limit but keeps the messages", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    t.wa.agent(agentDef({ model, maxMessagesPerMinutePerContact: 2 }));
    for (const n of [1, 2, 3]) {
      await t.deliver(textWebhook({ id: `wamid.RL${String(n)}`, body: `mensaje ${String(n)}` }));
    }
    expect(model.doGenerateCalls).toHaveLength(2);
    const inbound = [...t.adapter.__state.messages.values()].filter((m) => m.direction === "in");
    expect(inbound).toHaveLength(3);
    expect(t.logs.of("warn").some((line) => line.includes("rate limit"))).toBe(true);
  });

  it("runs one turn for two concurrent dispatches", async () => {
    const t = await setup();
    const model = scriptedModel(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return textResult("una sola vez");
    });
    t.wa.agent(agentDef({ model }));
    const a = await storeInbound(t.ctx, t.account, { text: "uno" });
    const b = await storeInbound(t.ctx, t.account, { text: "dos" });
    await Promise.all([
      t.ctx.agentDispatcher?.handleInbound({ ...a, account: t.account }),
      t.ctx.agentDispatcher?.handleInbound({ ...b, account: t.account }),
    ]);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(transcript(model)).toEqual(["user: uno", "user: dos"]);
    expect(t.outbound()).toHaveLength(1);
  });

  it("returns without a turn when the conversation lock is held", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    t.wa.agent(agentDef({ model }));
    const stored = await storeInbound(t.ctx, t.account);
    await t.adapter.locks.acquire(`conv:${stored.conversation.id}`, 60_000);
    await t.ctx.agentDispatcher?.handleInbound({ ...stored, account: t.account });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("sends the fallback when the model throws, releases the lock and keeps the status", async () => {
    const t = await setup();
    t.wa.agent(
      agentDef({
        model: failingModel(new Error("upstream 500")),
        fallbackMessage: "Disculpa, intenta de nuevo.",
      }),
    );
    await t.deliver(textWebhook({ id: "wamid.X1", body: "hola" }));

    const [fallback] = t.outbound();
    expect(fallback).toMatchObject({
      sender: "agent",
      senderRef: "recepcion",
      text: "Disculpa, intenta de nuevo.",
    });
    expect(fallback?.metadata).toMatchObject({ fallback: true });
    const conversation = [...t.adapter.__state.conversations.values()][0];
    expect(conversation?.status).toBe("agent");
    expect(await t.adapter.locks.acquire(`conv:${conversation?.id ?? ""}`, 1000)).toBe(true);
    expect(t.logs.of("error").some((line) => line.includes("upstream 500"))).toBe(true);
  });

  it("sends nothing when the model throws without a fallback", async () => {
    const t = await setup();
    t.wa.agent(agentDef({ model: failingModel() }));
    await t.deliver(textWebhook({ id: "wamid.X2", body: "hola" }));
    expect(t.outbound()).toHaveLength(0);
  });

  it("passes stored images as image parts unless vision is off", async () => {
    for (const vision of [true, false]) {
      const t = await setup();
      const model = scriptedModel(textResult("Linda foto"));
      t.wa.agent(agentDef({ model, vision }));
      const stored = await storeInbound(t.ctx, t.account, {
        type: "image",
        text: "mi receta",
        content: { mediaId: "M1", mimeType: "image/png" },
      });
      const bytes = new Uint8Array([137, 80, 78, 71]);
      await t.adapter.storage.put("acc/img.png", bytes, "image/png");
      await t.adapter.media.insert({
        tenantId: t.account.tenantId,
        messageId: stored.message.id,
        metaMediaId: "M1",
        mimeType: "image/png",
        sizeBytes: 4,
        storagePath: "acc/img.png",
        downloadStatus: "done",
      });
      const message = await t.adapter.messages.get(stored.message.id);
      if (!message) throw new Error("missing");
      await t.ctx.agentDispatcher?.handleInbound({ ...stored, message, account: t.account });

      const user = promptOf(model).find((m) => m.role === "user");
      const parts = user?.role === "user" ? user.content : [];
      if (vision) {
        expect(parts[0]).toMatchObject({ type: "file", mediaType: "image/png" });
        expect(parts[1]).toMatchObject({ type: "text", text: "mi receta" });
      } else {
        expect(parts).toEqual([
          expect.objectContaining({ type: "text", text: "[imagen] mi receta" }),
        ]);
      }
    }
  });

  it("answers a burst batched in one payload once, with every message in the prompt", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("¡Claro! ¿A qué hora mañana?"));
    t.wa.agent(agentDef({ model }));
    await t.deliver(
      burstWebhook([
        { id: "wamid.BURST1", body: "hola" },
        { id: "wamid.BURST2", body: "quiero cita" },
        { id: "wamid.BURST3", body: "mañana" },
      ]),
    );

    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = transcript(model).join("\n");
    expect(prompt).toContain("hola");
    expect(prompt).toContain("quiero cita");
    expect(prompt).toContain("mañana");
    expect(t.outbound()).toEqual([
      expect.objectContaining({ sender: "agent", text: "¡Claro! ¿A qué hora mañana?" }),
    ]);
    expect(t.sent).toHaveLength(1);
  });

  it("runs exactly one turn for a redelivered webhook", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("hola"));
    t.wa.agent(agentDef({ model }));
    const body = textWebhook({ id: "wamid.D1", body: "hola" });
    await t.deliver(body);
    await t.deliver(body);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(t.outbound()).toHaveLength(1);
  });

  it("does not answer again for a message a previous turn covered", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    t.wa.agent(agentDef({ model }));
    const stored = await storeInbound(t.ctx, t.account);
    await t.ctx.agentDispatcher?.handleInbound({ ...stored, account: t.account });

    // A second client (another process) shares the database: the coverage comes from metadata.
    const second = createWhatsApp({
      adapter: t.adapter,
      appSecret: "s",
      verifyToken: "v",
      resolveToken: () => "token-account-a-secret",
    });
    const otherModel = scriptedModel(textResult("otra vez"));
    second.agent(agentDef({ model: otherModel }));
    await getContext(second).agentDispatcher?.handleInbound({ ...stored, account: t.account });
    expect(otherModel.doGenerateCalls).toHaveLength(0);
  });
});
