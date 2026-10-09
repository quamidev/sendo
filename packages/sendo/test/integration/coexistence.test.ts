/**
 * Product spec — 2.6 Coexistence. Every test goes end to end through sendo.handleWebhook with
 * signed fixtures shaped from Meta's coexistence docs (`smb_message_echoes`, `history`), the
 * memory adapter, msw for the Graph API and a scripted model.
 *
 * [AC-CX-2] A phone-app echo is stored as an outbound `human` message (`senderRef` and
 *           `metadata.origin` "business_app", status `sent`, its Meta id), updates activity and
 *           never `lastInboundAt`, the window or unread; repeated echoes are stored once.
 * [AC-CX-3] An echo in an `agent` conversation pauses the agent there (default
 *           `pauseAgentOnPhoneReply: true`) and emits `conversation.agent_paused` by
 *           "business_app"; a later inbound is stored and bumps unread/window but gets no AI turn.
 * [AC-CX-4] With `importHistory`, `history` messages are stored with `metadata.imported = true`
 *           and never trigger the agent; with the flag off (default) they are acknowledged and
 *           ignored.
 */
import { describe, expect, it } from "vitest";
import { scriptedModel, textResult, textWebhook } from "../../src/agents/test-helpers";
import type { ConversationAgentPausedEvent } from "../../src/team/events";
import { acceptSends, useGraphServer, type ClientOptions } from "../../src/core/test-utils";
import { FIXTURE_IDS, loadWebhookFixtureText } from "../support/fixtures";
import { createHarness, mediaHandlers } from "./harness";

const graph = useGraphServer();

async function setup(options: ClientOptions = {}) {
  const sent: unknown[] = [];
  graph.server.use(acceptSends(sent), ...mediaHandlers());
  const h = await createHarness(options);
  const paused: ConversationAgentPausedEvent[] = [];
  h.sendo.on("conversation.agent_paused", (e) => {
    paused.push(e);
  });
  return { ...h, sent, paused };
}

interface EchoPatch {
  id?: string;
  body?: string;
  to?: string;
  /** Default now. */
  at?: Date;
  phoneNumberId?: string;
}

/** The `coexistence-echo` fixture with another id/body/recipient/timestamp. */
function echoWebhook(patch: EchoPatch = {}): string {
  const json = JSON.parse(loadWebhookFixtureText("coexistence-echo")) as {
    entry: {
      changes: {
        value: {
          metadata: { phone_number_id: string };
          message_echoes: { id: string; to: string; timestamp: string; text: { body: string } }[];
        };
      }[];
    }[];
  };
  const value = json.entry[0]?.changes[0]?.value;
  const echo = value?.message_echoes[0];
  if (!value || !echo) throw new Error("echo fixture changed");
  if (patch.id !== undefined) echo.id = patch.id;
  if (patch.body !== undefined) echo.text.body = patch.body;
  if (patch.to !== undefined) echo.to = patch.to;
  if (patch.phoneNumberId !== undefined) value.metadata.phone_number_id = patch.phoneNumberId;
  echo.timestamp = String(Math.floor((patch.at ?? new Date()).getTime() / 1000));
  return JSON.stringify(json);
}

/** The `coexistence-history` fixture with each history item's `threads` replaced by `errors`. */
function declinedHistoryWebhook(): string {
  const json = JSON.parse(loadWebhookFixtureText("coexistence-history")) as {
    entry: { changes: { value: { history: Record<string, unknown>[] } }[] }[];
  };
  const item = json.entry[0]?.changes[0]?.value.history[0];
  if (!item) throw new Error("history fixture changed");
  delete item.threads;
  item.errors = [
    {
      code: 2593109,
      title: "History sharing is turned off by user",
      message: "History sharing is turned off by user",
      error_data: { details: "The business declined to share its chat history." },
    },
  ];
  return JSON.stringify(json);
}

let seq = 0;
const inbound = (body: string) => textWebhook({ id: `wamid.CX${String(++seq)}`, body });
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

