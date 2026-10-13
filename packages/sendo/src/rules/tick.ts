import type { SendoContext } from "../core/context";
import { resolveAssigneeIds } from "../team/config";
import type { Account, Conversation } from "../types/entities";
import { assignByRule, insertRuleLine, participants, ruleApplied } from "./actions";
import { isOpenAt, openMinutesBetween, openPeriodStart } from "./hours";
import { businessHoursOf, isRuleOf, ruleBy, type LoadedRule, type RuleStore } from "./store";

export interface TickOptions {
  /** The clock the rules are evaluated at. Default: now. */
  now?: Date;
  /** Wall-clock budget for all steps. Default 50 000 ms. */
  budgetMs?: number;
}

export type TickStepName =
  "afterHours" | "escalations" | "autoClose" | "broadcasts" | "billing" | "prune";

export interface TickStepReport {
  /** `false` when the step was skipped (budget spent, or nothing to do today for `prune`). */
  ran: boolean;
  /**
   * What the step did: conversations handed back to the agent (`afterHours`), escalated
   * (`escalations`), closed (`autoClose`), messages sent (`broadcasts`), accounts re-checked
   * (`billing`), events deleted (`prune`).
   */
  count: number;
  /** Failures (each logged); the step went on with the next item. */
  errors: number;
}

export interface TickReport {
  /** `true` when another tick holds the lock; nothing ran. */
  skipped: boolean;
  /** The clock the tick used. */
  now: Date;
  durationMs: number;
  /** The budget ran out before every step finished. */
  budgetExhausted: boolean;
  steps: Record<TickStepName, TickStepReport>;
  /** Escalations per action. */
  escalations: { reassigned: number; notified: number; returnedToAgent: number };
}

/** `sendo.maintenance.tick` (SND-3.4). */
export type TickSlot = (opts?: TickOptions) => Promise<TickReport>;

/** What a pluggable tick step receives. */
export interface TickStepContext {
  ctx: SendoContext;
  now: Date;
  /** Milliseconds left in the tick's budget (stop starting new work at 0). */
  remainingMs(): number;
}

/** A pluggable step: returns its `TickStepReport` counts. */
export type TickStep = (input: TickStepContext) => Promise<{ count: number; errors: number }>;

export const TICK_LOCK_KEY = "tick";
export const TICK_LOCK_TTL_MS = 120_000;
export const DEFAULT_TICK_BUDGET_MS = 50_000;
/** `sendo_locks` key that marks today's event prune (held for a day, never released). */
export const PRUNE_LOCK_KEY = "tick:prune";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Conversations fetched per rule and step. */
const BATCH = 50;

const broadcastSteps = new WeakMap<SendoContext, TickStep>();

/**
 * Extension point for SND-4.2: the broadcasts step (step 4) of `sendo.maintenance.tick`.
 * Call it from the broadcasts installer; until then the step is a no-op (`ran: true`, `count: 0`).
 */
export function registerBroadcastsTickStep(ctx: SendoContext, step: TickStep): void {
  broadcastSteps.set(ctx, step);
}

function emptyStep(): TickStepReport {
  return { ran: false, count: 0, errors: 0 };
}

