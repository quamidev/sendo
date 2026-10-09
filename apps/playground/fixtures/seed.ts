import {
  windowExpiresAt,
  type Account,
  type Conversation,
  type JsonObject,
  type Message,
  type SendoAdapter,
  type Tag,
} from "@quami/sendo";
import {
  FIXTURES_DEV_USER_ID,
  PLAYGROUND_ACCOUNT,
  PLAYGROUND_TENANT_ID,
} from "@/lib/playground-env";
import { FIXTURE_SNIPPETS, INBOX_FIXTURES, PLAYGROUND_DISCONNECTED_ACCOUNT } from "./inbox";
import { seedNumberFixtures } from "./numbers/seed";
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
  adapter: SendoAdapter,
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
    ...(message.metadata !== undefined && { metadata: message.metadata }),
  } as const;

  let stored: Message;
  if (message.direction === "in") {
    const inbound = await adapter.messages.insertInbound({ ...base, metaMessageId, sentAt: at });
    if (inbound === null) throw new Error(`Duplicate fixture message ${metaMessageId}`);
    stored = inbound;
  } else if (message.internal === true || message.draft === true) {
    // Notes and system lines are `sent` and never touch Meta; drafts stay `pending`.
    stored = await adapter.messages.insertOutbound({
      ...base,
      sender: message.sender,
      senderRef: message.senderRef ?? null,
      internal: message.internal === true,
      draft: message.draft === true,
      status: message.internal === true ? "sent" : "pending",
      tokensIn: message.tokensIn ?? null,
      tokensOut: message.tokensOut ?? null,
      costCents: message.costCents ?? null,
    });
  } else {
    stored = await adapter.messages.insertOutbound({
      ...base,
      sender: message.sender,
      senderRef: message.senderRef ?? null,
      tokensIn: message.tokensIn ?? null,
      tokensOut: message.tokensOut ?? null,
      costCents: message.costCents ?? null,
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
      await adapter.storage?.put(storagePath, PNG_1X1, message.media.mimeType);
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
  for (const message of messages) {
    if (message.direction === "in") unread += 1;
    else if (message.internal !== true && message.draft !== true) unread = 0;
  }
  return unread;
}

/** The tenant's tag catalog, created on first use by the inbox fixtures. */
async function fixtureTag(
  adapter: SendoAdapter,
  tenantId: Account["tenantId"],
  tag: { name: string; color: Tag["color"] },
  catalog: Map<string, Tag>,
): Promise<Tag> {
  const known = catalog.get(tag.name);
  if (known !== undefined) return known;
  const created = await adapter.tags.upsert({ tenantId, name: tag.name, color: tag.color });
  catalog.set(tag.name, created);
  return created;
}

async function seedConversation(
  adapter: SendoAdapter,
  clock: FixtureClock,
  account: Account,
  fixture: FixtureConversation,
  base: Date,
  catalog: Map<string, Tag>,
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
  if (fixture.contact.appRef !== undefined) {
    await adapter.contacts.setAppRef(contact.id, fixture.contact.appRef);
  }
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

  for (const tag of fixture.tags ?? []) {
    const stored = await fixtureTag(adapter, account.tenantId, tag, catalog);
    await adapter.tags.addToConversation(conversation.id, stored.id);
  }

  return adapter.conversations.update(conversation.id, {
    agentPaused: fixture.agentPaused ?? false,
    queue: fixture.queue ?? null,
    source: fixture.source ?? null,
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
 * Seeds the playground account (matching the package webhook fixtures, the tenant's default
 * number), the approved templates, every inbox edge case and the numbers screen tenants
 * (`fixtures/numbers/`). Timestamps are relative to `base`.
 */
export async function seedFixtures(
  adapter: SendoAdapter,
  clock: FixtureClock,
  base: Date = new Date(),
  conversations: FixtureConversation[] = INBOX_FIXTURES,
): Promise<SeededFixtures> {
  try {
    clock.set(minutesBefore(base, 60 * 24 * 7));
    const account = await adapter.accounts.insert({
      tenantId: PLAYGROUND_TENANT_ID,
      ...PLAYGROUND_ACCOUNT,
      isDefault: true,
    });
    await adapter.templates.upsertMany(account.id, FIXTURE_TEMPLATES);
    await seedNumberFixtures(adapter, base);

    // A second number of the tenant, disconnected: its conversations stay readable (AC-IB-8).
    const disconnected = await adapter.accounts.insert({
      tenantId: PLAYGROUND_TENANT_ID,
      ...PLAYGROUND_DISCONNECTED_ACCOUNT,
    });
    const catalog = new Map<string, Tag>();
    const seeded: Record<string, string> = {};
    for (const fixture of conversations) {
      const owner = fixture.account === "disconnected" ? disconnected : account;
      const conversation = await seedConversation(adapter, clock, owner, fixture, base, catalog);
      seeded[fixture.key] = conversation.id;
    }
    for (const snippet of FIXTURE_SNIPPETS) {
      const personal = snippet.visibility === "personal";
      await adapter.snippets.upsert({
        tenantId: PLAYGROUND_TENANT_ID,
        accountId: snippet.disconnectedOnly === true ? disconnected.id : null,
        shortcut: snippet.shortcut,
        body: snippet.body,
        visibility: personal ? "personal" : "tenant",
        ownerUserId: personal ? (snippet.owner ?? FIXTURES_DEV_USER_ID) : null,
        by: FIXTURES_DEV_USER_ID,
      });
    }
    await adapter.accounts.update(disconnected.id, { active: false });
    return { account, conversations: seeded };
  } finally {
    clock.set(null);
  }
}
