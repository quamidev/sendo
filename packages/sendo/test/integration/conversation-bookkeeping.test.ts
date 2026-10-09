/**
 * Product spec — AC-CH-2: the v1 conversation columns the inbox, rules and metrics build on.
 * End to end through sendo.handleWebhook (signed payloads), the agent runtime (scripted model)
 * and the public sendo.send / sendo.conversations / sendo.inbox APIs, on the memory adapter.
 *
 * [CB-1] awaitingReplySince is set by the first unanswered inbound, kept by later inbounds and by
 *        system messages, cleared by a human reply, set again by the next inbound and cleared by
 *        an agent reply.
 * [CB-2] everHuman turns true the first time the conversation moves to `human` and stays true
 *        after it returns to the agent or closes.
 * [CB-3] assignedAt is set when assignedTo changes to a user, moves on reassignment, and is
 *        cleared when the conversation is unassigned or returned to the agent.
 */
import { describe, expect, it } from "vitest";
import { scriptedModel, textResult, textWebhook } from "../../src/agents/test-helpers";
import { acceptSends, useGraphServer } from "../../src/core/test-utils";
import { FIXTURE_IDS } from "../support/fixtures";
import { createHarness } from "./harness";

const graph = useGraphServer();
const MINUTE_MS = 60_000;
const TENANT = { tenantId: "tenant-a" };

let seq = 0;
const inbound = (body: string, minutesAgo: number) =>
  textWebhook({
    id: `wamid.CB${String(++seq)}`,
    body,
    timestamp: new Date(Date.now() - minutesAgo * MINUTE_MS),
  });

async function setup() {
  graph.server.use(acceptSends());
  const h = await createHarness();
  const conversation = async () => {
    const id = h.messages("in")[0]?.conversationId;
    if (id === undefined) throw new Error("no inbound message yet");
    const found = await h.sendo.conversations.get(id);
    if (!found) throw new Error(`conversation ${id} missing`);
    return found;
  };
  return { ...h, conversation };
}

describe("Conversation bookkeeping", () => {
  it("[CB-1] awaitingReplySince tracks the oldest unanswered inbound", async () => {
    const h = await setup();
    await h.deliver(inbound("Hola", 10));
    const first = (await h.conversation()).awaitingReplySince;
    expect(first).toBeInstanceOf(Date);
    expect(Math.abs((first?.getTime() ?? 0) - (Date.now() - 10 * MINUTE_MS))).toBeLessThan(2_000);

    await h.deliver(inbound("¿Hay alguien?", 5));
    expect((await h.conversation()).awaitingReplySince).toEqual(first);

    await h.sendo.send.text(`+${FIXTURE_IDS.waId}`, "Recordatorio de tu cita");
    expect((await h.conversation()).awaitingReplySince).toEqual(first);

    const { id } = await h.conversation();
    await h.sendo.inbox.reply(
      id,
      { kind: "text", body: "Hola, soy Luis" },
      {
        userId: "user-luis",
        ...TENANT,
      },
    );
    expect((await h.conversation()).awaitingReplySince).toBeNull();

    await h.deliver(inbound("Gracias, otra pregunta", 1));
    expect((await h.conversation()).awaitingReplySince).toBeInstanceOf(Date);

    h.sendo.agent({
      name: "recepcion",
      model: scriptedModel(textResult("Con gusto te ayudo")),
      instructions: "Eres la recepcionista.",
    });
    await h.deliver(inbound("¿Abren el sábado?", 0));
    expect(h.messages("out").at(-1)).toMatchObject({ sender: "agent", status: "sent" });
    expect((await h.conversation()).awaitingReplySince).toBeNull();
  });

  it("[CB-2] everHuman stays true once the conversation was handed to a person", async () => {
    const h = await setup();
    await h.deliver(inbound("Hola", 2));
    const { id } = await h.conversation();
    expect((await h.conversation()).everHuman).toBe(false);

    await h.sendo.conversations.close(id);
    expect((await h.conversation()).everHuman).toBe(false);
    await h.deliver(inbound("Sigo aquí", 1));

    const conversation = await h.sendo.conversations.handoff(id, { reason: "pidió humano" });
    expect(conversation).toMatchObject({ status: "human", everHuman: true });
    await h.sendo.conversations.returnToAgent(id);
    await h.sendo.conversations.close(id);
    expect(await h.conversation()).toMatchObject({ status: "closed", everHuman: true });
  });

  it("[CB-3] assignedAt follows assignedTo", async () => {
    const h = await setup();
    await h.deliver(inbound("Hola", 2));
    const { id } = await h.conversation();
    expect((await h.conversation()).assignedAt).toBeNull();

    const before = Date.now();
    const taken = await h.sendo.conversations.assign(id, "user-luis");
    expect(taken).toMatchObject({ assignedTo: "user-luis", everHuman: true });
    expect(taken.assignedAt?.getTime()).toBeGreaterThanOrEqual(before);

    const same = await h.sendo.conversations.assign(id, "user-luis");
    expect(same.assignedAt).toEqual(taken.assignedAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const moved = await h.sendo.conversations.assign(id, "user-ana");
    expect(moved.assignedAt?.getTime()).toBeGreaterThan(taken.assignedAt?.getTime() ?? 0);

    expect((await h.sendo.conversations.assign(id, null)).assignedAt).toBeNull();
    await h.sendo.conversations.assign(id, "user-ana");
    expect((await h.sendo.conversations.returnToAgent(id)).assignedAt).toBeNull();
  });
});
