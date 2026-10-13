import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import type { SendoAdapter } from "../adapters/types";
import { createGraphClient } from "../client/graph-client";
import { GRAPH, makeClient, useGraphServer } from "../core/test-utils";
import {
  SCHEMA_MIGRATIONS,
  SENDO_SCHEMA_VERSION,
  type SchemaMigration,
} from "../utils/schema-version";
import { doctorExitCode, runDoctor, type CheckResult, type RunDoctorOptions } from "./doctor";
import { runCli, type CliDeps } from "./main";
import {
  PHONE_NUMBER_ID,
  SENTINEL_TOKEN,
  SERVICE_ROLE_KEY,
  WEBHOOK_URL,
  doctorEnv,
  graphHandlers,
  healthyGraph,
  seededAdapter,
} from "./test-helpers";

const { server } = useGraphServer();

async function doctor(overrides: Partial<RunDoctorOptions> = {}) {
  const adapter = overrides.adapter === undefined ? await seededAdapter() : overrides.adapter;
  return runDoctor({
    env: doctorEnv(),
    graph: createGraphClient(),
    url: WEBHOOK_URL,
    ...overrides,
    adapter,
  });
}

function byId(results: CheckResult[], id: string): CheckResult {
  const result = results.find((r) => r.id === id);
  if (result === undefined)
    throw new Error(`missing check ${id}: ${results.map((r) => r.id).join(",")}`);
  return result;
}

const phoneId = `account:${PHONE_NUMBER_ID}:phone`;
const subscriptionId = `account:${PHONE_NUMBER_ID}:subscription`;

function allStrings(results: CheckResult[]): string {
  return JSON.stringify(results);
}

