import type { GraphClient } from "../../client/graph-client";
import { AccountStateError } from "../../errors/errors";
import type { MetaDirectTransport } from "../../transport/meta-direct";
import type { Account } from "../../types/entities";
import { requireWabaId } from "../../utils/channel-ids";
import type { SendoContext } from "../context";
import type { SendoEventMap } from "../events";
import { requireAccount } from "./operations";

/** Re-reads the WABA's payment method and stores `billingReady` / `billingCheckedAt`. */
export type RefreshBilling = (accountId: string) => Promise<Account>;

/**
 * The WABA field that tells whether a payment method is attached (tech spec "Billing").
 * Unconfirmed against live Meta: the smoke run (`pnpm smoke:meta`) verifies it, and any
 * correction goes here and in `billingReadyFromWaba` only.
 */
export const WABA_FUNDING_FIELD = "primary_funding_id";

/**
 * Interprets `GET /{waba_id}?fields=primary_funding_id`: a non-empty funding id → `true`; a
 * WABA answer without it (Graph omits empty fields) → `false`; a body that is not a WABA
 * (no `id`) → `null` (unknown).
 */
export function billingReadyFromWaba(waba: Record<string, unknown>): boolean | null {
  if (typeof waba.id !== "string" && typeof waba.id !== "number") return null;
  const funding = waba[WABA_FUNDING_FIELD];
  if (typeof funding === "number") return true;
  return typeof funding === "string" && funding.trim() !== "";
}

/**
 * Reads the WABA's billing readiness from Meta (`true`, `false` or `null` = unknown).
 * Throws `MetaApiError` when Meta answers with an error.
 */
export async function readWabaBillingReady(
  graph: Pick<GraphClient, "getWaba">,
  token: string,
  wabaId: string,
): Promise<boolean | null> {
  return billingReadyFromWaba(await graph.getWaba(token, wabaId, [WABA_FUNDING_FIELD]));
}

async function emitBilling(
  ctx: SendoContext,
  account: Account,
  previous: boolean | null,
): Promise<void> {
  const payload: SendoEventMap["account.billing"] = {
    account,
    billingReady: account.billingReady,
    previous,
  };
  await ctx.emitter.emit("account.billing", payload);
}

/**
 * Checks billing on Meta and stores the result. Meta's answer (`true`/`false`) replaces the
 * value; an error or an unknown answer keeps it. `billingCheckedAt` is always set and
 * `account.billing` is emitted when the value changed. Never throws for Meta errors.
 * `token` skips `resolveToken` (Embedded Signup already holds the fresh token).
 */
export async function checkAccountBilling(
  ctx: SendoContext,
  account: Account,
  token?: string,
): Promise<Account> {
  let ready: boolean | null = null;
  if (ctx.transport.kind !== "meta-direct") {
    ctx.logger.warn(
      `[sendo] The "${ctx.transport.kind}" transport cannot read billing for account ${account.id}; billingReady unchanged.`,
    );
  } else {
    const transport = ctx.transport as MetaDirectTransport;
    try {
      const accessToken = token ?? (await transport.resolveToken(account));
      ctx.addSecret(accessToken);
      ready = await ctx.callTransport(account, () =>
        readWabaBillingReady(transport.graph, accessToken, requireWabaId(account)),
      );
    } catch (error) {
      ctx.logger.warn(
        `[sendo] Could not read billing for account ${account.id}; billingReady unchanged`,
        error,
      );
    }
  }

  const previous = account.billingReady;
  const updated = await ctx.adapter.accounts.update(account.id, {
    billingCheckedAt: new Date(),
    ...(ready !== null && { billingReady: ready }),
  });
  if (updated.billingReady !== previous) await emitBilling(ctx, updated, previous);
  return updated;
}

/**
 * Meta answered a send with 131042 (no payment method): stores `billingReady = false` and
 * emits `account.billing` when it changed. Best effort: storage errors are logged.
 */
export async function markBillingNotReady(ctx: SendoContext, account: Account): Promise<void> {
  try {
    const current = (await ctx.adapter.accounts.getById(account.id)) ?? account;
    const updated = await ctx.adapter.accounts.update(account.id, {
      billingReady: false,
      billingCheckedAt: new Date(),
    });
    if (current.billingReady !== false) await emitBilling(ctx, updated, current.billingReady);
  } catch (error) {
    ctx.logger.error(`[sendo] Could not mark account ${account.id} as billing not ready`, error);
  }
}

/**
 * `sendo.accounts.refreshBilling`: re-reads the payment method on Meta (the numbers screen's
 * "Ya lo agregué, verificar"). Disconnected account → `AccountStateError` (`inactive`).
 */
export function createRefreshBilling(ctx: SendoContext): RefreshBilling {
  return async (ref) => {
    const account = await requireAccount(ctx.adapter, ref);
    if (!account.active) throw new AccountStateError({ accountId: account.id, state: "inactive" });
    return checkAccountBilling(ctx, account);
  };
}
