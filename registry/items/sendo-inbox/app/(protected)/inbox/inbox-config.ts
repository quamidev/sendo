import type { TenantId } from "@quami/sendo";

export interface InboxUser {
  /** Stored as `senderRef` of the operator's replies and used for "Asignadas a mí". */
  userId: string;
  /** Tenant whose conversations the operator may see; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/**
 * The signed-in operator. The inbox page and every server action call it first.
 * Fails closed: until it is implemented, the inbox throws instead of showing data.
 */
export function requireUser(): Promise<InboxUser> {
  // TODO: implement requireUser() with your app's auth: return the operator's id and tenant
  // (e.g. from the session and `app_metadata.tenant_id`), or redirect to your login page.
  return Promise.reject(
    new Error(
      "sendo inbox: implement requireUser() in app/(protected)/inbox/inbox-config.ts before using the inbox.",
    ),
  );
}

/** Live updates through Supabase Realtime (needs the browser URL and anon key). */
export function inboxRealtimeEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
