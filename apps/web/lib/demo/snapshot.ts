import {
  serializeConversation,
  serializeMessage,
  type InboxConversationView,
  type InboxMessageView,
} from "@/components/sendo/types";
import { DEMO_ACCOUNT_ID, type InboxSnapshot } from "./protocol";
import type { DemoWorld } from "./world";

// What the demo inbox renders, computed by the real `sendo.inbox` API over the memory adapter
// and serialized the way the item's server actions do. Every request builds a fresh world with
// random ids, so ids are rewritten to stable ones (the inbox keys messages by id).

export type { InboxSnapshot };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Replaces every generated id (UUIDs) with the stable name `rename` gives it. */
function stabilize<T>(value: T, rename: Map<string, string>): T {
  const text = JSON.stringify(value).replace(UUID, (id) => rename.get(id) ?? id);
  return JSON.parse(text) as T;
}

/**
 * The inbox state of `conversationIds` (stable key → conversation id). Messages become
 * `<key>-<n>` in thread order, the number becomes `demo-account`, tags `tag-<name>`.
 */
export async function inboxSnapshot(
  world: DemoWorld,
  conversationIds: Record<string, string>,
): Promise<InboxSnapshot> {
  const { sendo, actor } = world;
  const rename = new Map<string, string>([[world.account.id, DEMO_ACCOUNT_ID]]);
  const conversations: InboxConversationView[] = [];
  const threads: Record<string, InboxMessageView[]> = {};

  for (const [key, id] of Object.entries(conversationIds)) {
    rename.set(id, key);
    const conversation = await sendo.inbox.get(id, { actor });
    rename.set(conversation.contact.id, `${key}-contact`);
    conversations.push(serializeConversation(conversation));
    const page = await sendo.inbox.thread(id, { actor, limit: 100 });
    const messages = [...page.items].reverse();
    messages.forEach((message, index) => {
      rename.set(message.id, `${key}-${String(index + 1)}`);
    });
    threads[id] = messages.map(serializeMessage);
  }

  const tags = await sendo.tags.list({ actor });
  for (const tag of tags) rename.set(tag.id, `tag-${tag.name}`);

  const stable = stabilize(
    {
      conversations: conversations.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
      threads,
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
    },
    rename,
  );
  // Thread keys are ids too, so they come out renamed.
  return { ...stable, names: { ...world.team } };
}