describe("runDoctor", () => {
  it("reports missing env vars including the account token env", async () => {
    server.use(...healthyGraph());
    const results = await doctor({
      env: doctorEnv({
        SENDO_META_APP_SECRET: "",
        SENDO_TOKEN_MAIN: undefined,
        SUPABASE_URL: undefined,
      }),
    });
    const env = byId(results, "env");
    expect(env.ok).toBe(false);
    expect(env.detail).toContain("SENDO_META_APP_SECRET");
    expect(env.detail).toContain("SENDO_TOKEN_MAIN");
    expect(env.detail).toContain("SUPABASE_URL");
    expect(env.fix?.detail).toBeDefined();
    const token = byId(results, `account:${PHONE_NUMBER_ID}:token`);
    expect(token.ok).toBe(false);
    expect(results.some((r) => r.id === phoneId)).toBe(false);
    expect(doctorExitCode(results)).toBe(1);
  });

  it("flags an expired token (190) with a clear hint and never leaks it", async () => {
    server.use(
      graphHandlers.phoneError(190),
      http.get(`https://graph.facebook.com/:v/:waba/subscribed_apps`, () =>
        HttpResponse.json({ error: { code: 190, message: "expired" } }, { status: 401 }),
      ),
      http.get(`https://graph.facebook.com/:v/:waba/message_templates`, () =>
        HttpResponse.json({ error: { code: 190, message: "expired" } }, { status: 401 }),
      ),
      graphHandlers.webhookEcho(),
    );
    const results = await doctor();
    const phone = byId(results, phoneId);
    expect(phone.ok).toBe(false);
    expect(phone.fix?.detail).toMatch(/expired or was revoked/);
    expect(allStrings(results)).not.toContain(SENTINEL_TOKEN);
  });

  it("reports missing tables", async () => {
    server.use(...healthyGraph());
    const adapter = await seededAdapter({ missingTables: ["sendo_locks", "sendo_media"] });
    const tables = byId(await doctor({ adapter }), "tables");
    expect(tables.ok).toBe(false);
    expect(tables.detail).toContain("sendo_locks");
    expect(tables.detail).toContain("sendo_media");
    expect(tables.fix?.detail).toMatch(/migration/);
  });

  it("lists the missing migrations in order when the database is behind", async () => {
    server.use(...healthyGraph());
    const v1 = SCHEMA_MIGRATIONS[0] as SchemaMigration;
    const v2 = {
      version: 2,
      file: "20261101000000_sendo_v2.sql",
      changelog: "https://sendo.dev/changelog#schema-v2",
    };
    const v3 = {
      version: 3,
      file: "20261201000000_sendo_v3.sql",
      changelog: "https://sendo.dev/changelog#schema-v3",
    };
    const schema = { version: 3, migrations: [v3, v1, v2] };

    const atV1 = byId(
      await doctor({ adapter: await seededAdapter({ schemaVersion: 1 }), schema }),
      "schema-version",
    );
    expect(atV1.ok).toBe(false);
    expect(atV1.detail).toBe(
      `Your database is at schema version 1 and Sendo expects 3. Run these migrations: ${v2.file}, ${v3.file}. Changes: ${v2.changelog}, ${v3.changelog}`,
    );
    expect(atV1.fix?.kind).toBe("migration");
    expect(atV1.fix?.detail).toContain(`${v2.file}, ${v3.file}`);
    expect(atV1.fix?.detail).toContain(v2.changelog);
    expect(atV1.fix?.detail).not.toContain(v1.file);
    expect(atV1.fix?.docsUrl).toMatch(/^https:\/\/sendo\.dev\/docs\/[a-z-]+$/);

    const atV2 = byId(
      await doctor({
        adapter: await seededAdapter({ schemaVersion: 2 }),
        schema: { version: 3, migrations: [v1, v2, v3] },
      }),
      "schema-version",
    );
    expect(atV2.detail).toContain(`Run these migrations: ${v3.file}.`);
    expect(atV2.detail).not.toContain(v2.file);
  });

  it("reports a newer or missing schema version", async () => {
    server.use(...healthyGraph());
    const newer = byId(
      await doctor({ adapter: await seededAdapter({ schemaVersion: SENDO_SCHEMA_VERSION + 1 }) }),
      "schema-version",
    );
    expect(newer.ok).toBe(false);
    expect(newer.fix).toMatchObject({ kind: "config" });
    expect(newer.fix?.detail).toMatch(/Upgrade @quami\/sendo/);
    const none = byId(
      await doctor({ adapter: await seededAdapter({ schemaVersion: null }) }),
      "schema-version",
    );
    expect(none.ok).toBe(false);
    expect(none.fix).toMatchObject({ kind: "migration" });
  });

  it("reports a missing storage bucket", async () => {
    server.use(...healthyGraph());
    const storage = byId(
      await doctor({
        adapter: await seededAdapter({ bucketExists: false }),
        env: doctorEnv({ SENDO_STORAGE_BUCKET: "media-x" }),
      }),
      "storage",
    );
    expect(storage.ok).toBe(false);
    expect(storage.detail).toContain("media-x");
  });

  it("fails an unsubscribed WABA instead of reporting OK", async () => {
    server.use(
      graphHandlers.phoneOk(),
      graphHandlers.subscribed([]),
      graphHandlers.templatesOk(),
      graphHandlers.webhookEcho(),
    );
    const sub = byId(await doctor(), subscriptionId);
    expect(sub.ok).toBe(false);
    expect(sub.fix?.detail).toMatch(/subscribed_apps/);
  });

  it("fails a webhook that answers with the wrong challenge", async () => {
    server.use(
      graphHandlers.phoneOk(),
      graphHandlers.subscribed(),
      graphHandlers.templatesOk(),
      http.get(WEBHOOK_URL, () => new HttpResponse("hello", { status: 200 })),
    );
    const hook = byId(await doctor(), "webhook-url");
    expect(hook.ok).toBe(false);
    expect(hook.detail).toContain("did not return the challenge");
  });

  it("fails a webhook with a mismatched verify token (403)", async () => {
    server.use(...healthyGraph());
    const hook = byId(
      await doctor({ env: doctorEnv({ SENDO_VERIFY_TOKEN: "other-verify-token" }) }),
      "webhook-url",
    );
    expect(hook.ok).toBe(false);
    expect(hook.detail).toContain("403");
    expect(hook.fix?.detail).toMatch(/SENDO_VERIFY_TOKEN/);
  });

  it("never throws when the adapter throws", async () => {
    server.use(graphHandlers.webhookEcho());
    const fail = () => Promise.reject(new Error(`boom ${SERVICE_ROLE_KEY}`));
    const broken = {
      ...memoryAdapter(),
      accounts: { ...memoryAdapter().accounts, list: fail },
      healthCheck: fail,
      schemaVersion: fail,
      storage: { ...memoryAdapter().storage, exists: fail },
    } as SendoAdapter;
    const results = await doctor({ adapter: broken });
    for (const id of ["tables", "schema-version", "storage", "accounts"]) {
      expect(byId(results, id).ok).toBe(false);
    }
    expect(allStrings(results)).not.toContain(SERVICE_ROLE_KEY);
  });
});

