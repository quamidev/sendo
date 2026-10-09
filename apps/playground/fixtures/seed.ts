import {
  windowExpiresAt,
  type Account,
  type Conversation,
  type JsonObject,
  type Message,
  type WhatsAppAdapter,
} from "@quami/wa-li";
import { PLAYGROUND_ACCOUNT, PLAYGROUND_TENANT_ID } from "@/lib/playground-env";
import { INBOX_FIXTURES } from "./inbox";
import { FIXTURE_TEMPLATES } from "./templates";
import type { FixtureConversation, FixtureMessage } from "./types";

/** Movable clock for `memoryAdapter({ now })`: pinned while seeding, real time afterwards. */
export interface FixtureClock {
  now(): Date;
  set(at: Date | null): void;
}

export function createFixtureClock(): FixtureClock {
  let pinned: Date | null = null;
  return {
    now: () => (pinned === null ? new Date() : new Date(pinned)),
    set: (at) => {
      pinned = at;
    },
  };
}

export interface SeededFixtures {
  account: Account;
  /** Fixture key → conversation id. */
  conversations: Record<string, string>;
}

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

function minutesBefore(base: Date, minutes: number): Date {
  return new Date(base.getTime() - minutes * 60_000);
}

function contentOf(message: FixtureMessage): JsonObject {
  return message.content ?? { body: message.text ?? "" };
}

async function seedMessage(
  adapter: WhatsAppAdapter,
  conversation: Conversation,
  fixture: FixtureConversation,
  message: FixtureMessage,
  index: number,
  at: Date,
): Promise<Message> {
  const metaMessageId = `wamid.FIX.${fixture.key}.${String(index + 1)}`;
  const base = {
    tenantId: conversation.tenantId,
    conversationId: conversation.id,
    type: message.type ?? "text",
    content: contentOf(message),
    text: message.text === undefined ? null : message.text,
  } as const;

  let stored: Message;
  if (message.direction === "in") {
    const inbound = await adapter.messages.insertInbound({ ...base, metaMessageId, sentAt: at });
    if (inbound === null) throw new Error(`Duplicate fixture message ${metaMessageId}`);
    stored = inbound;
  } else {
    stored = await adapter.messages.insertOutbound({
      ...base,
      sender: message.sender,
      senderRef: message.senderRef ?? null,
    });
    const status = message.status ?? "read";
    if (status === "failed") {
      stored = await adapter.messages.markFailed(
        stored.id,
        message.error ?? { message: "Fixture send failure" },
      );
    } else if (status !== "pending") {
      stored = await adapter.messages.markSent(stored.id, metaMessageId);
      if (status === "delivered" || status === "read") {
        await adapter.messages.updateStatus(metaMessageId, "delivered", { at });
      }
      if (status === "read") await adapter.messages.updateStatus(metaMessageId, "read", { at });
    }
  }

  if (message.media !== undefined) {
    const storagePath =
      message.media.downloadStatus === "done" ? `fixtures/${fixture.key}/${stored.id}.png` : null;
    if (storagePath !== null)
      await adapter.storage.put(storagePath, PNG_1X1, message.media.mimeType);
    await adapter.media.insert({
      tenantId: conversation.tenantId,
      messageId: stored.id,
      metaMediaId: typeof base.content.mediaId === "string" ? base.content.mediaId : null,
      mimeType: message.media.mimeType,
      sizeBytes: message.media.sizeBytes ?? null,
      storagePath,
      downloadStatus: message.media.downloadStatus,
    });
  }
  return stored;
}

function defaultUnread(messages: FixtureMessage[]): number {
  let unread = 0;
  for (const message of messages) unread = message.direction === "in" ? unread + 1 : 0;
  return unread;
}

async function seedConversation(
  adapter: WhatsAppAdapter,
  clock: FixtureClock,
  account: Account,
  fixture: FixtureConversation,
  base: Date,
): Promise<Conversation> {
  const firstMinutes = fixture.messages[0]?.minutesAgo ?? fixture.createdMinutesAgo ?? 60;
  clock.set(minutesBefore(base, firstMinutes + 1));
  const { contact } = await adapter.contacts.upsert({
    accountId: account.id,
    tenantId: account.tenantId,
    phone: fixture.contact.phone,
    waId: fixture.contact.phone.replace(/^\+/, ""),
    profileName: fixture.contact.profileName,
  });
  const { conversation } = await adapter.conversations.getOpenOrCreate({
    contactId: contact.id,
    accountId: account.id,
    tenantId: account.tenantId,
  });

  let lastInboundAt: Date | null = null;
  let lastActivityAt = minutesBefore(base, firstMinutes + 1);
  for (const [index, message] of fixture.messages.entries()) {
    const at = minutesBefore(base, message.minutesAgo);
    clock.set(at);
    await seedMessage(adapter, conversation, fixture, message, index, at);
    if (message.direction === "in") lastInboundAt = at;
    lastActivityAt = at;
  }

  return adapter.conversations.update(conversation.id, {
    status: fixture.status,
    assignedTo: fixture.assignedTo ?? null,
    handoffReason: fixture.handoffReason ?? null,
    lastInboundAt,
    lastActivityAt,
    windowExpiresAt: lastInboundAt === null ? null : windowExpiresAt(lastInboundAt),
    unreadCount: fixture.unreadCount ?? defaultUnread(fixture.messages),
  });
}

/**
 * Seeds the playground account (matching the package webhook fixtures), the approved
 * templates and every inbox edge case. Timestamps are relative to `base`.
 */
export async function seedFixtures(
  adapter: WhatsAppAdapter,
  clock: FixtureClock,
  base: Date = new Date(),
  conversations: FixtureConversation[] = INBOX_FIXTURES,
): Promise<SeededFixtures> {
  try {
    clock.set(minutesBefore(base, 60 * 24 * 7));
    const account = await adapter.accounts.insert({
      tenantId: PLAYGROUND_TENANT_ID,
      ...PLAYGROUND_ACCOUNT,
    });
    await adapter.templates.upsertMany(account.id, FIXTURE_TEMPLATES);

    const seeded: Record<string, string> = {};
    for (const fixture of conversations) {
      const conversation = await seedConversation(adapter, clock, account, fixture, base);
      seeded[fixture.key] = conversation.id;
    }
    return { account, conversations: seeded };
  } finally {
    clock.set(null);
  }
}
