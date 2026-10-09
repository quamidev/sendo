import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { envValue } from "@/lib/playground-env";

/** Anon-key client bound to the request cookies (Supabase Auth session). Server only. */
export async function createSupabaseServerClient() {
  const url = envValue("NEXT_PUBLIC_SUPABASE_URL") ?? envValue("SUPABASE_URL");
  const anonKey = envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (url === undefined || anonKey === undefined) {
    throw new Error(
      "[playground] Supabase Auth needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; middleware-less
          // apps refresh the session on the next Server Action or Route Handler.
        }
      },
    },
  });
}
