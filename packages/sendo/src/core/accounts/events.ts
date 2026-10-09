import type { Account, TenantId } from "../../types/entities";

/** `billingReady` changed (refresh, or Meta error 131042 on a send). SND-2.3 emits it. */
export interface AccountBillingEvent {
  account: Account;
  billingReady: boolean | null;
  previous: boolean | null;
}

/** The tenant's default number changed. `account` is `null` when the tenant is left without one. */
export interface AccountDefaultEvent {
  tenantId: TenantId;
  account: Account | null;
  previous: Account | null;
}

export interface AccountDisconnectedEvent {
  /** The account after disconnecting (`active: false`, `isDefault: false`). */
  account: Account;
  /** `"system"` or the user id passed to `disconnect`. */
  by: string;
}

/** Merged into `SendoEventMap`. */
export interface AccountsEventMap {
  "account.billing": AccountBillingEvent;
  "account.default": AccountDefaultEvent;
  "account.disconnected": AccountDisconnectedEvent;
}
