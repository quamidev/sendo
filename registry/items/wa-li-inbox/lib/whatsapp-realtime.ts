"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client for the inbox's realtime subscriptions (`null` on the server or
 * without env). RLS applies (`wa_can_access_tenant`), so the client needs the operator's session.
 * TODO: if your app signs in with `@supabase/ssr`, return `createBrowserClient(...)` instead so
 * the cookie session is used.
 */
export function getWhatsAppRealtimeClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || url === "" || anonKey === undefined || anonKey === "") return null;
  client ??= createClient(url, anonKey);
  return client;
}
