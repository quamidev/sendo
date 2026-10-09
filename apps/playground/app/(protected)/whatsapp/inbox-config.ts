// Installed by `shadcn add wa-li-inbox`, then adapted for the playground: the operator comes
// from the playground's auth (fixed dev user in fixtures mode) and realtime is on only in
// Supabase mode. Kept on reinstall (see scripts/registry-install.mjs).
import type { TenantId } from "@quami/wa-li";
import { requireUser as requireAppUser } from "@/lib/auth";
import { realtimeEnabled } from "@/lib/playground-env";
import { playground } from "@/lib/whatsapp";

export interface InboxUser {
  /** Stored as `senderRef` of the operator's replies and used for "Asignadas a mí". */
  userId: string;
  /** Tenant whose conversations the operator may see; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/** The signed-in operator (redirects to /login), once the fixtures are seeded. */
export async function requireUser(): Promise<InboxUser> {
  const user = await requireAppUser();
  await playground.ready;
  return user;
}

/** Supabase Realtime is off in fixtures mode (no Supabase). */
export function inboxRealtimeEnabled(): boolean {
  return realtimeEnabled();
}
