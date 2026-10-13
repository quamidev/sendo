// Installed by `npx shadcn add @sendo/inbox`, then adapted for the playground: the operator comes
// from the playground's auth (fixed dev user in fixtures mode), realtime is on only in
// Supabase mode, the rail links every installed item and names come from lib/playground-users.
// Kept on reinstall (see scripts/registry-install.mjs).
import type { InboxContact, TenantId } from "@quami/sendo";
import type { InboxNavLinks } from "@/components/sendo/types";
import { requireUser as requireAppUser } from "@/lib/auth";
import { realtimeEnabled } from "@/lib/playground-env";
import { playgroundUserNames } from "@/lib/playground-users";
import { playground } from "@/lib/sendo";

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

/** Every Sendo screen the playground installs. */
export const inboxNav: InboxNavLinks = {
  numbers: "/inbox/numbers",
  rules: "/inbox/rules",
  broadcasts: "/inbox/broadcasts",
  metrics: "/inbox/metrics",
  links: "/inbox/links",
};

export function resolveUserNames(ids: string[]): Promise<Record<string, string>> {
  return Promise.resolve(playgroundUserNames(ids));
}

/** The playground has no residents app; references show as text. */
export function contactAppHref(_contact: InboxContact): string | null {
  return null;
}

export const inboxAgentNames: Record<string, string> = { recepcion: "Recepción IA" };
