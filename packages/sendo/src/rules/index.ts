import type { SendoContext } from "../core/context";
import { createRulesApi } from "./api";
import { createRulesHooks } from "./hooks";
import { createRuleStore } from "./store";
import { createTick } from "./tick";

export type { RuleInput, RulesActorOption, RulesApi, RuleView } from "./api";
export { foldText } from "./hooks";
export { closedPeriodStart, isOpenAt, openMinutesBetween } from "./hours";
export { SOURCE_CODE_RE, stripSourceCode } from "./source";
export { syncRules } from "./sync";
export type { SyncRuleOutcome, SyncRulesOptions, SyncRulesResult } from "./sync";
export {
  DEFAULT_TICK_BUDGET_MS,
  registerBroadcastsTickStep,
  TICK_LOCK_KEY,
  TICK_LOCK_TTL_MS,
} from "./tick";
export type {
  TickOptions,
  TickReport,
  TickSlot,
  TickStep,
  TickStepContext,
  TickStepName,
  TickStepReport,
} from "./tick";

/** `SENDO_MODULES` entry: `sendo.rules`, `sendo.maintenance.tick` and `ctx.rulesHooks`. */
export function installRules(ctx: SendoContext): void {
  const store = createRuleStore(ctx);
  ctx.rulesHooks = createRulesHooks(ctx, store, { now: () => new Date() });
  ctx.slots.rules = createRulesApi(ctx, store);
  ctx.slots.tick = createTick(ctx, store);
}
