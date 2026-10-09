import type { SendoContext } from "../core/context";
import type { Account, Contact, Conversation, Message } from "../types/entities";
import type { TagColor } from "../types/enums";
import { ruleBy, type LoadedRule } from "./store";

/** Shared rule actions: system lines, assignment, tagging and the `rule.applied` event. */

/** Default color for tags a `route` rule creates because they are not in the catalog yet. */
const RULE_TAG_COLOR: TagColor = "gray";

/**
 * Inserts the thread's system line for a rule action (`internal`, never sent):
 * `metadata { kind: "rule", by: "rule:<key>", event, ruleKey }`. The conversation services skip
 * their own lines for `rule:*` changes, so this is the only line per action.
 */
export function insertRuleLine(
  ctx: SendoContext,
  conversation: Conversation,
  rule: LoadedRule,
  text: string,
  event: string,
): Promise<Message> {
  return ctx.services.messages.insertSystemLine(conversation, {
    text,
    by: ruleBy(rule),
    kind: "rule",
    event,
    metadata: { ruleKey: rule.key },
  });
}

export async function ruleApplied(
  ctx: SendoContext,
  rule: LoadedRule,
  conversation: Conversation,
  action: string,
): Promise<void> {
  await ctx.emitter.emit("rule.applied", { rule: rule.ref, conversation, action });
}

/** `«key»`: how a rule is named in system lines. */
export function ruleName(rule: LoadedRule): string {
  return `«${rule.key}»`;
}

/** The user's display name from `resolveUsers`, else the id. */
export async function userName(ctx: SendoContext, userId: string): Promise<string> {
  const resolve = ctx.team.resolveUsers;
  if (resolve === null) return userId;
  try {
    const users = await resolve([userId]);
    return users.find((u) => u.id === userId)?.name ?? userId;
  } catch (error) {
    ctx.logger.warn("[sendo] resolveUsers failed", error);
    return userId;
  }
}

export async function participants(
  ctx: SendoContext,
  conversation: Conversation,
): Promise<{ account: Account; contact: Contact } | null> {
  const [account, contact] = await Promise.all([
    ctx.adapter.accounts.getById(conversation.accountId),
    ctx.adapter.contacts.get(conversation.contactId),
  ]);
  return account === null || contact === null ? null : { account, contact };
}

/**
 * Assigns `userId` (moving the conversation to `human`) with `by: "rule:<key>"`; the service
 * emits `conversation.assigned`. Writes the system line.
 */
export async function assignByRule(
  ctx: SendoContext,
  conversation: Conversation,
  userId: string,
  rule: LoadedRule,
  line: (name: string) => string,
): Promise<Conversation> {
  const updated = await ctx.services.conversations.assign(conversation.id, userId, {
    by: ruleBy(rule),
  });
  await insertRuleLine(ctx, updated, rule, line(await userName(ctx, userId)), "assigned");
  return updated;
}

/** Adds catalog tags by name (case-insensitive), creating the missing ones. */
export async function tagByName(
  ctx: SendoContext,
  conversation: Conversation,
  names: readonly string[],
  by: string,
): Promise<void> {
  if (names.length === 0) return;
  const catalog = await ctx.adapter.tags.list({ tenantId: conversation.tenantId });
  for (const name of names) {
    let tag = catalog.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (tag === undefined) {
      tag = await ctx.adapter.tags.upsert({
        tenantId: conversation.tenantId,
        name,
        color: RULE_TAG_COLOR,
      });
      catalog.push(tag);
    }
    await ctx.adapter.tags.addToConversation(conversation.id, tag.id, { by });
  }
}
