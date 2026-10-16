// Installed by `npx shadcn add @sendo/workflows`, then adapted for the playground: the user comes from
// the playground's auth (fixed dev user in fixtures mode). Kept on reinstall
// (see scripts/registry-install.mjs).
import type { TenantId } from "@quami/sendo";
import { requireUser as requireAppUser } from "@/lib/auth";
import { DEV_USER_EMAIL, devUserId } from "@/lib/playground-env";
import { playground } from "@/lib/sendo";

export interface RulesUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose rules the user manages; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/** The signed-in user (redirects to /login), once the fixtures are seeded. */
export async function requireUser(): Promise<RulesUser> {
  const user = await requireAppUser();
  await playground.ready;
  return user;
}

/** The playground knows one user by name: the dev user. */
export const resolveUserNames = (userIds: string[]): Promise<Record<string, string>> =>
  Promise.resolve(
    Object.fromEntries(
      userIds.filter((id) => id === devUserId()).map((id) => [id, DEV_USER_EMAIL]),
    ),
  );
