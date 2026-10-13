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
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { supabaseAdapter } from "../../src/adapters/supabase";
import { useGraphServer } from "../../src/core/test-utils";
import { servicesRequired, supabaseAvailable } from "../support/services";
import { flowA, flowB, flowDE, flowF, flowG, flowH, type FlowEnv } from "./flows";

const guard = await supabaseAvailable();
const SUPABASE_URL = guard.url;
const graph = useGraphServer({ passthrough: [SUPABASE_URL] });
const BUCKET = process.env.SENDO_TEST_STORAGE_BUCKET ?? "sendo-media";

const { serviceRoleKey, unavailable } = guard;

if (unavailable && servicesRequired) {
  describe("cross-flow prerequisites", () => {
    it("has a reachable local Supabase with a service role key", () => {
      expect.fail(
        `${unavailable} at ${SUPABASE_URL}. Run \`pnpm supabase start && pnpm supabase db reset\` ` +
          "or set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
      );
    });
  });
}

describe.skipIf(!guard.available)(
  `cross-flow scenarios (Supabase adapter)${unavailable ? ` (skipped: ${unavailable})` : ""}`,
  { timeout: 60_000, meta: { skipReason: "supabase" } },
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
