import type { AccountInsertInput } from "../../adapters/types";
import { createConnectClient } from "../../connect/client";
import type { Account, TenantId } from "../../types/entities";
import type { AgentMode } from "../../types/enums";
import type { MetaDirectTransport } from "../../transport/meta-direct";
import { assertCan, requireActor, type Actor } from "../../team/permissions";
import { requireWabaId } from "../../utils/channel-ids";
import type { SendoContext } from "../context";
import type { SendoEventMap } from "../events";
import type { AccountsEventMap } from "./events";
import { createRefreshBilling } from "./billing";
import { createCompleteEmbeddedSignup, type CompleteEmbeddedSignupInput } from "./embedded-signup";
import { exportAccount } from "./export";
import {
  connectAccount,
  disconnectAccount,
  purgeAccount,
  requireAccount,
  setDefaultAccount,
  type AccountOpsDeps,
  type DisconnectOptions,
} from "./operations";

export interface AccountsListQuery {
  /** Only this tenant's accounts (`null` = accounts without tenant). Omitted = every tenant. */
  tenant?: TenantId;
  /** Include disconnected accounts. Default `false`. */
  includeInactive?: boolean;
}

/**
 * `sendo.accounts`. Methods taking an `id` also accept the Meta phone number id; an unknown
 * one throws `AccountNotFoundError`. Server-side only: permission checks (`numbers.manage`)
 * belong to the caller, except `export`, which takes the actor.
 */
export interface AccountsApi {
  /** Oldest first. */
  list(query?: AccountsListQuery): Promise<Account[]>;
  /** Active or not. */
  get(id: string): Promise<Account>;
  /**
   * Registers a number (the programmatic `sendo accounts add`). A number disconnected in the
   * same tenant is reconnected with the same id and history; connected elsewhere →
   * `DuplicateAccountError`. Becomes the default when `isDefault` is `true` or when it is the
   * tenant's only active number (unless `isDefault: false`).
   */
  add(input: AccountInsertInput): Promise<Account>;
  /** Atomic default swap within the tenant; emits `account.default`. Disconnected → `AccountStateError`. */
  setDefault(id: string): Promise<Account>;
  /** Empty or blank → `null`. */
  setLabel(id: string, label: string | null): Promise<Account>;
  /** Pauses (or resumes) AI turns on every conversation of the number. */
  pauseAgent(id: string, paused: boolean, opts?: { by?: string }): Promise<Account>;
  /** `null` = the agent definition's own mode. */
  setAgentMode(id: string, mode: AgentMode | null): Promise<Account>;
  /**
   * Re-reads the payment method on Meta: `true`/`false` from Meta replaces the value, an error
   * keeps it; `billingCheckedAt` is always set and `account.billing` fires on change.
   */
  refreshBilling(id: string): Promise<Account>;
  /** See `disconnectAccount`: keeps the data, promotes the tenant's only remaining number. */
  disconnect(id: string, opts?: DisconnectOptions): Promise<Account>;
  /** Deletes a disconnected account, its data and its media objects. Active → `AccountStateError`. */
  purge(id: string): Promise<void>;
  /**
   * Streams the number's history (active or disconnected) as chunks of one
   * `SendoExportDocumentV1` JSON document: contacts, tags, conversations with every message,
   * note, draft and system line, and media references (URLs signed for 7 days). A snapshot as
   * of `exportedAt`. An actor without `numbers.manage` throws `ForbiddenError` on the call,
   * before any chunk; an account of another tenant rejects the first chunk with
   * `AccountNotFoundError`. Name the file with `exportFileName`.
   */
  export(id: string, opts: { actor: Actor }): AsyncIterable<string>;
  /** Finishes Embedded Signup server-side (see `createCompleteEmbeddedSignup`). */
  completeEmbeddedSignup(input: CompleteEmbeddedSignupInput): Promise<Account>;
}

/** The account operations bound to a client's adapter, emitter, logger and token hooks. */
export function accountOpsDeps(ctx: SendoContext): AccountOpsDeps {
  return {
    adapter: ctx.adapter,
    media: ctx.config.media,
    logger: ctx.logger,
    emit: <E extends keyof AccountsEventMap>(event: E, payload: AccountsEventMap[E]) =>
      ctx.emitter.emit(event, payload as SendoEventMap[E]),
    deleteToken: ctx.accountsConfig.deleteToken,
    async unsubscribeApp(account) {
      if (ctx.transport.kind !== "meta-direct") {
        ctx.logger.warn(
          `[sendo] The "${ctx.transport.kind}" transport cannot unsubscribe the app from WABA ${account.wabaId ?? "?"}; do it in Meta Business Settings.`,
        );
        return;
      }
      const transport = ctx.transport as MetaDirectTransport;
      const token = await transport.resolveToken(account);
      ctx.addSecret(token);
      await transport.graph.unsubscribeApp(token, requireWabaId(account));
    },
    connect:
      ctx.config.connect === null ? null : createConnectClient({ config: ctx.config.connect }),
  };
}

export function createAccountsApi(ctx: SendoContext): AccountsApi {
  const deps = accountOpsDeps(ctx);
  const { adapter } = ctx;
  const completeEmbeddedSignup = createCompleteEmbeddedSignup(ctx, deps);
  const refreshBilling = createRefreshBilling(ctx);

  async function patch(
    id: string,
    fields: Parameters<typeof adapter.accounts.update>[1],
  ): Promise<Account> {
    await ctx.ready();
    const account = await requireAccount(adapter, id);
    return adapter.accounts.update(account.id, fields);
  }

  return {
    async list(query = {}) {
      await ctx.ready();
      return adapter.accounts.list({
        ...(query.tenant !== undefined && { tenantId: query.tenant }),
        ...(query.includeInactive !== true && { active: true }),
      });
    },
    async get(id) {
      await ctx.ready();
      return requireAccount(adapter, id);
    },
    async add(input) {
      await ctx.ready();
      return connectAccount(deps, input);
    },
    async setDefault(id) {
      await ctx.ready();
      return setDefaultAccount(deps, id);
    },
    setLabel(id, label) {
      const trimmed = label?.trim() ?? "";
      return patch(id, { label: trimmed === "" ? null : trimmed });
    },
    async pauseAgent(id, paused, opts = {}) {
      const account = await patch(id, { agentPaused: paused });
      ctx.logger.info(
        `[sendo] Agent ${paused ? "paused" : "resumed"} on account ${account.id} by ${opts.by ?? "system"}`,
      );
      return account;
    },
    setAgentMode(id, mode) {
      return patch(id, { agentMode: mode });
    },
    async refreshBilling(id) {
      await ctx.ready();
      return refreshBilling(id);
    },
    async disconnect(id, opts) {
      await ctx.ready();
      return disconnectAccount(deps, id, opts);
    },
    async purge(id) {
      await ctx.ready();
      await purgeAccount(deps, id);
    },
    export(id, opts) {
      const actor = requireActor(opts.actor, "numbers.manage");
      assertCan(actor, "numbers.manage");
      return (async function* () {
        await ctx.ready();
        yield* exportAccount(deps, id, { tenantId: actor.tenantId });
      })();
    },
    async completeEmbeddedSignup(input) {
      await ctx.ready();
      return completeEmbeddedSignup(input);
    },
  };
}
