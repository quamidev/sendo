import type { InboxContact, TenantId } from "@quami/sendo";
import type { InboxNavLinks } from "@/components/sendo/types";

export interface InboxUser {
  /** Stored as `senderRef` of the operator's replies and used for "Asignadas a mí". */
  userId: string;
  /** Tenant whose conversations the operator may see; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/**
 * The signed-in operator. The inbox page and every server action call it first, then resolve the
 * role with `sendo.actor()` (`resolveRole` in lib/sendo.ts). Both fail closed: until they are
 * implemented, the inbox throws (or shows "No tienes acceso a la bandeja") instead of data.
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

/**
 * Rail links to the other Sendo screens. Set the path of each registry item you installed;
 * `null` hides the entry.
 */
export const inboxNav: InboxNavLinks = {
  numbers: null, // "/inbox/numbers" with @sendo/numbers
  rules: null, // "/inbox/rules" with @sendo/workflows
  broadcasts: null, // "/inbox/broadcasts" with @sendo/broadcasts
  metrics: null, // "/inbox/metrics" with @sendo/metrics
  links: null, // "/inbox/links" with @sendo/widgets
};

/**
 * Display names for user ids: note authors, approvers, "Respondes como …". Use the same source
 * as `resolveUsers` in lib/sendo.ts. Unknown ids show "Persona del equipo".
 */
export function resolveUserNames(_ids: string[]): Promise<Record<string, string>> {
  return Promise.resolve({});
}

/** Link to the contact in your app ("Ver Apto 4B en la app"); `null` shows the reference as text. */
export function contactAppHref(_contact: InboxContact): string | null {
  return null;
}

/** Display names of your agents (`recepcion` → "Recepción IA"); others show "Agente IA · name". */
export const inboxAgentNames: Record<string, string> = {};
