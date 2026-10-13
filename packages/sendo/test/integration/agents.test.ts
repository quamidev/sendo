/**
 * Product spec — Acceptance Criteria — "Agents". Every test goes end to end through
 * sendo.handleWebhook (signed payload → pipeline → agent runtime → Graph send) with a scripted
 * MockLanguageModelV3.
 *
 * [AC-AG-1] An agent defined with sendo.agent({...}) replies to inbound messages in conversations
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
 * [AC-PL-3] The built-in handoff message ignores `createSendo({ locale })` (English by default,
 *           Spanish with "es"), or beats an explicit `handoffMessage` / `handoff.message`.
 *
 * Product spec 2.5 "Agents per tenant" and AC-IB-2 (runtime side of the agent pause):
 * [AC-AT-1] `tenants` is ANDed with `accounts`; one definition serves many tenants with
 *           per-tenant instructions; the static overlap check considers both arrays.
 * [AC-IB-2] No turn runs while `account.agentPaused`, `conversation.agentPaused` or a rule holds
 *           the agent; inbound is still stored and bumps unread/window; no handoff message is
 *           sent. A pause set during a running turn lets that turn finish and stops the next.
 */
import { describe, expect, it, vi } from "vitest";
import { createNoopRulesHooks } from "../../src/core/context";
import { BUILT_IN_MESSAGES } from "../../src/core/messages";
import { ConfigError } from "../../src/errors/errors";
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
    h.sendo.agent(agent({ model }));

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
    await h.sendo.conversations.assign(conversationId, "operador-1");
    await h.deliver(text("¿Siguen ahí?"));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("out").filter((m) => !m.internal)).toHaveLength(1);
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
    h.sendo.agent(
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
    h.sendo.agent(agent({ model, maxMessagesPerMinutePerContact: 1000 }));
    const other = await h.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OTHER", wabaId: "WABA_O", tokenRef: "SENDO_TOKEN_B" }),
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
    h.sendo.agent(agent({ model, historyLimit: 2, maxMessagesPerMinutePerContact: 1000 }));
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
    h.sendo.agent(agent({ model }));

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
    h.sendo.agent(agent({ model }));

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
      h.sendo.agent(
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
    h.sendo.agent(agent({ model }));
    for (let n = 1; n <= 11; n++) await h.deliver(text(`mensaje ${String(n)}`));

    expect(h.messages("in")).toHaveLength(11);
    expect(model.doGenerateCalls).toHaveLength(10);
    expect(h.messages("out")).toHaveLength(10);
    expect(h.logs.of("warn").some((l) => l.includes("rate limit"))).toBe(true);
  });

  it("[AC-AG-6] handoff → human, assignee, handoff event, silence until returned to agent", async () => {
    const h = await setup({ resolveHandoffTargets: () => ["user-ana"] });
    const handoffs: HandoffEvent[] = [];
    h.sendo.on("handoff", (e) => {
      handoffs.push(e);
    });
    const model = scriptedModel(
      toolCallResult(HANDOFF_TOOL_NAME, { motivo: "Pide hablar con el doctor" }),
      textResult("De vuelta contigo."),
    );
    h.sendo.agent(
      agent({
        model,
        handoff: { when: "pide un doctor", to: "doctores", message: "Te paso con el equipo." },
      }),
    );

    await h.deliver(text("Quiero hablar con el doctor"));
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    expect(await h.sendo.conversations.get(conversationId)).toMatchObject({
      status: "human",
      assignedTo: "user-ana",
      handoffReason: "Pide hablar con el doctor",
    });
    expect(handoffs).toEqual([
      expect.objectContaining({ reason: "Pide hablar con el doctor", assignees: ["user-ana"] }),
    ]);
    expect(h.messages("out").map((m) => [m.sender, m.internal, m.text])).toEqual([
      [
        "system",
        true,
        "The agent recepcion handed the conversation to a person · Pide hablar con el doctor · Assigned to user-ana",
      ],
      ["system", false, "Te paso con el equipo."],
    ]);
    expect(h.messages("out")[0]?.metadata).toMatchObject({
      kind: "system",
      event: "handoff",
      by: "agent:recepcion",
      reason: "Pide hablar con el doctor",
      assignedTo: "user-ana",
    });

    await h.deliver(text("¿Hola?"));
    await h.deliver(text("¿Alguien?"));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("out").filter((m) => !m.internal)).toHaveLength(1);

    await h.sendo.conversations.returnToAgent(conversationId);
    await h.deliver(text("Gracias"));
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(h.messages("out").at(-1)).toMatchObject({ sender: "agent", text: "De vuelta contigo." });
  });

  it("[AC-PL-3] the built-in handoff message follows `locale`; explicit messages still win", async () => {
    const cases: [ClientOptions, { message?: string }, string][] = [
      [{}, {}, BUILT_IN_MESSAGES.en.handoff],
      [{ locale: "en" }, {}, "Connecting you with someone from the team."],
      [{ locale: "es" }, {}, "Te comunico con una persona del equipo."],
      [{ locale: "es", handoffMessage: "Ya te atiende alguien." }, {}, "Ya te atiende alguien."],
      [{ locale: "en" }, { message: "Un momento, por favor." }, "Un momento, por favor."],
    ];
    for (const [options, handoff, expected] of cases) {
      const h = await setup(options);
      h.sendo.agent(
        agent({
          model: scriptedModel(toolCallResult(HANDOFF_TOOL_NAME, { motivo: "Pide una persona" })),
          handoff: { when: "pide una persona", to: "recepcion", ...handoff },
        }),
      );
      await h.deliver(text("Quiero hablar con una persona"));
      expect(
        h
          .messages("out")
          .filter((m) => !m.internal)
          .map((m) => [m.sender, m.text]),
      ).toEqual([["system", expected]]);
    }
    await expect(createHarness({ locale: "fr" as "es" })).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });

  it("[AC-AG-7] an inbound image reaches the model as an image part and fires `message`", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("Recibí tu receta."));
    h.sendo.agent(agent({ model }));

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
    h.sendo.agent(agent({ model, fallbackMessage: "Disculpa, intenta de nuevo." }));

    await h.deliver(text("hola"));
    expect(h.logs.of("error").some((l) => l.includes("provider 503"))).toBe(true);
    expect(h.messages("out")).toEqual([
      expect.objectContaining({ sender: "agent", text: "Disculpa, intenta de nuevo." }),
    ]);
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    expect((await h.sendo.conversations.get(conversationId))?.status).toBe("agent");
    expect(h.adapter.__state.locks.has(`conv:${conversationId}`)).toBe(false);

    await h.deliver(text("¿sigues?"));
    expect(h.messages("out").map((m) => m.text)).toEqual([
      "Disculpa, intenta de nuevo.",
      "Ya estoy de vuelta.",
    ]);
  });

  it("[AC-AT-1] one definition serves many tenants with per-tenant instructions", async () => {
    const h = await setup();
    await h.adapter.accounts.insert(
      accountInput({
        tenantId: "tenant-b",
        phoneNumberId: "PN_B",
        wabaId: "WABA_B",
        tokenRef: "SENDO_TOKEN_B",
      }),
    );
    await h.adapter.accounts.insert(
      accountInput({
        tenantId: "tenant-c",
        phoneNumberId: "PN_C",
        wabaId: "WABA_C",
        tokenRef: "SENDO_TOKEN_B",
      }),
    );
    const clinics: Record<string, string> = {
      "tenant-a": "Clínica Norte",
      "tenant-b": "Clínica Sur",
    };
    const shared = scriptedModel(textResult("ok"));
    const other = scriptedModel(textResult("otro"));
    h.sendo.agent(
      agent({
        model: shared,
        tenants: ["tenant-a", "tenant-b"],
        instructions: ({ account }) =>
          `Eres la recepcionista de ${clinics[account.tenantId ?? ""] ?? "?"}.`,
      }),
    );
    h.sendo.agent(
      agent({ name: "otro", model: other, tenants: (tenant) => tenant === "tenant-c" }),
    );

    await h.deliver(text("hola"));
    await h.deliver(textWebhook({ id: "wamid.AT_B", body: "hola", phoneNumberId: "PN_B" }));
    await h.deliver(textWebhook({ id: "wamid.AT_C", body: "hola", phoneNumberId: "PN_C" }));

    expect(shared.doGenerateCalls).toHaveLength(2);
    expect(systemOf(shared, 0)).toContain("Clínica Norte");
    expect(systemOf(shared, 1)).toContain("Clínica Sur");
    expect(other.doGenerateCalls).toHaveLength(1);
  });

  it("[AC-AT-1] tenants AND accounts: a matching tenant on a filtered-out account gets no turn", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("ok"));
    h.sendo.agent(agent({ model, accounts: ["PN_ELSEWHERE"], tenants: ["tenant-a"] }));
    await h.deliver(text("hola"));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(h.messages("in")).toHaveLength(1);
  });

  it("[AC-AT-1] the static overlap check considers accounts and tenants arrays", async () => {
    const h = await setup();
    h.sendo.agent(agent({ name: "a", tenants: ["tenant-a"] }));
    expect(() => h.sendo.agent(agent({ name: "b", tenants: ["tenant-a", "tenant-b"] }))).toThrow(
      ConfigError,
    );
    expect(() => h.sendo.agent(agent({ name: "c" }))).toThrow(/same accounts and tenants/);
    expect(() => h.sendo.agent(agent({ name: "d", tenants: ["tenant-b", null] }))).not.toThrow();
    expect(() =>
      h.sendo.agent(agent({ name: "e", accounts: ["PN_X"], tenants: ["tenant-a"] })),
    ).toThrow(ConfigError);
    expect(() => h.sendo.agent(agent({ name: "f", tenants: [""] }))).toThrow(/tenants/);
    expect(() =>
      h.sendo.agent(agent({ name: "g", tenants: ["tenant-z"], mode: "manual" as "auto" })),
    ).toThrow(/mode/);
  });

  it("[AC-IB-2] account.agentPaused skips the turn; inbound is stored, unread and window move", async () => {
    const h = await setup({ handoffMessage: "Te paso con el equipo." });
    const model = scriptedModel(textResult("¡Hola!"));
    h.sendo.agent(agent({ model }));
    await h.sendo.accounts.pauseAgent(h.account.id, true);

    await h.deliver(text("hola"));
    await h.deliver(text("¿hay alguien?"));

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(h.messages("in")).toHaveLength(2);
    expect(h.messages("out")).toEqual([]);
    expect(h.sent).toEqual([]);
    const conversation = await h.sendo.conversations.get(h.messages("in")[0]?.conversationId ?? "");
    expect(conversation).toMatchObject({ status: "agent", unreadCount: 2 });
    expect((await h.sendo.conversations.windowStatus(conversation?.id ?? "")).open).toBe(true);

    await h.sendo.accounts.pauseAgent(h.account.id, false);
    await h.deliver(text("¿ahora sí?"));
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("[AC-IB-2] conversation.agentPaused and a rule holding the agent skip the turn", async () => {
    const h = await setup();
    const model = scriptedModel(textResult("ok"));
    h.sendo.agent(agent({ model }));
    await h.deliver(text("hola"));
    expect(model.doGenerateCalls).toHaveLength(1);
    const conversationId = h.messages("in")[0]?.conversationId ?? "";

    await h.adapter.conversations.update(conversationId, { agentPaused: true });
    await h.deliver(text("sigo aquí"));
    expect(model.doGenerateCalls).toHaveLength(1);

    await h.adapter.conversations.update(conversationId, { agentPaused: false });
    const held: string[] = [];
    h.ctx.rulesHooks = {
      ...createNoopRulesHooks(),
      holdsAgent: ({ conversation }) => {
        held.push(conversation.id);
        return Promise.resolve(true);
      },
    };
    await h.deliver(text("fuera de horario"));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(held).toContain(conversationId);
    expect(h.messages("in")).toHaveLength(3);
  });

  it("[AC-IB-2] a pause during a running turn lets it finish; the next turn does not run", async () => {
    const h = await setup();
    let injected = false;
    const model = scriptedModel(async () => {
      if (!injected) {
        injected = true;
        await h.sendo.accounts.pauseAgent(h.account.id, true);
        await h.deliver(text("y otra cosa"));
      }
      return textResult("primera");
    }, textResult("segunda"));
    h.sendo.agent(agent({ model }));

    await h.deliver(text("quiero una cita"));

    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("out").map((m) => m.text)).toEqual(["primera"]);
    expect(h.messages("in")).toHaveLength(2);
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    expect(h.adapter.__state.locks.has(`conv:${conversationId}`)).toBe(false);
  });
});
