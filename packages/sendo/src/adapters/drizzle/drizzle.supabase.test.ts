import { drizzle } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePostgresJs } from "drizzle-orm/postgres-js";
import pg from "pg";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { runAdapterContract } from "../contract";
import { SENDO_TABLES } from "../types";
import { memoryAdapter } from "../memory";
import { DEFAULT_ADMIN_URL, canConnect, createScratchDatabase } from "./scratch-database";
import { drizzleAdapter } from ".";

/**
 * Runs the adapter contract on `drizzleAdapter` (node-postgres and postgres-js) against the local Supabase
 * Postgres (`pnpm supabase start`), in a throwaway database of its own:
 * `sendo_drizzle_contract_<epoch>_<random>` gets the plain-Postgres prelude and the
 * `sendo-schema` migrations, and is dropped afterwards (leftovers older than an hour are
 * dropped by the next run). No other suite's rows are read or written. Every table except
 * `sendo_schema_meta` is truncated after each test, so each starts from an empty schema.
 * - `SENDO_TEST_DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:55322/postgres`):
 *   a role allowed to create databases.
 * Skips when Postgres is unreachable unless `SENDO_REQUIRE_SUPABASE=1`.
 */
const ADMIN_URL = process.env.SENDO_TEST_DATABASE_URL ?? DEFAULT_ADMIN_URL;
const REQUIRED = process.env.SENDO_REQUIRE_SUPABASE === "1";

const reachable = await canConnect(ADMIN_URL);
const scratch = reachable ? await createScratchDatabase(ADMIN_URL, "sendo_drizzle_contract") : null;
const pool = scratch ? new pg.Pool({ connectionString: scratch.url, max: 10 }) : null;
const sqlClient = scratch ? postgres(scratch.url, { max: 10, onnotice: () => {} }) : null;

if (!reachable && REQUIRED) {
  describe("drizzle adapter prerequisites", () => {
    it("has a reachable local Postgres", () => {
      expect.fail(
        `Postgres unreachable at ${ADMIN_URL}. Run \`pnpm supabase start\` or set SENDO_TEST_DATABASE_URL.`,
      );
    });
  });
}

const TRUNCATE = `truncate ${SENDO_TABLES.filter((t) => t !== "sendo_schema_meta").join(", ")} cascade`;
const truncate = async (): Promise<void> => {
  await pool?.query(TRUNCATE);
};

afterAll(async () => {
  await pool?.end();
  await sqlClient?.end();
  await scratch?.drop();
});

runAdapterContract(
  "drizzle (node-postgres)",
  () => {
    if (!pool) throw new Error("no database");
    return drizzleAdapter({ db: drizzle({ client: pool }), media: memoryAdapter().storage });
  },
  { skip: reachable ? false : "Postgres unreachable", afterEach: truncate },
);

runAdapterContract(
  "drizzle (postgres-js)",
  () => {
    if (!sqlClient) throw new Error("no database");
    return drizzleAdapter({ db: drizzlePostgresJs({ client: sqlClient }) });
  },
  { skip: reachable ? false : "Postgres unreachable", afterEach: truncate },
);
