import type { Conversation, Message } from "@quami/sendo";
import { signedTextWebhook } from "./fake-meta";
import { DEMO_AGENT_NAME, DEMO_TENANT_ID } from "./protocol";
import type { DemoWorld } from "./world";

// Writes to a demo conversation through the same entry points a real app uses: signed
// webhooks for the contact, `sendo.inbox` for the team, the agent's own storage path for
// replayed agent messages. The clock is pinned to `at` so the thread keeps its order.

export interface DemoContact {
  waId: string;
  profileName: string;
}

let metaSequence = 0;

/** Delivers a contact's text through `sendo.handleWebhook` and waits for the pipeline (and any agent turn). */
export async function deliverInbound(
  world: DemoWorld,
  contact: DemoContact,
  text: string,
  at: Date | null,
): Promise<Conversation> {
  world.clock.set(at);
  metaSequence += 1;
  const tasks: Promise<unknown>[] = [];
  const response = await world.sendo.handleWebhook(
    signedTextWebhook({
      waId: contact.waId,
      profileName: contact.profileName,
      metaMessageId: `wamid.DEMOIN${String(Date.now())}${String(metaSequence)}`,
      body: text,
      at: at ?? new Date(),
    }),
    { waitUntil: (task) => tasks.push(task) },
  );
  if (response.status !== 200)
    throw new Error(`demo webhook rejected (${String(response.status)})`);
  await Promise.all(tasks);
  world.clock.set(null);
  const contactRow = await world.adapter.contacts.getByPhone(world.account.id, `+${contact.waId}`);
  const found = await world.adapter.conversations.list({
    accountId: world.account.id,
    status: ["agent", "human", "closed"],
    limit: 100,
  });
  // The contact's newest conversation (a closed one reopens on inbound).
  const conversation = found.items.find((item) => item.contactId === contactRow?.id);
  if (conversation === undefined) throw new Error("demo conversation not found after delivery");
  return conversation;
}

/** An agent reply as the runtime stores it (sent, then read), with optional usage. */
export async function insertAgentReply(
  world: DemoWorld,
  conversation: Conversation,
  text: string,
  at: Date,
  usage: { tokensIn: number; tokensOut: number; costCents: number } | null = null,
): Promise<Message> {
  world.clock.set(at);
  metaSequence += 1;
  const metaMessageId = `wamid.DEMOOUT${String(Date.now())}${String(metaSequence)}`;
  const stored = await world.adapter.messages.insertOutbound({
    tenantId: conversation.tenantId,
    conversationId: conversation.id,
    type: "text",
    content: { body: text },
    text,
    sender: "agent",
    senderRef: DEMO_AGENT_NAME,
    tokensIn: usage?.tokensIn ?? null,
    tokensOut: usage?.tokensOut ?? null,
    costCents: usage?.costCents ?? null,
  });
  const sent = await world.adapter.messages.markSent(stored.id, metaMessageId);
  await world.adapter.messages.updateStatus(metaMessageId, "delivered", { at });
  await world.adapter.messages.updateStatus(metaMessageId, "read", { at });
  await world.adapter.conversations.update(conversation.id, {
    lastActivityAt: at,
    awaitingReplySince: null,
  });
  world.clock.set(null);
  return sent;
}

async function actorFor(world: DemoWorld, userId: string) {
  return userId === world.actor.userId ? world.actor : world.sendo.actor(userId, DEMO_TENANT_ID);
}

/** A person of the team replies from the inbox (step-in: status and assignment stay). */
export async function teamReply(
  world: DemoWorld,
  conversationId: string,
  userId: string,
  text: string,
  at: Date | null,
): Promise<void> {
  world.clock.set(at);
  await world.sendo.inbox.reply(
    conversationId,
    { kind: "text", body: text },
    { actor: await actorFor(world, userId) },
  );
  world.clock.set(null);
}

/** The agent's handoff, as its `transferir_a_humano` tool records it (system line, then the handoff message). */
export async function agentHandoff(
  world: DemoWorld,
  conversationId: string,
  reason: string,
  at: Date,
): Promise<void> {
  world.clock.set(at);
  await world.sendo.conversations.handoff(conversationId, {
    reason,
    to: "administracion",
    message: world.copy.handoffMessage,
    by: `agent:${DEMO_AGENT_NAME}`,
  });
  world.clock.set(null);
}

export async function teamNote(
  world: DemoWorld,
  conversationId: string,
  userId: string,
  text: string,
  at: Date,
): Promise<void> {
  world.clock.set(at);
  await world.sendo.inbox.note(conversationId, text, { actor: await actorFor(world, userId) });
  world.clock.set(null);
}
