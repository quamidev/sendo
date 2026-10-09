import type { SendoAdapter } from "../adapters/types";
import { AccountNotFoundError, AmbiguousAccountError } from "../errors/errors";
import type { Account } from "../types/entities";

export interface ResolveAccountOptions {
  /** Account object, account id or Meta phone number id. Optional when only one account is active. */
  account?: string | Account;
}

export type ResolveAccount = (opts?: ResolveAccountOptions) => Promise<Account>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

async function lookup(adapter: SendoAdapter, ref: string): Promise<Account | null> {
  if (isUuid(ref)) {
    return (
      (await adapter.accounts.getById(ref)) ?? (await adapter.accounts.getByPhoneNumberId(ref))
    );
  }
  return adapter.accounts.getByPhoneNumberId(ref);
}

/**
 * - `account` given: looked up by id, then by phone number id; unknown or inactive → `AccountNotFoundError`.
 * - omitted: the only active account; none → `AccountNotFoundError`, several → `AmbiguousAccountError`.
 */
export function createAccountResolver(adapter: SendoAdapter): ResolveAccount {
  return async (opts = {}) => {
    const ref = opts.account;
    if (ref !== undefined && typeof ref !== "string") return ref;
    if (ref !== undefined) {
      const account = await lookup(adapter, ref);
      if (!account?.active) throw new AccountNotFoundError({ account: ref });
      return account;
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
