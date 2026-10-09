/**
 * Product spec — Acceptance Criteria — "Agents". Every test goes end to end through
 * wa.handleWebhook (signed payload → pipeline → agent runtime → Graph send) with a scripted
 * MockLanguageModelV3.
 *
 * [AC-AG-1] An agent defined with wa.agent({...}) replies to inbound messages in conversations
 *           with status `agent`.
 * [AC-AG-2] Tool inputs are validated against their zod schema before `run`; each tool receives
 *           { input, contact, conversation, account }.
 * [AC-AG-3] The agent's context includes only the last N messages of the current conversation
 *           (default 20) and the linked app entity.
 * [AC-AG-4] Consecutive inbound messages in one conversation are handled one turn at a time; a
 *           message arriving during a turn is included in the next turn.
 * [AC-AG-5] maxStepsPerTurn (default 5) and maxMessagesPerMinutePerContact (default 10) are
 *           enforced; messages over the limit are stored but not answered.
 * [AC-AG-6] Handoff sets status `human`, resolves the assignee, fires `handoff`, and the agent
 *           stays silent until the conversation returns to `agent`.
 * [AC-AG-7] Images reach the agent as image parts (vision) and fire the app's `message` event.
 * [AC-AG-8] If the model provider fails, the error is logged, an optional fallback is sent, and
 *           the conversation is not stuck locked.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HANDOFF_TOOL_NAME } from "../../src/agents/prompt";
import { agentTool } from "../../src/agents/runtime";
import {
  promptOf,
  scriptedModel,
  storeInbound,
  systemOf,
  textResult,
  textWebhook,
  toolCallResult,
  transcript,
} from "../../src/agents/test-helpers";
import type { AgentDefinition } from "../../src/agents/types";
import type { HandoffEvent } from "../../src/core/events";
import {
  acceptSends,
  accountInput,
  useGraphServer,
  type ClientOptions,
} from "../../src/core/test-utils";
import { FIXTURE_IDS } from "../support/fixtures";
import { createHarness, freshFixture, mediaHandlers } from "./harness";

const graph = useGraphServer();

async function setup(options: ClientOptions = {}) {
  const sent: unknown[] = [];
  graph.server.use(acceptSends(sent), ...mediaHandlers());
  const h = await createHarness(options);
  return { ...h, sent };
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
const text = (body: string) => textWebhook({ id: `wamid.AG${String(++seq)}`, body });

describe("Agents", () => {
  it("[AC-AG-1] replies to inbound messages in `agent` conversations only", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("¡Hola! ¿En qué te ayudo?"));
    h.wa.agent(agent({ model }));

    await h.deliver(text("Buenas"));
    expect(h.messages("out")).toEqual([
      expect.objectContaining({
        sender: "agent",
        senderRef: "recepcion",
        text: "¡Hola! ¿En qué te ayudo?",
        status: "sent",
      }),
    ]);
    expect(h.sent).toEqual([
      expect.objectContaining({
        to: `+${FIXTURE_IDS.waId}`,
        text: { body: "¡Hola! ¿En qué te ayudo?" },
      }),
    ]);

    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    await h.wa.conversations.assign(conversationId, "operador-1");
    await h.deliver(text("¿Siguen ahí?"));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("out")).toHaveLength(1);
  });

  it("[AC-AG-2] validates tool input before run and passes { input, contact, conversation, account }", async () => {
    const h = await setup();
    const run = vi.fn(({ input }: { input: { fecha: string } }) =>
      Promise.resolve({ libre: [`${input.fecha} 09:00`] }),
    );
    const model = scriptedModel(
      toolCallResult("buscar_horarios", { fecha: 20261007 }, "bad"),
      toolCallResult("buscar_horarios", { fecha: "2026-10-07" }, "good"),
      textResult("Tengo las 09:00."),
    );
    h.wa.agent(
      agent({
        model,
        tools: { buscar_horarios: agentTool({ input: z.object({ fecha: z.string() }), run }) },
      }),
    );

    await h.deliver(text("¿Hay espacio mañana?"));

    expect(run).toHaveBeenCalledTimes(1);
    const ctx = run.mock.calls[0]?.[0] as unknown as Record<
      string,
      { id?: string; status?: string } | undefined
    >;
    expect(ctx.input).toEqual({ fecha: "2026-10-07" });
    expect(ctx.account?.id).toBe(h.account.id);
    expect(ctx.contact?.id).toBe([...h.adapter.__state.contacts.keys()][0]);
    expect(ctx.conversation).toMatchObject({
      id: h.messages("in")[0]?.conversationId,
      status: "agent",
    });
    const firstToolResult = promptOf(model, 1).find((m) => m.role === "tool");
    expect(firstToolResult?.content[0]).toMatchObject({
      toolCallId: "bad",
      output: { type: "error-text" },
    });
    expect(h.messages("out").map((m) => m.text)).toEqual(["Tengo las 09:00."]);
  });

  it("[AC-AG-3] context is the last 20 messages of this conversation plus the linked app entity", async () => {
    const h = await setup({ linkContact: () => "pac_001" });
    const model = scriptedModel(textResult("ok"));
    h.wa.agent(agent({ model, maxMessagesPerMinutePerContact: 1000 }));
    const other = await h.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OTHER", wabaId: "WABA_O", tokenRef: "WA_TOKEN_B" }),
    );
    await storeInbound(h.ctx, h.account, { phone: "+50255559999", text: "SECRETO otro contacto" });
    await storeInbound(h.ctx, other, { text: "SECRETO otra cuenta" });
    for (let n = 1; n <= 24; n++) await storeInbound(h.ctx, h.account, { text: `m${String(n)}` });

    await h.deliver(text("m25"));

    expect(model.doGenerateCalls).toHaveLength(1);
    const lines = transcript(model);
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe("user: m6");
    expect(lines.at(-1)).toBe("user: m25");
    expect(JSON.stringify(promptOf(model))).not.toContain("SECRETO");
    expect(systemOf(model)).toContain("pac_001");
  });

  it("[AC-AG-3] a custom historyLimit narrows the context", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("ok"));
    h.wa.agent(agent({ model, historyLimit: 2, maxMessagesPerMinutePerContact: 1000 }));
    for (const body of ["a", "b", "c"]) await storeInbound(h.ctx, h.account, { text: body });
    await h.deliver(text("d"));
    expect(transcript(model)).toEqual(["user: c", "user: d"]);
  });

  it("[AC-AG-4] a message arriving during a turn is answered in the next turn", async () => {
    const h = await setup();
    let injected = false;
    const model = scriptedModel(async () => {
      if (!injected) {
        injected = true;
        await h.deliver(text("y para mañana"));
      }
      return textResult("primera");
    }, textResult("segunda"));
    h.wa.agent(agent({ model }));

    await h.deliver(text("quiero una cita"));

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(transcript(model, 0)).toEqual(["user: quiero una cita"]);
    expect(transcript(model, 1)).toEqual([
      "user: quiero una cita",
      "assistant: primera",
      "user: y para mañana",
    ]);
    expect(h.messages("out").map((m) => m.text)).toEqual(["primera", "segunda"]);
  });

  it("[AC-AG-4] concurrent webhooks for one conversation never run overlapping turns", async () => {
    const h = await setup();
    let active = 0;
    let maxActive = 0;
    const model = scriptedModel(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active--;
      return textResult("ok");
    });
    h.wa.agent(agent({ model }));

    await Promise.all([h.deliver(text("uno")), h.deliver(text("dos")), h.deliver(text("tres"))]);

    expect(maxActive).toBe(1);
    const seen = model.doGenerateCalls.map((_, i) => transcript(model, i).join("\n")).join("\n");
    for (const body of ["uno", "dos", "tres"]) expect(seen).toContain(body);
    expect(model.doGenerateCalls.length).toBeLessThanOrEqual(3);
    expect(transcript(model, model.doGenerateCalls.length - 1)).toEqual(
      expect.arrayContaining(["user: uno", "user: dos", "user: tres"]),
    );
  });

  it("[AC-AG-5] maxStepsPerTurn defaults to 5 and can be lowered", async () => {
    for (const [maxStepsPerTurn, expected] of [
      [undefined, 5],
      [2, 2],
    ] as const) {
      const h = await setup();
      const run = vi.fn(() => Promise.resolve("nada"));
      const model = scriptedModel(toolCallResult("buscar", { q: "x" }));
      h.wa.agent(
        agent({
          model,
          maxStepsPerTurn,
          tools: { buscar: agentTool({ input: z.object({ q: z.string() }), run }) },
        }),
      );
      await h.deliver(text("busca"));
      expect(model.doGenerateCalls).toHaveLength(expected);
      expect(run).toHaveBeenCalledTimes(expected);
    }
  });

  it("[AC-AG-5] maxMessagesPerMinutePerContact defaults to 10; extra messages are stored, not answered", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("ok"));
    h.wa.agent(agent({ model }));
    for (let n = 1; n <= 11; n++) await h.deliver(text(`mensaje ${String(n)}`));

    expect(h.messages("in")).toHaveLength(11);
    expect(model.doGenerateCalls).toHaveLength(10);
    expect(h.messages("out")).toHaveLength(10);
    expect(h.logs.of("warn").some((l) => l.includes("rate limit"))).toBe(true);
  });

  it("[AC-AG-6] handoff → human, assignee, handoff event, silence until returned to agent", async () => {
    const h = await setup({ resolveHandoffTargets: () => ["user-ana"] });
    const handoffs: HandoffEvent[] = [];
    h.wa.on("handoff", (e) => {
      handoffs.push(e);
    });
    const model = scriptedModel(
      toolCallResult(HANDOFF_TOOL_NAME, { motivo: "Pide hablar con el doctor" }),
      textResult("De vuelta contigo."),
    );
    h.wa.agent(
      agent({
        model,
        handoff: { when: "pide un doctor", to: "doctores", message: "Te paso con el equipo." },
      }),
    );

    await h.deliver(text("Quiero hablar con el doctor"));
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    expect(await h.wa.conversations.get(conversationId)).toMatchObject({
      status: "human",
      assignedTo: "user-ana",
      handoffReason: "Pide hablar con el doctor",
    });
    expect(handoffs).toEqual([
      expect.objectContaining({ reason: "Pide hablar con el doctor", assignees: ["user-ana"] }),
    ]);
    expect(h.messages("out").map((m) => [m.sender, m.text])).toEqual([
      ["system", "Te paso con el equipo."],
    ]);

    await h.deliver(text("¿Hola?"));
    await h.deliver(text("¿Alguien?"));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("out")).toHaveLength(1);

    await h.wa.conversations.returnToAgent(conversationId);
    await h.deliver(text("Gracias"));
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(h.messages("out").at(-1)).toMatchObject({ sender: "agent", text: "De vuelta contigo." });
  });

  it("[AC-AG-7] an inbound image reaches the model as an image part and fires `message`", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("Recibí tu receta."));
    h.wa.agent(agent({ model }));

    await h.deliver(freshFixture("image"));

    expect(h.messageEvents).toHaveLength(1);
    expect(h.messageEvents[0]?.message).toMatchObject({
      type: "image",
      media: { downloadStatus: "done", mimeType: "image/jpeg" },
    });
    const user = promptOf(model).find((m) => m.role === "user");
    const parts = user?.role === "user" ? user.content : [];
    expect(parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "file", mediaType: "image/jpeg" })]),
    );
    expect(h.messages("out").map((m) => m.text)).toEqual(["Recibí tu receta."]);
  });

  it("[AC-AG-8] a provider failure is logged, the fallback is sent and the next message is answered", async () => {
    const h = await setup();
    let calls = 0;
    const model = scriptedModel(() => {
      calls++;
      if (calls === 1) throw new Error("provider 503");
      return textResult("Ya estoy de vuelta.");
    });
    h.wa.agent(agent({ model, fallbackMessage: "Disculpa, intenta de nuevo." }));

    await h.deliver(text("hola"));
    expect(h.logs.of("error").some((l) => l.includes("provider 503"))).toBe(true);
    expect(h.messages("out")).toEqual([
      expect.objectContaining({ sender: "agent", text: "Disculpa, intenta de nuevo." }),
    ]);
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    expect((await h.wa.conversations.get(conversationId))?.status).toBe("agent");
    expect(h.adapter.__state.locks.has(`conv:${conversationId}`)).toBe(false);

    await h.deliver(text("¿sigues?"));
    expect(h.messages("out").map((m) => m.text)).toEqual([
      "Disculpa, intenta de nuevo.",
      "Ya estoy de vuelta.",
    ]);
  });
});
