import { describe, expect, it } from "vitest";
import { RecordNotFoundError, WindowClosedError } from "../errors/errors";
import { createReply } from "./reply";
import {
  accountInput,
  acceptSends,
  makeClient,
  openConversation,
  useGraphServer,
} from "./test-utils";

const graph = useGraphServer();

async function setup(minutesAgo = 1) {
  const client = makeClient();
  const account = await client.adapter.accounts.insert(accountInput());
  const { contact, conversation } = await openConversation(
    client.ctx,
    account,
    "+50255550001",
    minutesAgo,
  );
  const message = await client.adapter.messages.insertInbound({
    tenantId: account.tenantId,
    conversationId: conversation.id,
    type: "text",
    content: { body: "hola" },
    text: "hola",
    metaMessageId: "wamid.IN1",
    sentAt: new Date(),
  });
  if (!message) throw new Error("seed failed");
  const reply = createReply(client.ctx, {
    account,
    contact,
    conversation,
    sender: "agent",
    senderRef: "recepcion",
    message,
  });
  return { ...client, account, contact, conversation, message, reply };
}

describe("createReply", () => {
  it("sends every kind into the bound conversation with the bound sender", async () => {
    const bodies: Record<string, unknown>[] = [];
    graph.server.use(acceptSends(bodies));
    const { reply, conversation, adapter } = await setup();

    await reply.text("Hola, ¿en qué te ayudo?", { replyTo: "wamid.IN1" });
    await reply.media({ type: "image", url: "https://cdn.example.com/x.png" });
    await reply.buttons({ body: "¿Sí?", buttons: [{ id: "y", title: "Sí" }] });
    await reply.list({
      body: "Elige",
      button: "Ver",
      sections: [{ rows: [{ id: "1", title: "Uno" }] }],
    });
    await reply.react("👍");
    await reply.markRead();

    expect(bodies.map((b) => b.type ?? b.status)).toEqual([
      "text",
      "image",
      "interactive",
      "interactive",
      "reaction",
      "read",
    ]);
    expect(bodies[4]).toMatchObject({ reaction: { message_id: "wamid.IN1", emoji: "👍" } });
    expect(bodies[5]).toMatchObject({ message_id: "wamid.IN1" });
    const items = (await adapter.messages.thread(conversation.id, { limit: 10 })).items;
    const outbound = items.filter((m) => m.direction === "out");
    expect(outbound).toHaveLength(5);
    expect(outbound.every((m) => m.sender === "agent" && m.senderRef === "recepcion")).toBe(true);
  });

  it("reacts to another message by wa-li id", async () => {
    const bodies: Record<string, unknown>[] = [];
    graph.server.use(acceptSends(bodies));
    const { reply } = await setup();
    const sent = await reply.text("uno");
    await reply.react("❤️", sent.id);
    expect(bodies[1]).toMatchObject({ reaction: { message_id: sent.metaMessageId } });
    await expect(reply.react("x", "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it("enforces the window for free-form replies but not templates", async () => {
    graph.server.use(acceptSends());
    const { reply, adapter, account } = await setup(25 * 60);
    await expect(reply.text("tarde")).rejects.toBeInstanceOf(WindowClosedError);
    expect(graph.requests).toHaveLength(0);
    await adapter.templates.upsertMany(account.id, [
      {
        name: "seguimiento",
        language: "es",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Hola" }],
        variableCount: 0,
      },
    ]);
    await expect(reply.template("seguimiento", { language: "es" })).resolves.toMatchObject({
      type: "template",
      sender: "agent",
      status: "sent",
    });
  });
});
