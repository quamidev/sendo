import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

/**
 * Test support for the Prisma adapter (not exported, not bundled):
 * - a throwaway database on the local Supabase Postgres with the plain-Postgres prelude and the
 *   `schema` migrations applied unmodified, so the contract run never touches the shared
 *   `postgres` database other suites use;
 * - a Prisma client generated from the `prisma-schema` item's `sendo.prisma` into
 *   `node_modules/.cache/sendo-prisma-contract/` (git-ignored, outside the published `files`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "../../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const MIGRATIONS_DIR = join(REPO_ROOT, "registry/items/schema/supabase/migrations");
export const PRISMA_ITEM_DIR = join(REPO_ROOT, "registry/items/prisma-schema/prisma");
const CLIENT_DIR = join(PACKAGE_ROOT, "node_modules/.cache/sendo-prisma-contract");
/** Leftovers of crashed runs older than this are dropped by the next run. */
const STALE_AFTER_SEC = 60 * 60;

export interface TestDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

/**
 * Creates `<prefix>_<epoch>_<random>` with the prelude and every `sendo_v*` migration applied
 * in file-name order; drops stale databases with the same prefix.
 */
export async function createTestDatabase(adminUrl: string, prefix: string): Promise<TestDatabase> {
  const now = Math.floor(Date.now() / 1000);
  const name = `${prefix}_${String(now)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = await connect(adminUrl);
  try {
    const { rows } = await admin.query<{ datname: string }>(
      "select datname from pg_database where datname like $1",
      [`${prefix}\\_%`],
    );
    for (const { datname } of rows) {
      const created = Number(datname.slice(prefix.length + 1).split("_")[0]);
      if (Number.isFinite(created) && now - created > STALE_AFTER_SEC) {
        await admin.query(`drop database if exists "${datname}" with (force)`);
      }
    }
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const u = new URL(adminUrl);
  u.pathname = `/${name}`;
  const url = u.toString();
  const client = await connect(url);
  try {
    await client.query(await readFile(join(PRISMA_ITEM_DIR, "sendo-postgres-prelude.sql"), "utf8"));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /_sendo_v\d+\.sql$/.test(f)).sort();
    for (const file of files) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
    }
  } finally {
    await client.end();
  }

  return {
    name,
    url,
    async drop() {
      const admin = await connect(adminUrl);
      try {
        await admin.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await admin.end();
      }
    },
  };
}

const MAIN_SCHEMA = `generator client {
  provider     = "prisma-client"
  output       = "../client"
  moduleFormat = "esm"
}

datasource db {
  provider = "postgresql"
}
`;

/**
 * Runs `prisma generate` on a schema folder (a generator/datasource file plus the item's
 * `sendo.prisma`) and imports the generated `client.ts`. Fails if the item's models don't
 * validate.
 */
export async function generatePrismaClient(): Promise<Record<string, unknown>> {
  await rm(CLIENT_DIR, { recursive: true, force: true });
  await mkdir(join(CLIENT_DIR, "schema"), { recursive: true });
  await writeFile(join(CLIENT_DIR, "schema/main.prisma"), MAIN_SCHEMA);
  await copyFile(join(PRISMA_ITEM_DIR, "sendo.prisma"), join(CLIENT_DIR, "schema/sendo.prisma"));
  await promisify(execFile)(
    join(PACKAGE_ROOT, "node_modules/.bin/prisma"),
    ["generate", "--schema", join(CLIENT_DIR, "schema")],
    {
      cwd: CLIENT_DIR,
      timeout: 120_000,
      env: { ...process.env, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    },
  );
  return (await import(pathToFileURL(join(CLIENT_DIR, "client/client.ts")).href)) as Record<
    string,
    unknown
  >;
}

/**
 * `prisma migrate diff` from the database at `url` to the generated schema folder (call after
 * `generatePrismaClient`). Returns the SQL Prisma Migrate would run; empty when the models
 * match the migrated database exactly.
 */
export async function migrateDiff(url: string): Promise<{ exitCode: number; script: string }> {
  await writeFile(
    join(CLIENT_DIR, "prisma.config.ts"),
    `export default { schema: "schema", datasource: { url: ${JSON.stringify(url)} } };\n`,
  );
  try {
    const { stdout } = await promisify(execFile)(
      join(PACKAGE_ROOT, "node_modules/.bin/prisma"),
      [
        "migrate",
        "diff",
        "--from-config-datasource",
        "--to-schema",
        "schema",
        "--script",
        "--exit-code",
      ],
      {
        cwd: CLIENT_DIR,
        timeout: 120_000,
        env: { ...process.env, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
      },
    );
    return { exitCode: 0, script: stdout };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof failed.code === "number" ? failed.code : 1,
      script: `${failed.stdout ?? ""}${failed.stderr ?? ""}`,
    };
  }
}

/** Removes the generated client. */
export async function removeGeneratedClient(): Promise<void> {
  await rm(CLIENT_DIR, { recursive: true, force: true });
}
