import { redirect } from "next/navigation";
import { FIXTURES_DEV_USER_ID, PLAYGROUND_TENANT_ID, playgroundMode } from "@/lib/playground-env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AppUser {
  userId: string;
  tenantId: string;
}

/** Fixtures mode has no auth: everyone is the dev user of the playground tenant. */
export const FIXTURES_DEV_USER: AppUser = {
  userId: FIXTURES_DEV_USER_ID,
  tenantId: PLAYGROUND_TENANT_ID,
};

/** The signed-in user, or `null`. The tenant comes from `app_metadata.tenant_id`. */
export async function getUser(): Promise<AppUser | null> {
  if (playgroundMode() === "fixtures") return FIXTURES_DEV_USER;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) return null;
  const tenantId: unknown = data.user.app_metadata.tenant_id;
  if (typeof tenantId !== "string" || tenantId === "") return null;
  return { userId: data.user.id, tenantId };
}

/** For pages and server actions: redirects to `/login` when nobody is signed in. */
export async function requireUser(): Promise<AppUser> {
  const user = await getUser();
  if (user === null) redirect("/login");
  return user;
}
