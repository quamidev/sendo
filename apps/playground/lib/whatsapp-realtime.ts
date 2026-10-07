"use client";

// Installed by `shadcn add wa-li-inbox`, then adapted for the playground: the browser client
// comes from @supabase/ssr so it carries the operator's cookie session (RLS on wa_* tables).
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Browser Supabase client for the inbox's realtime subscriptions (`null` on the server or without env). */
export function getWhatsAppRealtimeClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || url === "" || anonKey === undefined || anonKey === "") return null;
  // createBrowserClient returns a singleton in the browser.
  return createBrowserClient(url, anonKey);
}
