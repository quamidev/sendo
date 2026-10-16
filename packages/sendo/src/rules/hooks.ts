import type { RulesHooks, SendoContext } from "../core/context";
import { resolveAssigneeIds } from "../team/config";
import type { Account, Conversation, Message } from "../types/entities";
import { windowStatus } from "../utils/window";
import { assignByRule, insertRuleLine, participants, ruleApplied, tagByName } from "./actions";
import { closedPeriodStart, isOpenAt } from "./hours";
import { stripSourceCode } from "./source";
import { businessHoursOf, isRuleOf, ruleBy, type LoadedRule, type RuleStore } from "./store";

/** Serializes after-hours replies per conversation (no duplicate message for a burst). */
const AFTER_HOURS_LOCK_TTL_MS = 30_000;

/** Lowercase, accents removed, punctuation as spaces, padded: `" hola que tal "`. */
export function foldText(text: string): string {
  const folded = text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return ` ${folded} `;
}

/** Whole-word (or whole-phrase) keyword match, case- and accent-insensitive. */
function hasKeyword(folded: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => {
    const k = foldText(keyword);
    return k.trim() !== "" && folded.includes(k);
  });
}

/** Channels widen later (`instagram`, `messenger`); compared as strings until then. */
function sameChannel(a: string, b: string): boolean {
  return a === b;
}

function routeMatches(
  rule: LoadedRule<"route">,
  input: { account: Account; conversation: Conversation; text: string },
): boolean {
  const { match } = rule.params;
  const { account, conversation } = input;
  if (match.channel !== undefined && !sameChannel(match.channel, conversation.channel)) {
    return false;
  }
  if (
    match.account !== undefined &&
    match.account !== account.id &&
    match.account !== account.phoneNumberId
  ) {
    return false;
  }
  if (match.source !== undefined && match.source !== conversation.source) return false;
  if (match.keywords !== undefined && match.keywords.length > 0) {
    return hasKeyword(foldText(input.text), match.keywords);
  }
  return true;
}

/** Text a route rule's keywords are matched against: the first message without its `[#code]`. */
function routingText(message: Message): string {
  return message.text === null ? "" : stripSourceCode(message.text).text;
}

export interface RulesClock {
  now(): Date;
}

