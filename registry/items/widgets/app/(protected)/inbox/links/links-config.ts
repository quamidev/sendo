import type { TenantId } from "@quami/sendo";

export interface LinksUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose numbers and sources the user manages; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/**
 * The signed-in user. The links page and every server action call it first.
 * Fails closed: until it is implemented, the page throws instead of showing data.
 * If you installed inbox, return the same user as its `inbox-config.ts`.
 */
export function requireUser(): Promise<LinksUser> {
  // TODO: implement requireUser() with your app's auth: return the user's id and tenant
  // (e.g. from the session and `app_metadata.tenant_id`), or redirect to your login page.
  return Promise.reject(
    new Error(
      "sendo links: implement requireUser() in app/(protected)/inbox/links/links-config.ts before using the links page.",
    ),
  );
}