export function createTick(ctx: SendoContext, store: RuleStore): TickSlot {
  const { adapter, logger } = ctx;

  return async function tick(opts = {}) {
    const now = opts.now ?? new Date();
    const budgetMs = opts.budgetMs ?? DEFAULT_TICK_BUDGET_MS;
    const started = performance.now();
    const remainingMs = () => budgetMs - (performance.now() - started);
    const report: TickReport = {
      skipped: false,
      now,
      durationMs: 0,
      budgetExhausted: false,
      steps: {
        afterHours: emptyStep(),
        escalations: emptyStep(),
        autoClose: emptyStep(),
        broadcasts: emptyStep(),
        billing: emptyStep(),
        prune: emptyStep(),
      },
      escalations: { reassigned: 0, notified: 0, returnedToAgent: 0 },
    };

    await ctx.ready();
    if (!(await adapter.locks.acquire(TICK_LOCK_KEY, TICK_LOCK_TTL_MS))) {
      report.skipped = true;
      return report;
    }

    const accounts = new Map<string, Account | null>();
    async function accountOf(id: string): Promise<Account | null> {
      if (!accounts.has(id)) accounts.set(id, await adapter.accounts.getById(id));
      return accounts.get(id) ?? null;
    }
    async function rulesFor(account: Account): Promise<LoadedRule[]> {
      return store.forAccount(account.tenantId, account.id);
    }

    /** Runs `fn` for each item while budget remains; failures are logged and counted. */
    async function each<T>(
      step: TickStepReport,
      items: readonly T[],
      label: (item: T) => string,
      fn: (item: T) => Promise<boolean>,
    ): Promise<boolean> {
      for (const item of items) {
        if (remainingMs() <= 0) {
          report.budgetExhausted = true;
          return false;
        }
        try {
          if (await fn(item)) step.count++;
        } catch (error) {
          step.errors++;
          logger.error(`[sendo] tick: ${label(item)} failed`, error);
        }
      }
      return true;
    }

    async function dispatchAgent(conversation: Conversation): Promise<void> {
      const dispatcher = ctx.agentDispatcher;
      if (dispatcher === undefined) return;
      const people = await participants(ctx, conversation);
      if (people === null) return;
      const history = await adapter.messages.history(conversation.id, 20);
      const message = history.filter((m) => m.direction === "in").at(-1);
      if (message === undefined) return;
      await dispatcher.handleInbound({ ...people, conversation, message });
    }

    /** Step 1: when hours open, hand conversations held overnight (`appliesTo: "all"`) to the agent. */
    async function afterHours(rules: LoadedRule[]): Promise<void> {
      const step = report.steps.afterHours;
      step.ran = true;
      for (const rule of rules.filter(isRuleOf("business_hours"))) {
        if (rule.params.appliesTo !== "all") continue;
        const opened = openPeriodStart(rule.params, now);
        if (opened === null) continue;
        const handled = rule.stored.state.openedAt;
        if (typeof handled === "string" && handled >= opened.toISOString()) continue;
        const page = await adapter.conversations.list({
          tenantId: rule.stored.tenantId,
          ...(rule.stored.accountId === null ? {} : { accountId: rule.stored.accountId }),
          status: "agent",
          limit: BATCH,
        });
        const held = page.items.filter(
          (c) =>
            !c.agentPaused &&
            c.awaitingReplySince !== null &&
            c.awaitingReplySince.getTime() < opened.getTime(),
        );
        const finished = await each(
          step,
          held,
          (c) => `after-hours resume of ${c.id}`,
          async (conversation) => {
            const account = await accountOf(conversation.accountId);
            if (account === null || !account.active) return false;
            // A tenant-wide rule yields to the account's own business hours.
            if (
              businessHoursOf(await rulesFor(account), account.id)?.stored.id !== rule.stored.id
            ) {
              return false;
            }
            await dispatchAgent(conversation);
            return true;
          },
        );
        if (finished)
          await adapter.rules.patchState(rule.stored.id, { openedAt: opened.toISOString() });
      }
    }

    /** Step 2: conversations waiting on a person longer than the rule allows (inside hours only). */
    async function escalations(rules: LoadedRule[]): Promise<void> {
      const step = report.steps.escalations;
      step.ran = true;
      for (const rule of rules.filter(isRuleOf("escalate"))) {
        if (remainingMs() <= 0) {
          report.budgetExhausted = true;
          return;
        }
        const { afterMinutes } = rule.params;
        const candidates = await adapter.conversations.findForTick({
          type: "escalate",
          tenantId: rule.stored.tenantId,
          ...(rule.stored.accountId === null ? {} : { accountId: rule.stored.accountId }),
          ...(rule.params.queue === undefined ? {} : { queue: rule.params.queue }),
          waitingSince: new Date(now.getTime() - afterMinutes * 60_000),
          limit: BATCH,
        });
        await each(
          step,
          candidates,
          (c) => `escalation of ${c.id} (rule ${rule.key})`,
          async (conversation) => {
            const account = await accountOf(conversation.accountId);
            const waitingSince = conversation.awaitingReplySince;
            if (account === null || waitingSince === null) return false;
            const hours = businessHoursOf(await rulesFor(account), account.id);
            let minutesWaiting = (now.getTime() - waitingSince.getTime()) / 60_000;
            if (hours !== null) {
              if (!isOpenAt(hours.params, now)) return false;
              minutesWaiting = openMinutesBetween(hours.params, waitingSince, now);
            }
            if (minutesWaiting < afterMinutes) return false;
            return escalate(rule, account, conversation, Math.floor(minutesWaiting));
          },
        );
      }
    }

    async function escalate(
      rule: LoadedRule<"escalate">,
      account: Account,
      conversation: Conversation,
      minutesWaiting: number,
    ): Promise<boolean> {
      const by = ruleBy(rule);
      let current = conversation;
      switch (rule.params.action) {
        case "reassign": {
          const people = await participants(ctx, conversation);
          if (people === null) return false;
          const candidates = [
            ...new Set(
              await resolveAssigneeIds(ctx.team, ctx.config.resolveHandoffTargets, {
                tenantId: account.tenantId,
                queue: conversation.queue,
                account,
                conversation,
                contact: people.contact,
              }),
            ),
          ];
          const from = candidates.indexOf(conversation.assignedTo ?? "");
          const next = candidates
            .slice(from + 1)
            .concat(candidates.slice(0, Math.max(0, from)))
            .find((id) => id !== conversation.assignedTo);
          if (next === undefined) {
            logger.warn(
              `[sendo] escalation rule "${rule.key}": no other assignee for conversation ${conversation.id}`,
            );
            await ctx.emitter.emit("escalation", {
              conversation,
              rule: rule.ref,
              minutesWaiting,
            });
            report.escalations.notified++;
            break;
          }
          current = await assignByRule(ctx, conversation, next, rule, { minutesWaiting });
          report.escalations.reassigned++;
          break;
        }
        case "notify":
          await insertRuleLine(ctx, conversation, rule, "escalated", { minutesWaiting });
          await ctx.emitter.emit("escalation", { conversation, rule: rule.ref, minutesWaiting });
          report.escalations.notified++;
          break;
        case "return_to_agent":
          current = await ctx.services.conversations.returnToAgent(conversation.id, { by });
          await insertRuleLine(ctx, current, rule, "returned", { minutesWaiting });
          report.escalations.returnedToAgent++;
          break;
      }
      current = await adapter.conversations.update(current.id, { escalatedAt: now });
      await ruleApplied(ctx, rule, current, `escalate:${rule.params.action}`);
      if (rule.params.action === "return_to_agent") await dispatchAgent(current);
      return true;
    }

    /** Step 3: open conversations without activity for `afterDays`. */
    async function autoClose(rules: LoadedRule[]): Promise<void> {
      const step = report.steps.autoClose;
      step.ran = true;
      for (const rule of rules.filter(isRuleOf("auto_close"))) {
        if (remainingMs() <= 0) {
          report.budgetExhausted = true;
          return;
        }
        const candidates = await adapter.conversations.findForTick({
          type: "auto_close",
          tenantId: rule.stored.tenantId,
          ...(rule.stored.accountId === null ? {} : { accountId: rule.stored.accountId }),
          inactiveSince: new Date(now.getTime() - rule.params.afterDays * DAY_MS),
          limit: BATCH,
        });
        await each(
          step,
          candidates,
          (c) => `auto-close of ${c.id} (rule ${rule.key})`,
          async (conversation) => {
            const closed = await ctx.services.conversations.close(conversation.id, {
              by: ruleBy(rule),
            });
            await insertRuleLine(ctx, closed, rule, "closed", {
              afterDays: rule.params.afterDays,
            });
            await ruleApplied(ctx, rule, closed, "close");
            return true;
          },
        );
      }
    }

    /** Step 4: broadcasts (SND-4.2 registers the step). */
    async function broadcasts(): Promise<void> {
      const step = report.steps.broadcasts;
      step.ran = true;
      const run = broadcastSteps.get(ctx);
      if (run === undefined) return;
      const result = await run({ ctx, now, remainingMs });
      step.count += result.count;
      step.errors += result.errors;
    }

    /** Step 5: accounts without billing, not re-checked in the last hour. */
    async function billing(): Promise<void> {
      const step = report.steps.billing;
      step.ran = true;
      const client = ctx.client;
      if (client === undefined) return;
      const due = (await adapter.accounts.list({ active: true })).filter(
        (a) =>
          a.billingReady === false &&
          (a.billingCheckedAt === null || a.billingCheckedAt.getTime() <= now.getTime() - HOUR_MS),
      );
      await each(
        step,
        due,
        (a) => `billing re-check of account ${a.id}`,
        async (account) => {
          await client.accounts.refreshBilling(account.id);
          return true;
        },
      );
    }

    /** Step 6: the daily event prune; the day is tracked as a 24 h `sendo_locks` row. */
    async function prune(): Promise<void> {
      const step = report.steps.prune;
      if (!(await adapter.locks.acquire(PRUNE_LOCK_KEY, DAY_MS))) return;
      step.ran = true;
      step.count = await ctx.slots.maintenance.prune();
    }

    const steps: [TickStepName, () => Promise<void>][] = [];
    try {
      const rules = await store.allActive();
      steps.push(
        ["afterHours", () => afterHours(rules)],
        ["escalations", () => escalations(rules)],
        ["autoClose", () => autoClose(rules)],
        ["broadcasts", broadcasts],
        ["billing", billing],
        ["prune", prune],
      );
      for (const [name, run] of steps) {
        if (remainingMs() <= 0) {
          report.budgetExhausted = true;
          break;
        }
        try {
          await run();
        } catch (error) {
          report.steps[name].errors++;
          logger.error(`[sendo] tick step ${name} failed`, error);
        }
      }
    } finally {
      await adapter.locks.release(TICK_LOCK_KEY);
      report.durationMs = Math.round(performance.now() - started);
    }
    return report;
  };
}
