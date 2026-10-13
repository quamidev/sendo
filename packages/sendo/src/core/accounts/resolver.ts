import type { SendoAdapter } from "../../adapters/types";
import { AccountNotFoundError, AmbiguousAccountError } from "../../errors/errors";
import type { Account, TenantId } from "../../types/entities";

/** Which account an account-scoped call uses (`send.*`, `templates.*`...). */
export interface AccountOption {
  /** Account object, account id or Meta phone number id. */
  account?: string | Account;
  /** Scope to a tenant (its default number); `null` = accounts without tenant. */
  tenant?: TenantId;
}

export type ResolveAccount = (opts?: AccountOption) => Promise<Account>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** By id, then by phone number id. Active or not; `null` when unknown. */
export async function findAccount(adapter: SendoAdapter, ref: string): Promise<Account | null> {
  if (isUuid(ref)) {
    return (
      (await adapter.accounts.getById(ref)) ?? (await adapter.accounts.getByPhoneNumberId(ref))
    );
  }
  return adapter.accounts.getByPhoneNumberId(ref);
}

/**
 * Resolution order (product spec AC-AC-2):
 * - `account` given: an object is used as is; an id or phone number id must be active. With `tenant`,
 *   a different tenant → `AccountNotFoundError`.
 * - `tenant` given: the tenant's default active account, else its only active account.
 *   Several and no default → `AmbiguousAccountError` with that tenant's candidates; none →
 *   `AccountNotFoundError`.
 * - neither: the only active account; none → `AccountNotFoundError`, several →
 *   `AmbiguousAccountError` (the message suggests `{ tenant }`).
 */
export function createAccountResolver(adapter: SendoAdapter): ResolveAccount {
  return async (opts = {}) => {
    const { account: ref, tenant } = opts;
    if (ref !== undefined) {
      const account = typeof ref === "string" ? await findAccount(adapter, ref) : ref;
      const label = typeof ref === "string" ? ref : ref.id;
      if (typeof ref === "string" && !account?.active) {
        throw new AccountNotFoundError({ account: label });
      }
      if (account === null) throw new AccountNotFoundError({ account: label });
      if (tenant !== undefined && account.tenantId !== tenant) {
        throw new AccountNotFoundError({ account: label, tenantId: tenant });
      }
      return account;
    }
    if (tenant !== undefined) {
      const accounts = await adapter.accounts.list({ tenantId: tenant, active: true });
      const preferred =
        accounts.find((a) => a.isDefault) ?? (accounts.length === 1 ? accounts[0] : undefined);
      if (preferred) return preferred;
      if (accounts.length === 0) throw new AccountNotFoundError({ tenantId: tenant });
      throw new AmbiguousAccountError({ candidates: accounts.map((a) => a.id), tenantId: tenant });
    }
    const accounts = await adapter.accounts.list({ active: true });
    const [only] = accounts;
    if (only === undefined) throw new AccountNotFoundError();
    if (accounts.length > 1) {
      throw new AmbiguousAccountError({ candidates: accounts.map((a) => a.id) });
    }
    return only;
  };
}
