import { describe, expect, it } from "vitest";
import { RecordNotFoundError } from "../errors/errors";
import type { Account } from "../types/entities";
import type { ConversationStatusEvent, HandoffEvent } from "./events";
import {
  accountInput,
  acceptSends,
  makeClient,
  openConversation,
  useGraphServer,
} from "./test-utils";

const graph = useGraphServer();
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

async function setup(options: Parameters<typeof makeClient>[0] = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(accountInput());
  const statusEvents: ConversationStatusEvent[] = [];
  const handoffs: HandoffEvent[] = [];
  client.wa.on("conversation.status", (e) => {
    statusEvents.push(e);
  });
  client.wa.on("handoff", (e) => {
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

  it("emits conversation.status when a closed conversation is reopened", async () => {
    const { wa, ctx, account, contact, conversation, statusEvents } = await setup();
    await wa.conversations.close(conversation.id, { by: "user-1" });
    const result = await ctx.services.conversations.ensure({
      account,
      contact,
      inbound: { at: new Date() },
    });
    expect(result.reopened).toBe(true);
    expect(result.conversation.id).toBe(conversation.id);
    expect(statusEvents.map(({ from, to, by }) => ({ from, to, by }))).toEqual([
      { from: "agent", to: "closed", by: "user-1" },
      { from: "closed", to: "agent", by: "system" },
    ]);
  });
});

describe("services.contacts.ensure", () => {
  it("calls linkContact on create and on profile change and stores appRef", async () => {
    const calls: string[] = [];
    const client = makeClient({
      linkContact: ({ phone, account }: { phone: string; account: Account }) => {
        calls.push(`${phone}@${account.phoneNumberId}`);
        return `patient-${calls.length}`;
      },
    });
    const account = await client.adapter.accounts.insert(accountInput());
    const ensure = (input: Parameters<typeof client.ctx.services.contacts.ensure>[0]) =>
      client.ctx.services.contacts.ensure(input);
    const first = await ensure({ account, phone: "+50255550001", profileName: "Ana" });
    expect(first.contact.appRef).toBe("patient-1");
    const same = await ensure({ account, phone: "+50255550001", profileName: "Ana" });
    expect(same.contact.appRef).toBe("patient-1");
    const renamed = await ensure({ account, phone: "+50255550001", profileName: "Ana P." });
    expect(renamed.contact.appRef).toBe("patient-2");
    expect(calls).toEqual(["+50255550001@PN_A", "+50255550001@PN_A"]);
  });

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

describe("wa.conversations", () => {
  it("gets a conversation and its window status", async () => {
    const { wa, conversation } = await setup();
    expect((await wa.conversations.get(conversation.id))?.id).toBe(conversation.id);
    expect(await wa.conversations.get(MISSING_ID)).toBeNull();
    const window = await wa.conversations.windowStatus(conversation.id);
    expect(window.open).toBe(true);
    expect(window.expiresAt).toEqual(conversation.windowExpiresAt);
    await expect(wa.conversations.windowStatus(MISSING_ID)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });

  it("hands off to the single resolved target with the default message", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const targetsCalls: unknown[] = [];
    const { wa, adapter, conversation, contact, account, handoffs, statusEvents } = await setup({
      resolveHandoffTargets: ({ to, account: acc }) => {
        targetsCalls.push({ to, account: acc.id });
        return ["admin-1"];
      },
    });

    const updated = await wa.conversations.handoff(conversation.id, {
      reason: "Quiere hablar con alguien",
      to: "recepcion",
      by: "recepcionista",
    });

    expect(updated).toMatchObject({
      status: "human",
      handoffReason: "Quiere hablar con alguien",
      assignedTo: "admin-1",
    });
    expect(targetsCalls).toEqual([{ to: "recepcion", account: account.id }]);
    expect(bodies).toEqual([
      expect.objectContaining({ text: { body: "Te comunico con una persona del equipo." } }),
    ]);
    const [sent] = (await adapter.messages.thread(conversation.id, { limit: 5 })).items;
    expect(sent).toMatchObject({ sender: "system", status: "sent" });
    expect(statusEvents).toEqual([
      expect.objectContaining({ from: "agent", to: "human", by: "recepcionista" }),
    ]);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({
      reason: "Quiere hablar con alguien",
      assignees: ["admin-1"],
      contact: { id: contact.id },
      account: { id: account.id },
      conversation: { status: "human", assignedTo: "admin-1" },
    });
  });

  it("leaves assignedTo empty with several targets and honours a custom or null message", async () => {
    const bodies: unknown[] = [];
    graph.server.use(acceptSends(bodies));
    const { wa, conversation, handoffs } = await setup({
      resolveHandoffTargets: () => ["admin-1", "admin-2"],
      handoffMessage: "Un momento por favor.",
    });
    const updated = await wa.conversations.handoff(conversation.id, { reason: "x" });
    expect(updated.assignedTo).toBeNull();
    expect(handoffs[0]?.assignees).toEqual(["admin-1", "admin-2"]);
    expect(bodies).toEqual([expect.objectContaining({ text: { body: "Un momento por favor." } })]);

    await wa.conversations.returnToAgent(conversation.id);
    await wa.conversations.handoff(conversation.id, { reason: "y", message: null });
    expect(bodies).toHaveLength(1);
    expect(handoffs).toHaveLength(2);
  });

  it("still hands off when the message cannot be sent (window closed)", async () => {
    const client = makeClient();
    const account = await client.adapter.accounts.insert(accountInput());
    const { conversation } = await openConversation(client.ctx, account, "+50255550001", 25 * 60);
    const handoffs: HandoffEvent[] = [];
    client.wa.on("handoff", (e) => {
      handoffs.push(e);
    });
    const updated = await client.wa.conversations.handoff(conversation.id, { reason: "z" });
    expect(updated.status).toBe("human");
    expect(handoffs).toHaveLength(1);
    expect(graph.requests).toHaveLength(0);
    expect(client.logs.of("warn")[0]).toContain("handoff message");
  });

  it("returns to the agent, assigns and closes, emitting conversation.status", async () => {
    const { wa, conversation, statusEvents } = await setup({ handoffMessage: null });
    const assigned = await wa.conversations.assign(conversation.id, "user-7", { by: "user-7" });
    expect(assigned).toMatchObject({ status: "human", assignedTo: "user-7" });
    const reassigned = await wa.conversations.assign(conversation.id, "user-8", { by: "user-7" });
    expect(reassigned.assignedTo).toBe("user-8");
    const back = await wa.conversations.returnToAgent(conversation.id, { by: "user-8" });
    expect(back).toMatchObject({ status: "agent", assignedTo: null, handoffReason: null });
    const closed = await wa.conversations.close(conversation.id);
    expect(closed.status).toBe("closed");

    expect(statusEvents.map(({ from, to, by }) => ({ from, to, by }))).toEqual([
      { from: "agent", to: "human", by: "user-7" },
      { from: "human", to: "agent", by: "user-8" },
      { from: "agent", to: "closed", by: "system" },
    ]);
    expect(statusEvents[0]?.conversation.assignedTo).toBe("user-7");
  });

  it("throws RecordNotFoundError for unknown conversations", async () => {
    const { wa } = await setup();
    await expect(wa.conversations.close(MISSING_ID)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(wa.conversations.handoff(MISSING_ID, { reason: "x" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });
});
