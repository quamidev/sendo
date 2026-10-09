import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAdapterContract } from "../contract";
import { makeAccountInput, makeInbound, makeTenantId, seedConversation } from "../contract/helpers";
import { memoryAdapter } from "../memory";
import { SENDO_TABLES, type SendoAdapter } from "../types";
import {
  DEFAULT_ADMIN_URL,
  type TestDatabase,
  canConnect,
  createTestDatabase,
  generatePrismaClient,
  migrateDiff,
  removeGeneratedClient,
} from "./test-database";
import { type PrismaClientLike, prismaAdapter } from ".";

/**
 * Runs the adapter contract on `prismaAdapter` against the local Supabase Postgres
 * (`pnpm supabase start`), in a throwaway database of its own: `sendo_prisma_contract_<epoch>_<random>`
 * gets the plain-Postgres prelude and the unmodified `sendo-schema` migrations, and is dropped
 * afterwards (leftovers older than an hour are dropped by the next run). No other suite's rows
 * are read or written; every table except `sendo_schema_meta` is truncated after each test.
 * The Prisma client is generated from the `sendo-prisma-schema` item (Prisma 7 +
 * `@prisma/adapter-pg`) into `node_modules/.cache/`, so the item's models are validated too
 * (`prisma generate`, a read through every model, and an empty `prisma migrate diff`).
 * - `SENDO_TEST_DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:55322/postgres`):
 *   a role allowed to create databases.
 * Skips when Postgres is unreachable unless `SENDO_REQUIRE_SUPABASE=1`.
 */
const ADMIN_URL = process.env.SENDO_TEST_DATABASE_URL ?? DEFAULT_ADMIN_URL;
const REQUIRED = process.env.SENDO_REQUIRE_SUPABASE === "1";
const reachable = await canConnect(ADMIN_URL);

if (!reachable && REQUIRED) {
  describe("prisma adapter prerequisites", () => {
    it("has a reachable local Postgres", () => {
      expect.fail(
        `Postgres unreachable at ${ADMIN_URL}. Run \`pnpm supabase start\` or set SENDO_TEST_DATABASE_URL.`,
      );
    });
  });
}

type GeneratedClient = PrismaClientLike & { $disconnect(): Promise<void> } & Record<
    string,
    unknown
  >;

let database: TestDatabase | null = null;
let prisma: GeneratedClient | null = null;
let adapter: SendoAdapter | null = null;

const TRUNCATE = `truncate ${SENDO_TABLES.filter((t) => t !== "sendo_schema_meta").join(", ")} cascade`;

beforeAll(async () => {
  if (!reachable) return;
  database = await createTestDatabase(ADMIN_URL, "sendo_prisma_contract");
  const generated = await generatePrismaClient();
  const PrismaClient = generated.PrismaClient as new (options: {
    adapter: PrismaPg;
  }) => GeneratedClient;
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: database.url }) });
  adapter = prismaAdapter({ prisma, media: memoryAdapter().storage });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await database?.drop();
  await removeGeneratedClient();
});

const truncate = async (): Promise<void> => {
  await prisma?.$executeRawUnsafe(TRUNCATE);
};

runAdapterContract(
  "prisma",
  () => {
    if (!adapter) throw new Error("no database");
    return adapter;
  },
  { skip: reachable ? false : "Postgres unreachable", afterEach: truncate },
);

describe.skipIf(!reachable)("prisma adapter: sendo-prisma-schema models and options", () => {
  /** Model delegate names of the generated client (`sendoAccount`, ...). */
  const MODELS = [
    "sendoAccount",
    "sendoContact",
    "sendoConversation",
    "sendoMessage",
    "sendoMedia",
    "sendoTemplate",
    "sendoEvent",
    "sendoLock",
    "sendoSchemaMeta",
    "sendoSnippet",
    "sendoTag",
    "sendoConversationTag",
    "sendoRule",
    "sendoBroadcast",
    "sendoBroadcastRecipient",
  ] as const;

  it("reads every sendo_* table through the item's models (one model per table)", async () => {
    if (!adapter || !prisma) throw new Error("no database");
    expect(MODELS).toHaveLength(SENDO_TABLES.length);
    const tenantId = makeTenantId();
    const { account, conversation } = await seedConversation(adapter, { tenantId });
    await adapter.messages.insertInbound(makeInbound(conversation));
    await adapter.messages.updateStatus("wamid.prisma-placeholder", "delivered");
    const tag = await adapter.tags.upsert({ tenantId, name: "VIP", color: "blue" });
    await adapter.tags.addToConversation(conversation.id, tag.id);
    await adapter.events.insert({ payload: { ok: true } });
    await adapter.locks.acquire("prisma-models", 60_000);

    for (const model of MODELS) {
      const delegate = prisma[model] as { findMany(): Promise<unknown[]> };
      await expect(delegate.findMany(), model).resolves.toBeInstanceOf(Array);
    }
    const accounts = (await (
      prisma.sendoAccount as { findMany(): Promise<{ id: string; tenantId: string | null }[]> }
    ).findMany()) as { id: string; tenantId: string | null }[];
    expect(accounts).toEqual([expect.objectContaining({ id: account.id, tenantId })]);
    const messages = (await (
      prisma.sendoMessage as { findMany(): Promise<{ direction: string; status: string }[]> }
    ).findMany()) as { direction: string; status: string }[];
    expect(messages.map((m) => [m.direction, m.status]).sort()).toEqual([
      ["inbound", "received"],
      ["outbound", "delivered"],
    ]);
    await truncate();
  });

  it("leaves Prisma Migrate nothing to change on the migrated database", async () => {
    if (!database) throw new Error("no database");
    const diff = await migrateDiff(database.url);
    expect(diff.script).not.toMatch(/^(ALTER|CREATE|DROP)\b/m);
    expect(diff.exitCode, diff.script).toBe(0);
  }, 120_000);

  it("reads the tables from the `schema` option", async () => {
    if (!prisma) throw new Error("no database");
    const elsewhere = prismaAdapter({ prisma, schema: "sendo_missing_schema" });
    expect(await elsewhere.healthCheck()).toEqual({ tablesOk: false, missing: [...SENDO_TABLES] });
    expect(await elsewhere.schemaVersion()).toBeNull();
    await expect(elsewhere.accounts.insert(makeAccountInput())).rejects.toMatchObject({
      name: "PrismaAdapterError",
      code: "42P01",
    });
  });
});
