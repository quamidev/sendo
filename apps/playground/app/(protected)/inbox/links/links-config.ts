// Installed by `shadcn add sendo-widgets`, then adapted for the playground: the user comes from
// the playground's auth (fixed dev user in fixtures mode). Kept on reinstall
// (see scripts/registry-install.mjs).
import type { TenantId } from "@quami/sendo";
import { requireUser as requireAppUser } from "@/lib/auth";
import { playground } from "@/lib/sendo";

export interface LinksUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose numbers and sources the user manages; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/** The signed-in user (redirects to /login), once the fixtures are seeded. */
export async function requireUser(): Promise<LinksUser> {
  const user = await requireAppUser();
  await playground.ready;
  return user;
}
