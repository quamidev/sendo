export type PlaygroundMode = "fixtures" | "supabase";

/** Tenant of the seeded dev user, the fixtures account and the Supabase seed. */
export const PLAYGROUND_TENANT_ID = "00000000-0000-4000-8000-00000000a001";

/** Dev user in fixtures mode (no Supabase Auth). Handoffs auto-assign to it. */
export const FIXTURES_DEV_USER_ID = "dev-user";

/** Seeded Supabase Auth user (`pnpm --filter playground seed`). */
export const SUPABASE_DEV_USER_ID = "00000000-0000-4000-8000-00000000d001";
export const DEV_USER_EMAIL = "dev@playground.local";
export const DEV_USER_PASSWORD = "playground";

/** Matches `FIXTURE_IDS` of the package webhook fixtures. */
export const PLAYGROUND_ACCOUNT = {
  phoneNumberId: "100000000000001",
  wabaId: "200000000000001",
  displayPhone: "15550001111",
  tokenRef: "WA_TOKEN_MAIN",
} as const;

/** Defaults used when the env var is missing (fixtures mode, fake Meta). Never use them in production. */
export const PLAYGROUND_DEFAULT_APP_SECRET = "playground-app-secret";
export const PLAYGROUND_DEFAULT_VERIFY_TOKEN = "playground-verify-token";

type Env = Record<string, string | undefined>;

/** Empty strings count as unset (`shadcn add` writes empty keys to `.env.local`). */
export function envValue(name: string, env: Env = process.env): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export interface SupabaseEnv {
  url: string;
  serviceRoleKey: string;
  anonKey: string | undefined;
}

export function supabaseEnv(env: Env = process.env): SupabaseEnv | null {
  const url = envValue("SUPABASE_URL", env) ?? envValue("NEXT_PUBLIC_SUPABASE_URL", env);
  const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY", env);
  if (url === undefined || serviceRoleKey === undefined) return null;
  return { url, serviceRoleKey, anonKey: envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", env) };
}

/**
 * `fixtures` when `WA_PLAYGROUND_MODE=fixtures` or when Supabase is not configured
 * (so `next build` never needs Supabase); otherwise `supabase`.
 */
export function playgroundMode(env: Env = process.env): PlaygroundMode {
  if (envValue("WA_PLAYGROUND_MODE", env) === "fixtures") return "fixtures";
  return supabaseEnv(env) === null ? "fixtures" : "supabase";
}

/** Fake Graph API in fixtures mode, or in Supabase mode with `WA_PLAYGROUND_FAKE_META=true`. */
export function fakeMetaEnabled(env: Env = process.env): boolean {
  return playgroundMode(env) === "fixtures" || envValue("WA_PLAYGROUND_FAKE_META", env) === "true";
}

export function devUserId(env: Env = process.env): string {
  return playgroundMode(env) === "fixtures" ? FIXTURES_DEV_USER_ID : SUPABASE_DEV_USER_ID;
}

/** Supabase Realtime for the inbox: off in fixtures mode (no Supabase). */
export function realtimeEnabled(env: Env = process.env): boolean {
  return playgroundMode(env) === "supabase";
}
