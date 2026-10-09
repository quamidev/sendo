/**
 * [CC-PAR-2] for Drizzle: the `metrics-dataset.ts` dataset gives the same `metrics.*` results
 * through `drizzleAdapter` (node-postgres, `METRICS_SQL` with bound parameters) as through the
 * memory adapter, for every metric and every query in `metricsQueries`. Runs in its own
 * throwaway database (see `drizzle.supabase.test.ts`).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Dataset,
  type MetricsSnapshot,
  type Stamper,
  memoryStamper,
  seedMetricsDataset,
  snapshot,
} from "../../../test/integration/metrics-dataset";
import { memoryAdapter } from "../memory";
import { DEFAULT_ADMIN_URL, canConnect, createScratchDatabase } from "./scratch-database";
import { drizzleAdapter } from ".";

const ADMIN_URL = process.env.SENDO_TEST_DATABASE_URL ?? DEFAULT_ADMIN_URL;
const REQUIRED = process.env.SENDO_REQUIRE_SUPABASE === "1";
const reachable = await canConnect(ADMIN_URL);

if (!reachable && REQUIRED) {
  describe("drizzle metrics prerequisites", () => {
    it("has a reachable local Postgres", () => {
      expect.fail(`Postgres unreachable at ${ADMIN_URL}. Run \`pnpm supabase start\`.`);
    });
  });
}

describe.skipIf(!reachable)("metrics parity: memory and drizzleAdapter (METRICS_SQL)", () => {
  let scratch: Awaited<ReturnType<typeof createScratchDatabase>> | null = null;
  let pool: pg.Pool | null = null;
  let memoryResult: MetricsSnapshot;
  let dataset: Dataset;
  let adapter: ReturnType<typeof drizzleAdapter>;

  beforeAll(async () => {
    scratch = await createScratchDatabase(ADMIN_URL, "sendo_drizzle_metrics");
    const client = new pg.Pool({ connectionString: scratch.url, max: 5 });
    pool = client;
    adapter = drizzleAdapter({ db: drizzle({ client }) });

    /** Rewrites `created_at` after each adapter insert (the database stamps `now()`). */
    const stamper: Stamper = {
      at: () => {},
      async message(id, at) {
        await client.query("update sendo_messages set created_at = $1 where id = $2", [at, id]);
      },
      async conversation(id, at) {
        await client.query(
          "update sendo_conversations set created_at = $1, last_activity_at = $1 where id = $2",
          [at, id],
        );
      },
    };

    const clock = { current: new Date("2026-10-01T00:00:00Z") };
    const memory = memoryAdapter({ now: () => clock.current });
    memoryResult = await snapshot(
      memory.metrics,
      await seedMetricsDataset(memory, memoryStamper(clock)),
    );
    dataset = await seedMetricsDataset(adapter, stamper);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await scratch?.drop();
  });

  it("drizzleAdapter metrics match the memory adapter", async () => {
    expect(await snapshot(adapter.metrics, dataset)).toEqual(memoryResult);
  });
});
