/**
 * [CC-PAR-2] Metrics parity: the dataset of `metrics-dataset.ts` gives the same results
 * through (1) the memory adapter, (2) the Supabase adapter reading the `sendo_metrics_*`
 * views and (3) `METRICS_SQL` run directly against Postgres (what the Drizzle and Prisma
 * adapters execute), for every metric and every query in `metricsQueries`. The memory
 * results themselves are pinned in `metrics.test.ts`.
 *
 * Needs a local Supabase with schema v3 (`pnpm supabase start && pnpm supabase db reset`)
 * and postgres-meta (`/pg/query`) for (3).
 * Env: `SUPABASE_URL` (default `http://127.0.0.1:55321`), `SUPABASE_SERVICE_ROLE_KEY`
 * (default read from `supabase status -o env`). Skips when Supabase is unreachable unless
 * `SENDO_REQUIRE_SUPABASE=1`, where it fails instead.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import { type MetricsDbRow, metricsFromSql } from "../../src/adapters/metrics";
import { supabaseAdapter } from "../../src/adapters/supabase";
import { METRICS_SQL, metricsSqlParams } from "../../src/metrics/sql";
import {
  type Dataset,
  type MetricsSnapshot,
  type Stamper,
  memoryStamper,
  seedMetricsDataset,
  snapshot,
} from "./metrics-dataset";
import { servicesRequired, supabaseAvailable } from "../support/services";

const guard = await supabaseAvailable();
const SUPABASE_URL = guard.url;

const { serviceRoleKey, unavailable } = guard;

if (unavailable && servicesRequired) {
  describe("metrics parity prerequisites", () => {
    it("has a reachable local Supabase with a service role key", () => {
      expect.fail(
        `${unavailable} at ${SUPABASE_URL}. Run \`pnpm supabase start && pnpm supabase db reset\` ` +
          "or set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
      );
    });
  });
}

/** A SQL literal for one `metricsSqlParams` value. */
function literal(value: string | Date | string[] | null): string {
  if (value === null) return "null";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Array.isArray(value)) return `'{${value.join(",")}}'`;
  return `'${value.replace(/'/g, "''")}'`;
}

describe.skipIf(!guard.available)(
  "metrics parity: memory, Supabase views, METRICS_SQL",
  { meta: { skipReason: "supabase" } },
  () => {
    const key = serviceRoleKey ?? "missing";
    const admin = createClient(SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const supabase = supabaseAdapter(admin, { storageBucket: "sendo-media" });
    let memoryResult: MetricsSnapshot;
    let dataset: Dataset;

    async function pgQuery(sql: string): Promise<MetricsDbRow[]> {
      const response = await fetch(`${SUPABASE_URL}/pg/query`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });
      if (!response.ok) {
        throw new Error(`pg/query ${String(response.status)}: ${await response.text()}`);
      }
      return (await response.json()) as MetricsDbRow[];
    }

    /** Rewrites `created_at` after each adapter insert (the database stamps `now()`). */
    const supabaseStamper: Stamper = {
      at: () => {},
      async message(id, at) {
        const { error } = await admin
          .from("sendo_messages")
          .update({ created_at: at.toISOString() })
          .eq("id", id);
        if (error) throw new Error(error.message);
      },
      async conversation(id, at) {
        const { error } = await admin
          .from("sendo_conversations")
          .update({ created_at: at.toISOString(), last_activity_at: at.toISOString() })
          .eq("id", id);
        if (error) throw new Error(error.message);
      },
    };

    beforeAll(async () => {
      const clock = { current: new Date("2026-10-01T00:00:00Z") };
      const memory = memoryAdapter({ now: () => clock.current });
      memoryResult = await snapshot(
        memory.metrics,
        await seedMetricsDataset(memory, memoryStamper(clock)),
      );
      dataset = await seedMetricsDataset(supabase, supabaseStamper);
    }, 60_000);

    afterAll(async () => {
      const accounts = ["A", "B", "X"].map((label) => dataset.ids[label] ?? "");
      await admin.from("sendo_accounts").delete().in("id", accounts);
      await admin
        .from("sendo_tags")
        .delete()
        .eq("tenant_id", dataset.ids.T ?? "");
    });

    it("the Supabase views match the memory adapter", async () => {
      expect(await snapshot(supabase.metrics, dataset)).toEqual(memoryResult);
    });

    it("METRICS_SQL matches the memory adapter", async () => {
      const sqlMetrics = metricsFromSql(async (name, q) => {
        const params = metricsSqlParams(q);
        const text = METRICS_SQL[name].replace(/\$([1-5])/g, (_m, n: string) =>
          literal(params[Number(n) - 1] ?? null),
        );
        return pgQuery(text);
      });
      expect(await snapshot(sqlMetrics, dataset)).toEqual(memoryResult);
    });
  },
);
