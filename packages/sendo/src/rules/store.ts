import type { SendoContext } from "../core/context";
import type { StoredRule, TenantId } from "../types/entities";
import { parseRuleParams, type RuleParams, type RuleRef, type RuleType } from "./schemas";

/** Effective rules are cached per tenant for this long (and dropped on API writes). */
export const RULES_CACHE_TTL_MS = 30_000;

interface LoadedRuleOf<T extends RuleType> {
  stored: StoredRule;
  type: T;
  key: string;
  params: RuleParams<T>;
  ref: RuleRef;
}

/** A stored rule whose `params` passed its schema (a union over the rule types). */
export type LoadedRule<T extends RuleType = RuleType> = T extends RuleType
  ? LoadedRuleOf<T>
  : never;

export function ruleRef(rule: Pick<StoredRule, "id" | "key" | "type">): RuleRef {
  return { id: rule.id, key: rule.key, type: rule.type };
}

/** `"rule:<key>"`: the `by` of every rule action. */
export function ruleBy(rule: { key: string }): string {
  return `rule:${rule.key}`;
}

export function isRuleOf<T extends RuleType>(type: T) {
  return (rule: LoadedRule): rule is LoadedRule<T> => rule.type === type;
}

export interface RuleStore {
  /** Active, valid rules of the tenant that apply to `accountId` (tenant-wide + the account's). */
  forAccount(tenantId: TenantId, accountId: string): Promise<LoadedRule[]>;
  /** Active, valid rules of every tenant (uncached; the tick). */
  allActive(): Promise<LoadedRule[]>;
  invalidate(tenantId: TenantId): void;
}

const NULL_TENANT = "\u0000";

export function createRuleStore(ctx: SendoContext): RuleStore {
  const cache = new Map<string, { at: number; rules: LoadedRule[] }>();
  /** Invalid stored rules are logged once per `updatedAt`. */
  const warned = new Set<string>();

  function load(rules: StoredRule[]): LoadedRule[] {
    const out: LoadedRule[] = [];
    for (const stored of rules) {
      if (!stored.active) continue;
      const parsed = parseRuleParams(stored.type, stored.params);
      if (!parsed.success) {
        const mark = `${stored.id}:${String(stored.updatedAt.getTime())}`;
        if (!warned.has(mark)) {
          warned.add(mark);
          ctx.logger.warn(
            `[sendo] rule "${stored.key}" (${stored.type}) has invalid params and is ignored: ${parsed.error}`,
          );
        }
        continue;
      }
      out.push({
        stored,
        type: stored.type,
        key: stored.key,
        params: parsed.params,
        ref: ruleRef(stored),
      } as LoadedRule);
    }
    return out;
  }

  return {
    async forAccount(tenantId, accountId) {
      const cacheKey = tenantId ?? NULL_TENANT;
      let entry = cache.get(cacheKey);
      if (entry === undefined || Date.now() - entry.at > RULES_CACHE_TTL_MS) {
        entry = {
          at: Date.now(),
          rules: load(await ctx.adapter.rules.list({ tenantId, active: true })),
        };
        cache.set(cacheKey, entry);
      }
      return entry.rules.filter(
        (rule) => rule.stored.accountId === null || rule.stored.accountId === accountId,
      );
    },
    async allActive() {
      return load(await ctx.adapter.rules.list({ active: true }));
    },
    invalidate(tenantId) {
      cache.delete(tenantId ?? NULL_TENANT);
    },
  };
}

/**
 * The business-hours rule for an account: the account's own rule first, else the tenant-wide
 * one, each by position. `null` = always open.
 */
export function businessHoursOf(
  rules: readonly LoadedRule[],
  accountId: string,
): LoadedRule<"business_hours"> | null {
  const hours = rules.filter(isRuleOf("business_hours"));
  return (
    hours.find((r) => r.stored.accountId === accountId) ??
    hours.find((r) => r.stored.accountId === null) ??
    null
  );
}