function cli(adapter: SendoAdapter | null, env = doctorEnv()) {
  const out: string[] = [];
  const deps: CliDeps = {
    env,
    cwd: "/app",
    stdout: (text) => out.push(text),
    stderr: () => undefined,
    readFile: () => null,
    createAdapter: () =>
      adapter === null ? Promise.reject(new Error("sin Supabase")) : Promise.resolve(adapter),
    version: "9.9.9",
  };
  return {
    run: (...args: string[]) => runCli(["doctor", "--url", WEBHOOK_URL, ...args], deps),
    stdout: () => out.join(""),
  };
}

describe("sendo doctor: schema drift and fix objects", () => {
  const current = SENDO_SCHEMA_VERSION - 1;
  const pending = SCHEMA_MIGRATIONS.filter((m) => m.version > current);

  it("prints the drift message with files and changelog, in the table and in --json", async () => {
    server.use(...healthyGraph());
    const table = cli(await seededAdapter({ schemaVersion: current }));
    expect(await table.run()).toBe(1);
    const head = `Your database is at schema version ${current} and Sendo expects ${SENDO_SCHEMA_VERSION}.`;
    expect(table.stdout()).toContain(
      `${head} Run these migrations: ${pending.map((m) => m.file).join(", ")}.`,
    );
    expect(table.stdout()).toContain(pending[0]?.changelog);
    expect(table.stdout()).toMatch(/Docs: https:\/\/sendo\.dev\/docs\//);

    server.use(...healthyGraph());
    const json = cli(await seededAdapter({ schemaVersion: current }));
    expect(await json.run("--json")).toBe(1);
    const schema = byId(JSON.parse(json.stdout()) as CheckResult[], "schema-version");
    expect(schema.detail.startsWith(head)).toBe(true);
    expect(schema.fix?.kind).toBe("migration");
    for (const m of pending) {
      expect(schema.fix?.detail).toContain(m.file);
      expect(schema.fix?.detail).toContain(m.changelog);
    }
  });

  it("the runtime warning uses the same wording as doctor", async () => {
    const { sendo, logs } = makeClient({ memory: { schemaVersion: current } });
    await sendo.templates.list();
    await sendo.templates.list();
    const doctorDetail = byId(
      await doctor({ adapter: await seededAdapter({ schemaVersion: current }), url: undefined }),
      "schema-version",
    ).detail;
    const warnings = logs.of("warn").filter((w) => w.includes("Your database is at"));
    expect(warnings).toEqual([`[sendo] ${doctorDetail}`]);
  });

  // AC-AD-4: audit of every doctor check family (incl. billing, added in phase 2). A new check
  // must show up failing in one of these scenarios and in the list below.
  it("every failing check in --json carries a fix with a kind and a docs link", async () => {
    const KINDS = ["env", "migration", "meta_permission", "billing", "webhook", "config"];
    const metaError = (code: number) =>
      HttpResponse.json({ error: { code, message: "no" } }, { status: 400 });
    const scenarios: {
      adapter: () => Promise<SendoAdapter | null>;
      env?: ReturnType<typeof doctorEnv>;
      graph: Parameters<typeof server.use>;
    }[] = [
      {
        adapter: () =>
          seededAdapter({
            missingTables: ["sendo_locks"],
            schemaVersion: current,
            bucketExists: false,
          }),
        graph: [
          graphHandlers.phoneOk("RED"),
          graphHandlers.subscribed([]),
          http.get(`${GRAPH}/:waba/message_templates`, () => metaError(200)),
          http.get(WEBHOOK_URL, () => new HttpResponse("hello", { status: 200 })),
        ],
      },
      {
        adapter: () => seededAdapter(),
        env: doctorEnv({ SENDO_META_APP_ID: "777" }),
        graph: [
          graphHandlers.phoneError(190),
          graphHandlers.subscribed(),
          http.get(`${GRAPH}/:waba/message_templates`, () => metaError(100)),
          http.get(WEBHOOK_URL, () => new HttpResponse("nope", { status: 404 })),
        ],
      },
      {
        adapter: () => seededAdapter({}, { wabaId: "" }),
        env: doctorEnv({ SENDO_VERIFY_TOKEN: "other-verify-token" }),
        graph: [graphHandlers.phoneError(10, 403), graphHandlers.webhookEcho()],
      },
      {
        adapter: () => seededAdapter({ schemaVersion: null }, { tokenRef: "SENDO_TOKEN_EMPTY" }),
        env: doctorEnv({ SENDO_TOKEN_EMPTY: "" }),
        graph: [http.get(WEBHOOK_URL, () => HttpResponse.error())],
      },
      {
        adapter: () => {
          const fail = () => Promise.reject(new Error("boom"));
          const base = memoryAdapter();
          return Promise.resolve({
            ...base,
            accounts: { ...base.accounts, list: fail },
            healthCheck: fail,
            schemaVersion: fail,
            storage: { ...base.storage, exists: fail },
          } as SendoAdapter);
        },
        graph: [graphHandlers.webhookEcho()],
      },
      {
        adapter: () => Promise.resolve(null),
        env: doctorEnv({ SENDO_VERIFY_TOKEN: "" }),
        graph: [],
      },
      { adapter: () => Promise.resolve(memoryAdapter()), graph: [graphHandlers.webhookEcho()] },
    ];

    const failing: CheckResult[] = [];
    for (const scenario of scenarios) {
      server.resetHandlers();
      server.use(...scenario.graph);
      const h = cli(await scenario.adapter(), scenario.env);
      expect(await h.run("--json")).toBe(1);
      failing.push(...(JSON.parse(h.stdout()) as CheckResult[]).filter((r) => !r.ok));
    }

    for (const result of failing) {
      expect(result.fix, result.id).toBeDefined();
      expect(KINDS, result.id).toContain(result.fix?.kind);
      expect(result.fix?.detail.length, result.id).toBeGreaterThan(10);
      expect(result.fix?.docsUrl, result.id).toMatch(/^https:\/\/sendo\.dev\/docs\/[a-z-]+$/);
    }
    const covered = new Set(failing.map((r) => r.id.replace(`account:${PHONE_NUMBER_ID}:`, "")));
    for (const id of [
      "env",
      "tables",
      "schema-version",
      "storage",
      "accounts",
      "token",
      "phone",
      "subscription",
      "templates",
      "billing",
      "webhook-url",
    ]) {
      expect(covered, id).toContain(id);
    }
    // Warnings (billing) are failing checks too: they carry a fix but don't change the exit code.
    expect(failing.some((r) => r.warning === true && r.fix?.kind === "billing")).toBe(true);
  });
});
