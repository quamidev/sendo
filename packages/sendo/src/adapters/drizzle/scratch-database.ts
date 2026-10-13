import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Test support (not exported): a throwaway Postgres database on the local Supabase server with
 * the plain-Postgres prelude and the `schema` migrations applied, so a SQL adapter's
 * contract run never touches the shared `postgres` database other suites use.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const MIGRATIONS_DIR = join(REPO_ROOT, "registry/items/schema/supabase/migrations");
const PRELUDE = join(REPO_ROOT, "registry/items/drizzle-schema/lib/db/sendo-postgres-prelude.sql");
/** Leftovers of crashed runs older than this are dropped by the next run. */
const STALE_AFTER_SEC = 60 * 60;

export const DEFAULT_ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";

export interface ScratchDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
}

/** `null` when the server is unreachable. */
export async function canConnect(adminUrl: string): Promise<boolean> {
  try {
    const client = await connect(adminUrl);
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates `<prefix>_<epoch>_<random>`, applies the prelude and every `sendo_v*` migration in
 * file-name order, and drops stale databases with the same prefix.
 */
export async function createScratchDatabase(
  adminUrl: string,
  prefix: string,
): Promise<ScratchDatabase> {
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

  const url = withDatabase(adminUrl, name);
  const client = await connect(url);
  try {
    await client.query(await readFile(PRELUDE, "utf8"));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /_sendo_v\d+\.sql$/.test(f)).sort();
    for (const file of files)
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
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
