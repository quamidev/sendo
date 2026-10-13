"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { demoRealtimeClient } from "@/components/demo/demo-realtime";

/**
 * App-owned hook of the `sendo-inbox` item (the registry ships a Supabase version). The site's
 * demo inbox has no database: its live updates come from the demo conversation in the page.
 */
export function getSendoRealtimeClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  return demoRealtimeClient;
}