export function createRulesHooks(
  ctx: SendoContext,
  store: RuleStore,
  clock: RulesClock,
): RulesHooks {
  const { adapter, logger } = ctx;

  async function autoAssign(conversation: Conversation, account: Account): Promise<Conversation> {
    const rules = await store.forAccount(account.tenantId, account.id);
    const rule = rules
      .filter(isRuleOf("auto_assign"))
      .find((r) => r.params.queue === undefined || r.params.queue === conversation.queue);
    if (rule === undefined) return conversation;
    const hours = businessHoursOf(rules, account.id);
    if (hours !== null && !isOpenAt(hours.params, clock.now())) return conversation;

    const contact = await adapter.contacts.get(conversation.contactId);
    if (contact === null) return conversation;
    const candidates = await resolveAssigneeIds(ctx.team, ctx.config.resolveHandoffTargets, {
      tenantId: account.tenantId,
      queue: conversation.queue,
      account,
      conversation,
      contact,
    });
    const unique = [...new Set(candidates)];
    if (unique.length === 0) return conversation;

    let pick: string;
    if (rule.params.strategy === "round_robin") {
      const cursor = rule.stored.state.cursor;
      const last = typeof cursor === "string" ? unique.indexOf(cursor) : -1;
      pick = unique[(last + 1) % unique.length] ?? (unique[0] as string);
      await adapter.rules.patchState(rule.stored.id, { cursor: pick });
      // The cached copy carries the state the next pick reads.
      rule.stored.state = { ...rule.stored.state, cursor: pick };
    } else {
      const counts = await adapter.conversations.countByAssignee({
        tenantId: account.tenantId,
        assignees: unique,
        status: "human",
      });
      pick = unique.reduce((best, id) => ((counts[id] ?? 0) < (counts[best] ?? 0) ? id : best));
    }

    const updated = await assignByRule(ctx, conversation, pick, rule);
    await ruleApplied(ctx, rule, updated, "assign");
    return updated;
  }

  const hooks: RulesHooks = {
    async onNewConversation({ account, conversation, message }) {
      const rules = await store.forAccount(account.tenantId, account.id);
      const text = routingText(message);
      const rule = rules
        .filter(isRuleOf("route"))
        .find((r) => routeMatches(r, { account, conversation, text }));
      if (rule === undefined) return conversation;

      const by = ruleBy(rule);
      const { action } = rule.params;
      let current = conversation;
      if (action.queue !== undefined && action.queue !== current.queue) {
        current = await adapter.conversations.update(current.id, { queue: action.queue });
      }
      await tagByName(ctx, current, action.tags ?? [], by);

      const routing = {
        ...(action.queue !== undefined && { queue: action.queue }),
        ...(action.tags !== undefined &&
          action.tags.length > 0 && { tags: action.tags.join(", ") }),
      };

      if (action.to === "human" && current.status !== "human") {
        await insertRuleLine(ctx, current, rule, "handoff", routing);
        const { conversation: handed } = await ctx.services.conversations.handoff(current.id, {
          reason: action.reason ?? `Rule «${rule.key}»`,
          by,
        });
        // `handoff` runs `onEnterHuman` (auto-assign) itself.
        await ruleApplied(ctx, rule, handed, "route");
        return handed;
      }
      await insertRuleLine(ctx, current, rule, "routed", routing);
      await ruleApplied(ctx, rule, current, "route");
      return current;
    },

    async onEnterHuman({ account, conversation }) {
      const current = (await adapter.conversations.get(conversation.id)) ?? conversation;
      if (current.status !== "human" || current.assignedTo !== null) return current;
      return autoAssign(current, account);
    },

    async onInbound({ account, conversation }) {
      const rules = await store.forAccount(account.tenantId, account.id);
      const hours = businessHoursOf(rules, account.id);
      if (hours === null) return;
      const now = clock.now();
      if (isOpenAt(hours.params, now)) return;

      const lockKey = `rules:after_hours:${conversation.id}`;
      if (!(await adapter.locks.acquire(lockKey, AFTER_HOURS_LOCK_TTL_MS))) return;
      try {
        const current = (await adapter.conversations.get(conversation.id)) ?? conversation;
        if (hours.params.appliesTo === "human" && current.status !== "human") return;
        const periodStart = closedPeriodStart(hours.params, now);
        const notified = current.afterHoursNotifiedAt;
        if (notified !== null && notified.getTime() >= periodStart.getTime()) return;
        if (!windowStatus(current.lastInboundAt).open) {
          logger.info(
            `[sendo] after-hours message for conversation ${current.id} not sent: the 24 h window is closed`,
          );
          return;
        }
        const people = await participants(ctx, current);
        if (people === null) return;
        await ctx.services.messages.send(
          {
            account,
            contact: people.contact,
            conversation: current,
            sender: "system",
            senderRef: ruleBy(hours),
          },
          { kind: "text", body: hours.params.outsideMessage },
        );
        const updated = await adapter.conversations.update(current.id, {
          afterHoursNotifiedAt: now,
        });
        await insertRuleLine(ctx, updated, hours, "after_hours");
        await ruleApplied(ctx, hours, updated, "after_hours_message");
      } finally {
        await adapter.locks.release(lockKey);
      }
    },

    async holdsAgent({ account, now }) {
      const rules = await store.forAccount(account.tenantId, account.id);
      const hours = businessHoursOf(rules, account.id);
      return hours?.params.appliesTo === "all" && !isOpenAt(hours.params, now);
    },
  };
  return hooks;
}