describe("Coexistence", () => {
  it("[AC-CX-2] stores a phone-app echo as a sent `human` message without touching the window", async () => {
    const h = await setup();
    await h.deliver(inbound("Hola, ¿tienen cita mañana?"));
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    const before = await h.sendo.conversations.get(conversationId);

    const at = later(30);
    const event = await h.deliver(echoWebhook({ at }));

    expect(event.status).toBe("processed");
    expect(h.messages("out")).toEqual([
      expect.objectContaining({
        conversationId,
        direction: "out",
        sender: "human",
        senderRef: "business_app",
        metadata: { origin: "business_app" },
        status: "sent",
        metaMessageId: FIXTURE_IDS.echoMetaId,
        text: "Hola Ana, le escribe la doctora. Mañana a las 10 está bien.",
        type: "text",
      }),
    ]);
    const after = await h.sendo.conversations.get(conversationId);
    expect(after?.lastActivityAt.getTime()).toBe(Math.floor(at.getTime() / 1000) * 1000);
    expect(after?.lastInboundAt).toEqual(before?.lastInboundAt);
    expect(after?.windowExpiresAt).toEqual(before?.windowExpiresAt);
    expect(after?.unreadCount).toBe(before?.unreadCount);
    expect(after?.awaitingReplySince).toBeNull();
    expect(h.sent).toEqual([]);
    expect(h.messageEvents).toHaveLength(1);
  });

  it("[AC-CX-2] an echo to a new contact creates the conversation with the window still closed", async () => {
    const h = await setup();
    await h.deliver(echoWebhook({ to: FIXTURE_IDS.secondWaId }));

    const [echo] = h.messages("out");
    expect(echo).toMatchObject({ sender: "human", senderRef: "business_app" });
    const conversation = await h.sendo.conversations.get(echo?.conversationId ?? "");
    expect(conversation).toMatchObject({ lastInboundAt: null, unreadCount: 0 });
    expect((await h.sendo.conversations.windowStatus(conversation?.id ?? "")).open).toBe(false);
    const contact = [...h.adapter.__state.contacts.values()][0];
    expect(contact).toMatchObject({ phone: `+${FIXTURE_IDS.secondWaId}` });
  });

  it("[AC-CX-2] a repeated echo (Meta retry, concurrent delivery, reprocess) is stored once", async () => {
    const h = await setup();
    const body = echoWebhook({ id: "wamid.ECHO_DUP" });
    await Promise.all([h.deliver(body), h.deliver(body)]);
    const third = await h.deliver(body);
    await h.sendo.events.reprocess(third.id);

    expect(h.messages("out").filter((m) => m.metaMessageId === "wamid.ECHO_DUP")).toHaveLength(1);
    expect(third.status).toBe("processed");
    expect(h.paused).toHaveLength(1);
  });

  it("[AC-CX-2] an echo for an unknown number is left unrouted", async () => {
    const h = await setup();
    const event = await h.deliver(
      echoWebhook({ phoneNumberId: FIXTURE_IDS.unroutedPhoneNumberId }),
    );
    expect(event.status).toBe("unrouted");
    expect(h.messages()).toEqual([]);
  });

  it("[AC-CX-3] an echo pauses the agent on that conversation; later inbound gets no AI turn", async () => {
    const h = await setup({ handoffMessage: "Te paso con el equipo." });
    const model = scriptedModel(textResult("¡Hola! ¿En qué te ayudo?"));
    h.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });

    await h.deliver(inbound("Hola"));
    expect(model.doGenerateCalls).toHaveLength(1);
    const conversationId = h.messages("in")[0]?.conversationId ?? "";

    await h.deliver(echoWebhook({ at: later(5) }));
    expect(h.paused).toHaveLength(1);
    expect(h.paused[0]).toMatchObject({
      paused: true,
      by: "business_app",
      conversation: { id: conversationId, agentPaused: true },
    });
    const pausedConversation = await h.sendo.conversations.get(conversationId);
    expect(pausedConversation).toMatchObject({ status: "agent", agentPaused: true });

    const nextInboundAt = later(10);
    await h.deliver(
      textWebhook({ id: "wamid.CX_AFTER", body: "¿Entonces a las 10?", timestamp: nextInboundAt }),
    );
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.messages("in")).toHaveLength(2);
    expect(h.messages("out").map((m) => [m.sender, m.senderRef])).toEqual([
      ["agent", "recepcion"],
      ["human", "business_app"],
    ]);
    const after = await h.sendo.conversations.get(conversationId);
    expect(after?.unreadCount).toBe((pausedConversation?.unreadCount ?? 0) + 1);
    expect(after?.lastInboundAt?.getTime()).toBe(Math.floor(nextInboundAt.getTime() / 1000) * 1000);
    expect(after?.windowExpiresAt?.getTime()).toBeGreaterThan(
      pausedConversation?.windowExpiresAt?.getTime() ?? 0,
    );
  });

  it("[AC-CX-3] with pauseAgentOnPhoneReply off the agent keeps answering", async () => {
    const h = await setup({ coexistence: { pauseAgentOnPhoneReply: false } });
    const model = scriptedModel(textResult("ok"));
    h.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });

    await h.deliver(inbound("Hola"));
    await h.deliver(echoWebhook({ at: later(5) }));
    await h.deliver(textWebhook({ id: "wamid.CX_ON", body: "¿Sigue ahí?", timestamp: later(10) }));

    expect(h.paused).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(2);
  });

  it("[AC-CX-3] an echo in a `human` conversation stores the message without a pause event", async () => {
    const h = await setup();
    await h.deliver(inbound("Hola"));
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    await h.sendo.conversations.assign(conversationId, "operador-1");

    await h.deliver(echoWebhook({ at: later(5) }));

    expect(h.paused).toEqual([]);
    expect(await h.sendo.conversations.get(conversationId)).toMatchObject({
      status: "human",
      agentPaused: false,
    });
    expect(h.messages("out").filter((m) => !m.internal)).toHaveLength(1);
  });

  it("[AC-CX-4] with importHistory, history is stored as imported messages and never triggers the agent", async () => {
    const h = await setup({ coexistence: { importHistory: true } });
    const model = scriptedModel(textResult("no debería responder"));
    h.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });

    const event = await h.deliver("coexistence-history");

    expect(event.status).toBe("processed");
    const stored = h.messages();
    expect(stored.map((m) => [m.direction, m.sender, m.metaMessageId, m.text])).toEqual([
      ["in", "contact", "wamid.HIST0001", "Buenos días, ¿atienden los sábados?"],
      ["out", "human", "wamid.HIST0002", "Sí, de 8 a 12."],
      ["in", "contact", "wamid.HIST0003", "Perfecto, gracias."],
    ]);
    for (const message of stored) expect(message.metadata).toMatchObject({ imported: true });
    expect(stored[1]).toMatchObject({
      senderRef: "business_app",
      metadata: { origin: "business_app", imported: true },
      status: "read",
    });
    expect(stored[0]?.sentAt).toEqual(new Date(1788600000 * 1000));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(h.messageEvents).toEqual([]);
    expect(h.sent).toEqual([]);
    const conversation = await h.sendo.conversations.get(stored[0]?.conversationId ?? "");
    expect(conversation).toMatchObject({ unreadCount: 0, lastInboundAt: null });
    expect([...h.adapter.__state.contacts.values()]).toEqual([
      expect.objectContaining({ phone: `+${FIXTURE_IDS.historyWaId}` }),
    ]);

    await h.deliver("coexistence-history");
    expect(h.messages()).toHaveLength(3);
  });

  it("[AC-CX-4] with importHistory off (default), history is acknowledged and ignored", async () => {
    const h = await setup();
    const event = await h.deliver("coexistence-history");
    expect(event.status).toBe("processed");
    expect(h.messages()).toEqual([]);
    expect(h.adapter.__state.contacts.size).toBe(0);
    expect(h.adapter.__state.conversations.size).toBe(0);
  });

  it("[AC-CX-4] a declined history share (2593109) is acknowledged without storing anything", async () => {
    const h = await setup({ coexistence: { importHistory: true } });
    const event = await h.deliver(declinedHistoryWebhook());
    expect(event.status).toBe("processed");
    expect(h.messages()).toEqual([]);
    expect(h.logs.of("info").some((line) => line.includes("2593109"))).toBe(true);
  });
});
