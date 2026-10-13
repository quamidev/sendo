import type { TenantId } from "@quami/sendo";

export interface RulesUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose rules the user manages; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/**
 * The signed-in user. The rules page and every server action call it first.
 * Fails closed: until it is implemented, the page throws instead of showing data.
 * If you installed inbox, return the same user as its `inbox-config.ts`.
 */
export function requireUser(): Promise<RulesUser> {
  // TODO: implement requireUser() with your app's auth: return the user's id and tenant
  // (e.g. from the session and `app_metadata.tenant_id`), or redirect to your login page.
  return Promise.reject(
    new Error(
      "sendo rules: implement requireUser() in app/(protected)/inbox/rules/rules-config.ts before using the rules page.",
    ),
  );
}

/**
 * Optional: display names for the users who last edited each rule ("Editada por Ana").
 * Return `{ [userId]: name }`; unknown ids are shown without a name.
 */
export const resolveUserNames: (userIds: string[]) => Promise<Record<string, string>> = () =>
  Promise.resolve({});
