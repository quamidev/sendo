import { isUuid } from "../core/accounts";
import type { SendoContext } from "../core/context";
import {
  AccountNotFoundError,
  PayloadValidationError,
  RecordNotFoundError,
} from "../errors/errors";
import { assertCan, requireActor, type Actor } from "../team/permissions";
import type { JsonObject, StoredRule } from "../types/entities";
import {
  formatRuleIssues,
  ruleKeySchema,
  ruleParamsSchemas,
  ruleTypeSchema,
  type RuleParams,
  type RuleType,
} from "./schemas";
import type { RuleStore } from "./store";

/** A rule written from the rules screen (`sendo.rules.upsert`); upserted by `(tenant, key)`. */
export interface RuleInput<T extends RuleType = RuleType> {
  key: string;
  type: T;
  /** Validated against the type's schema (`ruleParamsSchemas[type]`). */
  params: RuleParams<T>;
  /** Account id or phone number id; `null` = every account of the tenant. Omitted: unchanged. */
  account?: string | null;
  /** Omitted: `true` on insert, unchanged on update. */
  active?: boolean;
}

/** A stored rule plus whether its `params` pass the schema (invalid rules are ignored by the engine). */
export interface RuleView extends StoredRule {
  valid: boolean;
  /** Validation messages (`path: message` lines) when `valid` is false. */
  error: string | null;
}

export interface RulesActorOption {
  actor: Actor;
}

/** `sendo.rules`: every method needs the `rules.manage` capability and acts on the actor's tenant. */
export interface RulesApi {
  /** The tenant's rules by position; with `accountId`, tenant-wide rules plus that account's. */
  list(o: RulesActorOption & { accountId?: string }): Promise<RuleView[]>;
  /** Insert or update by key (records `updatedBy`); throws `PayloadValidationError` on invalid params. */
  upsert(input: RuleInput, o: RulesActorOption): Promise<StoredRule>;
  toggle(id: string, enabled: boolean, o: RulesActorOption): Promise<StoredRule>;
  /** Positions follow the order of `ids`. */
  reorder(ids: string[], o: RulesActorOption): Promise<void>;
  delete(id: string, o: RulesActorOption): Promise<void>;
}

function invalid(field: string, message: string): PayloadValidationError {
  return new PayloadValidationError({ field, message });
}

export function createRulesApi(ctx: SendoContext, store: RuleStore): RulesApi {
  const { adapter } = ctx;

  async function requireRule(id: string, actor: Actor): Promise<StoredRule> {
    const rule = await adapter.rules.get(id);
    if (rule === null || rule.tenantId !== actor.tenantId) {
      throw new RecordNotFoundError({ entity: "rule", id });
    }
    return rule;
  }

  async function accountIdOf(ref: string, actor: Actor): Promise<string> {
    const account =
      (isUuid(ref) ? await adapter.accounts.getById(ref) : null) ??
      (await adapter.accounts.getByPhoneNumberId(ref));
    if (account === null || account.tenantId !== actor.tenantId) {
      throw new AccountNotFoundError({ account: ref, tenantId: actor.tenantId });
    }
    return account.id;
  }

  async function begin(actor: Actor): Promise<void> {
    requireActor(actor, "rules.manage");
    assertCan(actor, "rules.manage");
    await ctx.ready();
  }

  return {
    async list({ actor, accountId }) {
      await begin(actor);
      const rules = await adapter.rules.list({
        tenantId: actor.tenantId,
        ...(accountId === undefined ? {} : { accountId: await accountIdOf(accountId, actor) }),
      });
      return rules.map((rule) => {
        const result = ruleParamsSchemas[rule.type].safeParse(rule.params);
        return {
          ...rule,
          valid: result.success,
          error: result.success ? null : formatRuleIssues(result.error),
        };
      });
    },

    async upsert(input, { actor }) {
      await begin(actor);
      const key = ruleKeySchema.safeParse(input.key);
      if (!key.success) throw invalid("key", formatRuleIssues(key.error));
      const type = ruleTypeSchema.safeParse(input.type);
      if (!type.success) throw invalid("type", formatRuleIssues(type.error));
      const params = ruleParamsSchemas[type.data].safeParse(input.params);
      if (!params.success) {
        const first = params.error.issues[0];
        const path = first === undefined ? "" : first.path.map(String).join(".");
        throw invalid(path === "" ? "params" : `params.${path}`, formatRuleIssues(params.error));
      }
      const accountId =
        input.account === undefined
          ? undefined
          : input.account === null
            ? null
            : await accountIdOf(input.account, actor);
      const { rule } = await adapter.rules.upsert({
        tenantId: actor.tenantId,
        key: key.data,
        type: type.data,
        params: params.data as unknown as JsonObject,
        ...(accountId === undefined ? {} : { accountId }),
        ...(input.active === undefined ? {} : { active: input.active }),
        updatedBy: actor.userId,
      });
      store.invalidate(actor.tenantId);
      return rule;
    },

    async toggle(id, enabled, { actor }) {
      await begin(actor);
      await requireRule(id, actor);
      const rule = await adapter.rules.update(id, { active: enabled, updatedBy: actor.userId });
      store.invalidate(actor.tenantId);
      return rule;
    },

    async reorder(ids, { actor }) {
      await begin(actor);
      for (const id of ids) await requireRule(id, actor);
      await adapter.rules.reorder(actor.tenantId, ids);
      store.invalidate(actor.tenantId);
    },

    async delete(id, { actor }) {
      await begin(actor);
      await requireRule(id, actor);
      await adapter.rules.delete(id);
      store.invalidate(actor.tenantId);
    },
  };
}
