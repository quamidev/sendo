import type { AccountInsertInput, SendoAdapter } from "../../adapters/types";
import {
  AccountNotFoundError,
  AccountStateError,
  DuplicateAccountError,
} from "../../errors/errors";
import { NO_MEDIA_STORE_MESSAGE } from "../../media";
import type { MediaStore } from "../../media/types";
import type { Account, TenantId } from "../../types/entities";
import type { RedactingLogger } from "../../utils/logger";
import type { DeleteToken } from "./config";
import type { AccountsEventMap } from "./events";
import { findAccount } from "./resolver";

/**
 * What the account operations need. `createSendo` builds it from the context; the CLI builds
 * its own (no events, no `deleteToken`).
 */
export interface AccountOpsDeps {
  adapter: SendoAdapter;
  /** Where `purge` deletes the media objects (`config.media` or `adapter.storage`). */
  media: MediaStore | null;
  logger: RedactingLogger;
  emit<E extends keyof AccountsEventMap>(event: E, payload: AccountsEventMap[E]): Promise<void>;
  deleteToken: DeleteToken | null;
  /** `DELETE /{waba_id}/subscribed_apps` for Embedded Signup accounts; `null` skips it. */
  unsubscribeApp: ((account: Account) => Promise<void>) | null;
}

/** By id or phone number id, active or not; unknown → `AccountNotFoundError`. */
export async function requireAccount(adapter: SendoAdapter, ref: string): Promise<Account> {
  const account = await findAccount(adapter, ref);
  if (!account) throw new AccountNotFoundError({ account: ref });
  return account;
}

async function currentDefault(adapter: SendoAdapter, tenantId: TenantId): Promise<Account | null> {
  const accounts = await adapter.accounts.list({ tenantId, active: true });
  return accounts.find((a) => a.isDefault) ?? null;
}

/**
 * Makes the account its tenant's default (atomic swap) and emits `account.default`.
 * Disconnected account → `AccountStateError` (`inactive`). Already the default → no-op.
 */
export async function setDefaultAccount(deps: AccountOpsDeps, ref: string): Promise<Account> {
  const account = await requireAccount(deps.adapter, ref);
  if (!account.active) throw new AccountStateError({ accountId: account.id, state: "inactive" });
  if (account.isDefault) return account;
  const previous = await currentDefault(deps.adapter, account.tenantId);
  const updated = await deps.adapter.accounts.setDefault(account.id);
  await deps.emit("account.default", { tenantId: updated.tenantId, account: updated, previous });
  return updated;
}

/**
 * Inserts a number, or reconnects it (same id and history) when it exists disconnected in the
 * same tenant; connected anywhere or disconnected in another tenant → `DuplicateAccountError`.
 * It becomes the tenant's default when `isDefault` is `true`, or when it is the tenant's only
 * active number and `isDefault` is not `false`.
 */
export async function connectAccount(
  deps: AccountOpsDeps,
  input: AccountInsertInput,
): Promise<Account> {
  const { adapter } = deps;
  const tenantId = input.tenantId ?? null;
  const existing =
    input.phoneNumberId == null
      ? null
      : await adapter.accounts.getByPhoneNumberId(input.phoneNumberId);
  let account: Account;
  if (existing && input.phoneNumberId != null) {
    if (existing.active || existing.tenantId !== tenantId) {
      throw new DuplicateAccountError({ phoneNumberId: input.phoneNumberId });
    }
    account = await adapter.accounts.reactivate(input.phoneNumberId, input);
  } else {
    account = await adapter.accounts.insert({ ...input, isDefault: false });
  }
  if (input.isDefault === false) return account;
  if (input.isDefault !== true) {
    const active = await adapter.accounts.list({ tenantId, active: true });
    if (active.length !== 1 || active[0]?.id !== account.id) return account;
  }
  return setDefaultAccount(deps, account.id);
}

export interface DisconnectOptions {
  /** Recorded in `account.disconnected`. Default `"system"`. */
  by?: string;
}

/**
 * Product spec AC-AC-6: `active = false` and default cleared; the tenant's only remaining
 * active number becomes the default; best-effort app unsubscribe for Embedded Signup numbers;
 * `deleteToken(tokenRef)`; contacts, conversations and messages are kept. Emits
 * `account.disconnected`, and `account.default` when the tenant's default changed.
 * Already disconnected → returned unchanged, nothing emitted.
 */
export async function disconnectAccount(
  deps: AccountOpsDeps,
  ref: string,
  opts: DisconnectOptions = {},
): Promise<Account> {
  const { adapter, logger } = deps;
  const account = await requireAccount(adapter, ref);
  if (!account.active) return account;

  const disconnected = await adapter.accounts.update(account.id, {
    active: false,
    isDefault: false,
  });

  let promoted: Account | null = null;
  const remaining = await adapter.accounts.list({ tenantId: account.tenantId, active: true });
  const [only] = remaining;
  if (remaining.length === 1 && only !== undefined && !only.isDefault) {
    promoted = await adapter.accounts.setDefault(only.id);
  }

  if (account.onboardedVia === "embedded_signup" && deps.unsubscribeApp) {
    try {
      await deps.unsubscribeApp(account);
    } catch (error) {
      logger.warn(
        `[sendo] Could not unsubscribe the app from WABA ${account.wabaId ?? "?"} while disconnecting account ${account.id}`,
        error,
      );
    }
  }
  if (deps.deleteToken) {
    try {
      await deps.deleteToken(account.tokenRef);
    } catch (error) {
      logger.warn(`[sendo] deleteToken failed while disconnecting account ${account.id}`, error);
    }
  }

  await deps.emit("account.disconnected", { account: disconnected, by: opts.by ?? "system" });
  if (account.isDefault || promoted !== null) {
    await deps.emit("account.default", {
      tenantId: account.tenantId,
      account: promoted,
      previous: account.isDefault ? disconnected : null,
    });
  }
  return disconnected;
}

/**
 * Product spec AC-AC-7: deletes a disconnected account with its contacts, conversations,
 * messages, media rows and templates, then the media objects in storage. Active account →
 * `AccountStateError` (`active`), nothing deleted.
 */
export async function purgeAccount(deps: AccountOpsDeps, ref: string): Promise<void> {
  const { adapter, logger, media } = deps;
  const account = await requireAccount(adapter, ref);
  if (account.active) throw new AccountStateError({ accountId: account.id, state: "active" });
  const { storagePaths } = await adapter.accounts.purge(account.id);
  if (storagePaths.length === 0) return;
  if (media === null) {
    logger.warn(
      `[sendo] Account ${account.id} was purged but its ${storagePaths.length} media object(s) were not deleted. ${NO_MEDIA_STORE_MESSAGE}`,
      { storagePaths },
    );
    return;
  }
  try {
    await media.delete(storagePaths);
  } catch (error) {
    logger.error(
      `[sendo] Account ${account.id} was purged but ${storagePaths.length} media object(s) could not be deleted from storage`,
      { storagePaths, error },
    );
    throw error;
  }
}
