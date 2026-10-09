/**
 * The cross-flow scenarios of `flows.ts` (see `flows.test.ts` for the failure list) on the
 * Supabase adapter, so `pnpm test:supabase` proves the flows end to end against Postgres, RPCs,
 * RLS-enabled tables and Storage.
 *
 * Needs a local Supabase (`pnpm supabase start && pnpm supabase db reset`):
 * - `SUPABASE_URL` (default `http://127.0.0.1:55321`)
 * - `SUPABASE_SERVICE_ROLE_KEY` (default: read from `supabase status -o env`)
 * - `SENDO_TEST_STORAGE_BUCKET` (default `sendo-media`)
 * Skips with "Supabase unreachable" unless `SENDO_REQUIRE_SUPABASE=1`, where it fails instead.
 * Each scenario uses its own tenant and phone number ids and purges them at the end.
 */
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { supabaseAdapter } from "../../src/adapters/supabase";
import { useGraphServer } from "../../src/core/test-utils";
import { flowA, flowB, flowDE, flowF, flowG, flowH, type FlowEnv } from "./flows";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "http://127.0.0.1:55321").replace(/\/+$/, "");
const graph = useGraphServer({ passthrough: [SUPABASE_URL] });
const BUCKET = process.env.SENDO_TEST_STORAGE_BUCKET ?? "sendo-media";
const REQUIRED = process.env.SENDO_REQUIRE_SUPABASE === "1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function readServiceRoleKey(): Promise<string | null> {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await promisify(execFile)(
      "npx",
      ["pnpm@10.34.6", "supabase", "status", "-o", "env"],
      { cwd: REPO_ROOT, timeout: 20_000 },
    );
    const read = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(stdout)?.[1];
    return read("SERVICE_ROLE_KEY") ?? read("SECRET_KEY") ?? null;
  } catch {
    return null;
  }
}

const reachable = await isReachable(SUPABASE_URL);
const serviceRoleKey = reachable ? await readServiceRoleKey() : null;
const unavailable = !reachable
  ? "Supabase unreachable"
  : !serviceRoleKey
    ? "SUPABASE_SERVICE_ROLE_KEY not set"
    : null;

if (unavailable && REQUIRED) {
  describe("cross-flow prerequisites", () => {
    it("has a reachable local Supabase with a service role key", () => {
      expect.fail(
        `${unavailable} at ${SUPABASE_URL}. Run \`pnpm supabase start && pnpm supabase db reset\` ` +
          "or set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
      );
    });
  });
}

describe.skipIf(unavailable !== null)(
  `cross-flow scenarios (Supabase adapter)${unavailable ? ` (skipped: ${unavailable})` : ""}`,
  { timeout: 60_000 },
  () => {
    const client = createClient(SUPABASE_URL, serviceRoleKey ?? "missing-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adapter = supabaseAdapter(client, { storageBucket: BUCKET });
    const env: FlowEnv = { kind: "supabase", server: graph.server, adapter: () => adapter };

    it("[FLOW-A] quickstart on Supabase", () => flowA(env));
    it("[FLOW-B] signup → default → billing unknown → first failed send, on Supabase", () =>
      flowB(env));
    it("[FLOW-DE] team day on Supabase", () => flowDE(env));
    it("[FLOW-F] rules sync then tick escalation on Supabase", () => flowF(env));
    it("[FLOW-G] link → source → metrics on Supabase", () => flowG(env));
    it("[FLOW-H] broadcast across ticks with an opt-out mid-run on Supabase", () => flowH(env));
  },
);
