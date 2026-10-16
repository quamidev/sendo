import { GRAPH_API_VERSION, type TenantId } from "@quami/sendo";
import type { EmbeddedSignupClientConfig, NumbersLinks } from "@/components/sendo/numbers/types";

export interface NumbersUser {
  /** Passed to `sendo.actor()` (your `resolveRole` decides the role) and stored as `by`. */
  userId: string;
  /** The tenant whose numbers the user manages; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/**
 * The signed-in user. The numbers page and every server action call it first.
 * Fails closed: until it is implemented, the screen throws instead of showing numbers.
 */
export function requireUser(): Promise<NumbersUser> {
  // TODO: implement requireUser() with your app's auth: return the user's id and tenant, or
  // redirect to your login page. With @sendo/inbox installed you can reuse its helper:
  //   export { requireUser } from "../inbox-config";
  return Promise.reject(
    new Error(
      "sendo numbers: implement requireUser() in app/(protected)/inbox/numbers/numbers-config.ts before using the numbers screen.",
    ),
  );
}

export interface NumbersConfig {
  /** Users without `numbers.manage` (non-admins) see a read-only list; `false` hides the numbers. */
  numbersVisibleToNonAdmins: boolean;
  /**
   * Re-check every connected number on Meta when the screen loads (`refreshBilling`): updates
   * the payment state and marks numbers whose token Meta rejects ("Invalid token · reconnect").
   */
  checkTokensOnLoad: boolean;
  /** Longest the page waits for those checks; slower numbers keep their stored state. */
  tokenCheckTimeoutMs: number;
  /**
   * Shows "Delete history" on disconnected numbers and enables the `purge` action. Deleting is
   * permanent; whether and when to delete is your retention policy (docs: Retention).
   */
  allowPurge: boolean;
  links: NumbersLinks;
}

export const numbersConfig: NumbersConfig = {
  numbersVisibleToNonAdmins: true,
  checkTokensOnLoad: true,
  tokenCheckTimeoutMs: 6000,
  allowPurge: false,
  links: {
    inbox: "/inbox",
    metaBilling: "https://business.facebook.com/settings/whatsapp-business-accounts/{wabaId}",
    metaRequirements: "https://sendo.quami.dev/docs/embedded-signup",
    export: "/inbox/numbers/export/{id}",
  },
};

/** Embedded Signup in the browser; `null` (connect disabled) until both env vars are set. */
export function embeddedSignupConfig(): EmbeddedSignupClientConfig | null {
  const appId = process.env.NEXT_PUBLIC_SENDO_META_APP_ID?.trim() ?? "";
  const configId = process.env.NEXT_PUBLIC_SENDO_META_CONFIG_ID?.trim() ?? "";
  if (appId === "" || configId === "") return null;
  return { appId, configId, graphVersion: GRAPH_API_VERSION, coexistence: true };
}
