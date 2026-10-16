import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

/**
 * Service guards shared by every Supabase- or Postgres-backed suite (`packages/sendo`, `registry`).
 * A suite skips when its service is down and fails instead under `SENDO_REQUIRE_SUPABASE=1`
 * (`pnpm test:supabase`). Guarded `describe`s carry `meta.skipReason` so the skip-summary reporter
 * can say what was skipped and how to run it.
 */

export type SkipReason = "supabase" | "database";

declare module "vitest" {
  interface TaskMeta {
    /** Why a guarded suite skipped; the skip-summary reporter groups skips by it. */
    skipReason?: SkipReason;
  }
}

/** `SENDO_REQUIRE_SUPABASE=1`: a missing service fails the run instead of skipping. */
export const servicesRequired = process.env.SENDO_REQUIRE_SUPABASE === "1";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const DEFAULT_SUPABASE_URL = "http://127.0.0.1:55321";
const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

export interface SupabaseStatus {
  available: boolean;
  /** Why the suite can't run (`null` when it can). */
  unavailable: string | null;
  /** `SUPABASE_URL` without a trailing slash (default `http://127.0.0.1:55321`). */
  url: string;
  serviceRoleKey: string | null;
  anonKey: string | null;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function readKeys(): Promise<{ service: string | null; anon: string | null }> {
  let service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  let anon = process.env.SUPABASE_ANON_KEY ?? null;
  if (service !== null && anon !== null) return { service, anon };
  try {
    const { stdout } = await promisify(execFile)(
      "npx",
      ["pnpm@10.34.6", "supabase", "status", "-o", "env"],
      { cwd: REPO_ROOT, timeout: 20_000 },
    );
    const read = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(stdout)?.[1];
    service ??= read("SERVICE_ROLE_KEY") ?? read("SECRET_KEY") ?? null;
    anon ??= read("ANON_KEY") ?? read("PUBLISHABLE_KEY") ?? null;
  } catch {
    // reported as unavailable by the caller
  }
  return { service, anon };
}

/**
 * Local Supabase at `SUPABASE_URL`, with the service role key (and the anon key when
 * `anonKey: true`) from `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` or `supabase status`.
 */
export async function supabaseAvailable(
  options: { anonKey?: boolean } = {},
): Promise<SupabaseStatus> {
  const url = (process.env.SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/+$/, "");
  if (!(await isReachable(url))) {
    return {
      available: false,
      unavailable: "Supabase unreachable",
      url,
      serviceRoleKey: null,
      anonKey: null,
    };
  }
  const keys = await readKeys();
  const unavailable =
    options.anonKey === true
      ? keys.service === null || keys.anon === null
        ? "SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY not found"
        : null
      : keys.service === null
        ? "SUPABASE_SERVICE_ROLE_KEY not set"
        : null;
  return {
    available: unavailable === null,
    unavailable,
    url,
    serviceRoleKey: keys.service,
    anonKey: keys.anon,
  };
}

export interface DatabaseStatus {
  available: boolean;
  unavailable: string | null;
  /** `SENDO_TEST_DATABASE_URL` (default: the local Supabase Postgres), a role allowed to create databases. */
  url: string;
}

/** Postgres at `SENDO_TEST_DATABASE_URL` accepts a connection. */
export async function databaseAvailable(): Promise<DatabaseStatus> {
  const url = process.env.SENDO_TEST_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.end();
    return { available: true, unavailable: null, url };
  } catch {
    return { available: false, unavailable: "Postgres unreachable", url };
  }
}
