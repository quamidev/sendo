import { supabaseAdapter } from "../adapters/supabase";
import type { SendoAdapter } from "../adapters/types";
import { ConfigError } from "../errors/errors";

export const DEFAULT_STORAGE_BUCKET = "sendo-media";

export interface SupabaseEnvConfig {
  url: string;
  serviceRoleKey: string;
  storageBucket: string;
}

/** Reads `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, `SENDO_STORAGE_BUCKET`. */
export function supabaseEnvConfig(env: Record<string, string | undefined>): SupabaseEnvConfig {
  const url = (env.SUPABASE_URL ?? "").trim() || (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const missing = [
    url === "" ? "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)" : null,
    serviceRoleKey === "" ? "SUPABASE_SERVICE_ROLE_KEY" : null,
  ].filter((value): value is string => value !== null);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing Supabase variables: ${missing.join(", ")}. Add them to .env.local.`,
    );
  }
  const storageBucket = (env.SENDO_STORAGE_BUCKET ?? "").trim() || DEFAULT_STORAGE_BUCKET;
  return { url, serviceRoleKey, storageBucket };
}

/** Builds the Supabase adapter from env; `@supabase/supabase-js` is loaded lazily (optional peer). */
export async function createSupabaseAdapterFromEnv(
  env: Record<string, string | undefined>,
): Promise<SendoAdapter> {
  const config = supabaseEnvConfig(env);
  let supabase: Awaited<ReturnType<typeof loadSupabase>>;
  try {
    supabase = await loadSupabase();
  } catch (error) {
    throw new ConfigError(
      "@supabase/supabase-js was not found. Install it in your app: npm install @supabase/supabase-js",
      { cause: error },
    );
  }
  const client = supabase.createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return supabaseAdapter(client, { storageBucket: config.storageBucket });
}

function loadSupabase() {
  return import("@supabase/supabase-js");
}
