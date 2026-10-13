import { describe, expect, it } from "vitest";
import type { ConversationStatusEvent, HandoffEvent } from "./events";
import {
  accountInput,
  acceptSends,
  makeClient,
  openConversation,
  useGraphServer,
} from "./test-utils";

const graph = useGraphServer();

async function setup(options: Parameters<typeof makeClient>[0] = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(accountInput());
  const statusEvents: ConversationStatusEvent[] = [];
  const handoffs: HandoffEvent[] = [];
  client.sendo.on("conversation.status", (e) => {
    statusEvents.push(e);
  });
  client.sendo.on("handoff", (e) => {
    handoffs.push(e);
  });
  const { contact, conversation } = await openConversation(client.ctx, account);
  return { ...client, account, contact, conversation, statusEvents, handoffs };
}

describe("services.conversations.ensure", () => {
  it("advances the window, activity and unread count on inbound", async () => {
    const { ctx, account, contact, conversation } = await setup();
    expect(conversation.unreadCount).toBe(1);
    const at = new Date();
    const { conversation: updated } = await ctx.services.conversations.ensure({
      account,
      contact,
      inbound: { at },
    });
    expect(updated).toMatchObject({
      id: conversation.id,
      lastInboundAt: at,
      lastActivityAt: at,
      windowExpiresAt: new Date(at.getTime() + 24 * 60 * 60 * 1000),
      unreadCount: 2,
    });

    const older = new Date(at.getTime() - 60_000);
    const { conversation: late } = await ctx.services.conversations.ensure({
      account,
      contact,
      inbound: { at: older },
    });
    expect(late.lastInboundAt).toEqual(at);
    expect(late.unreadCount).toBe(3);
  });
});

describe("services.contacts.ensure", () => {
  it("logs linkContact failures and keeps the contact", async () => {
    const client = makeClient({
      linkContact: () => {
        throw new Error("db down");
      },
    });
    const account = await client.adapter.accounts.insert(accountInput());
    const { contact, created } = await client.ctx.services.contacts.ensure({
      account,
      phone: "+50255550001",
    });
    expect(created).toBe(true);
    expect(contact.appRef).toBeNull();
    expect(client.logs.of("error")[0]).toContain("linkContact");
  });
});

describe("sendo.conversations", () => {
  it("leaves assignedTo empty with several targets and honours a custom or null message", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const { sendo, conversation, handoffs } = await setup({
      resolveHandoffTargets: () => ["admin-1", "admin-2"],
      handoffMessage: "Un momento por favor.",
    });
    const updated = await sendo.conversations.handoff(conversation.id, { reason: "x" });
    expect(updated.assignedTo).toBeNull();
    expect(handoffs[0]?.assignees).toEqual(["admin-1", "admin-2"]);
    expect(bodies).toEqual([expect.objectContaining({ text: { body: "Un momento por favor." } })]);

    await sendo.conversations.returnToAgent(conversation.id);
    await sendo.conversations.handoff(conversation.id, { reason: "y", message: null });
    expect(bodies).toHaveLength(1);
    expect(handoffs).toHaveLength(2);
  });

  it("still hands off when the message cannot be sent (window closed)", async () => {
    const client = makeClient();
    const account = await client.adapter.accounts.insert(accountInput());
    const { conversation } = await openConversation(client.ctx, account, "+50255550001", 25 * 60);
    const handoffs: HandoffEvent[] = [];
    client.sendo.on("handoff", (e) => {
      handoffs.push(e);
    });
    const updated = await client.sendo.conversations.handoff(conversation.id, { reason: "z" });
    expect(updated.status).toBe("human");
    expect(handoffs).toHaveLength(1);
    expect(graph.requests).toHaveLength(0);
    expect(client.logs.of("warn")[0]).toContain("handoff message");
  });
});
