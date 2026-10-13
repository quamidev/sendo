import type { Account, AgentMode, Channel, OnboardedVia } from "@quami/sendo";

/** One number as the screen sees it (dates as ISO strings, no token data). */
export interface NumberView {
  id: string;
  channel: Channel;
  label: string | null;
  displayPhone: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  active: boolean;
  isDefault: boolean;
  coexistence: boolean;
  onboardedVia: OnboardedVia;
  agentPaused: boolean;
  agentMode: AgentMode | null;
  billingReady: boolean | null;
  billingCheckedAt: string | null;
  /** Meta answered the last check with an invalid-token error (`account.error`, code 190). */
  tokenInvalid: boolean;
  createdAt: string;
}

export type NumberStatus =
  "connected" | "billing_missing" | "billing_unknown" | "token_invalid" | "disconnected";

export function serializeNumber(account: Account, tokenInvalid = false): NumberView {
  return {
    id: account.id,
    channel: account.channel,
    label: account.label,
    displayPhone: account.displayPhone,
    phoneNumberId: account.phoneNumberId,
    wabaId: account.wabaId,
    active: account.active,
    isDefault: account.isDefault,
    coexistence: account.coexistence,
    onboardedVia: account.onboardedVia,
    agentPaused: account.agentPaused,
    agentMode: account.agentMode,
    billingReady: account.billingReady,
    billingCheckedAt: account.billingCheckedAt?.toISOString() ?? null,
    tokenInvalid: account.active && tokenInvalid,
    createdAt: account.createdAt.toISOString(),
  };
}

/** Disconnected wins, then an invalid token, then the payment method. */
export function numberStatus(view: NumberView): NumberStatus {
  if (!view.active) return "disconnected";
  if (view.tokenInvalid) return "token_invalid";
  if (view.billingReady === false) return "billing_missing";
  if (view.billingReady === null) return "billing_unknown";
  return "connected";
}

/** The last `count` digits of the display phone (what the disconnect dialog asks for). */
export function lastDigits(displayPhone: string, count = 4): string {
  return displayPhone.replace(/\D/g, "").slice(-count);
}

export type NumbersErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID"
  | "ACCOUNT_STATE"
  | "WRONG_NUMBER"
  | "CONFIRMATION_MISMATCH"
  | "SIGNUP_CODE_EXPIRED"
  | "META_PERMISSION_MISSING"
  | "PIN_CONFLICT"
  | "SIGNUP_FAILED"
  | "ACCOUNT_EXISTS"
  | "ALREADY_CONNECTED"
  | "CONFIG_ERROR"
  | "UNKNOWN";

export type NumbersActionResult<T> =
  { ok: true; data: T } | { ok: false; code: NumbersErrorCode; message: string };

/** `manage`: admin (`numbers.manage`); `read`: read-only list; `hidden`: not shown to this role. */
export type NumbersAccess = "manage" | "read" | "hidden";

export interface NumbersPage {
  access: NumbersAccess;
  numbers: NumberView[];
}

/** Every number of the tenant after a change, plus the id of the number it touched. */
export interface NumbersMutation {
  numbers: NumberView[];
  id: string;
}

/** What the connect button captured from Embedded Signup. */
export interface ConnectNumberInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  coexistence: boolean;
  /** The number's existing two-step PIN (after `PIN_CONFLICT`). */
  pin?: string;
  /** Reconnect this number (invalid token or disconnected): it must be the number chosen in Meta. */
  reconnectId?: string;
}

export interface NumbersActions {
  list: () => Promise<NumbersActionResult<NumbersPage>>;
  connect: (input: ConnectNumberInput) => Promise<NumbersActionResult<NumbersMutation>>;
  setDefault: (id: string) => Promise<NumbersActionResult<NumbersMutation>>;
  setLabel: (id: string, label: string) => Promise<NumbersActionResult<NumbersMutation>>;
  pauseAgent: (id: string, paused: boolean) => Promise<NumbersActionResult<NumbersMutation>>;
  setAgentMode: (
    id: string,
    mode: AgentMode | null,
  ) => Promise<NumbersActionResult<NumbersMutation>>;
  refreshBilling: (id: string) => Promise<NumbersActionResult<NumbersMutation>>;
  /** `confirmation`: the last 4 digits the admin typed; checked again on the server. */
  disconnect: (id: string, confirmation: string) => Promise<NumbersActionResult<NumbersMutation>>;
}

/** Browser-side Embedded Signup settings (public values only). */
export interface EmbeddedSignupClientConfig {
  /** Meta app id (`NEXT_PUBLIC_SENDO_META_APP_ID`). */
  appId: string;
  /** Embedded Signup configuration id (`NEXT_PUBLIC_SENDO_META_CONFIG_ID`). */
  configId: string;
  /** Graph API version for `FB.init` (the package's `GRAPH_API_VERSION`). */
  graphVersion: string;
  /** Offer the "number already in the WhatsApp Business app" (coexistence) flavour. Default `true`. */
  coexistence?: boolean;
  /** Facebook JS SDK URL. Default `https://connect.facebook.net/en_US/sdk.js`. */
  sdkUrl?: string;
  /** Extra origins trusted to post `WA_EMBEDDED_SIGNUP` messages (`"self"` = this page). Tests and fakes only. */
  trustedOrigins?: string[];
}

export interface NumbersLinks {
  /** The inbox (rail and mobile back link). */
  inbox: string;
  /** Meta page where the business adds a payment method; `{wabaId}` is replaced. */
  metaBilling: string;
  /** Docs on Meta's Embedded Signup requirements (missing permission error). */
  metaRequirements: string;
}
