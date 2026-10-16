// Installed by `npx shadcn add @sendo/metrics`, then adapted for the playground: the user comes from
// the playground's auth (fixed dev user in fixtures mode). Kept on reinstall
// (see scripts/registry-install.mjs).
import type { TenantId } from "@quami/sendo";
import { requireUser as requireAppUser } from "@/lib/auth";
import { playground } from "@/lib/sendo";

export interface MetricsUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose metrics the user reads; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/** First period the screen opens with (7, 30 or 90 days, ending today). */
export const DEFAULT_RANGE_DAYS = 30;

/** The signed-in user (redirects to /login), once the fixtures are seeded. */
export async function requireUser(): Promise<MetricsUser> {
  const user = await requireAppUser();
  await playground.ready;
  return user;
}
