import type { TenantId } from "@quami/sendo";

export interface MetricsUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose metrics the user reads; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/** First period the screen opens with (7, 30 or 90 days, ending today). */
export const DEFAULT_RANGE_DAYS = 30;

/**
 * The signed-in user. The metrics page and every server action call it first.
 * Fails closed: until it is implemented, the page throws instead of showing data.
 * If you installed inbox, return the same user as its `inbox-config.ts`.
 */
export function requireUser(): Promise<MetricsUser> {
  // TODO: implement requireUser() with your app's auth: return the user's id and tenant
  // (e.g. from the session and `app_metadata.tenant_id`), or redirect to your login page.
  return Promise.reject(
    new Error(
      "sendo metrics: implement requireUser() in app/(protected)/inbox/metrics/metrics-config.ts before using the metrics page.",
    ),
  );
}
