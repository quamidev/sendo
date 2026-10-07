import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import type { WhatsAppAdapter } from "../adapters/types";
import { createGraphClient } from "../client/graph-client";
import { useGraphServer } from "../core/test-utils";
import { WA_SCHEMA_VERSION } from "../utils/schema-version";
import { doctorExitCode, runDoctor, type CheckResult, type RunDoctorOptions } from "./doctor";
import {
  APP_SECRET,
  PHONE_NUMBER_ID,
  SENTINEL_TOKEN,
  SERVICE_ROLE_KEY,
  VERIFY_TOKEN,
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
const templatesId = `account:${PHONE_NUMBER_ID}:templates`;

function allStrings(results: CheckResult[]): string {
  return JSON.stringify(results);
}

describe("runDoctor", () => {
  it("passes every check on a healthy setup", async () => {
    server.use(...healthyGraph());
    const results = await doctor();
    expect(results.map((r) => r.id)).toEqual([
      "env",
      "tables",
      "schema-version",
      "storage",
      "accounts",
      phoneId,
      subscriptionId,
      templatesId,
      "webhook-url",
    ]);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(doctorExitCode(results)).toBe(0);
    expect(byId(results, phoneId).detail).toContain("VERIFIED");
    expect(byId(results, phoneId).detail).toContain("GREEN");
    expect(byId(results, subscriptionId).detail).toContain("Mi App");
    expect(byId(results, templatesId).detail).toContain("2 plantilla(s), 1 aprobada(s)");
    expect(byId(results, "schema-version").detail).toContain(String(WA_SCHEMA_VERSION));
  });

  it("skips the webhook check without a url", async () => {
    server.use(...healthyGraph());
    const results = await doctor({ url: undefined });
    expect(results.some((r) => r.id === "webhook-url")).toBe(false);
  });

  it("reports missing env vars including the account token env", async () => {
    server.use(...healthyGraph());
    const results = await doctor({
      env: doctorEnv({ WA_APP_SECRET: "", WA_TOKEN_MAIN: undefined, SUPABASE_URL: undefined }),
    });
    const env = byId(results, "env");
    expect(env.ok).toBe(false);
    expect(env.detail).toContain("WA_APP_SECRET");
    expect(env.detail).toContain("WA_TOKEN_MAIN");
    expect(env.detail).toContain("SUPABASE_URL");
    expect(env.hint).toBeDefined();
    const token = byId(results, `account:${PHONE_NUMBER_ID}:token`);
    expect(token.ok).toBe(false);
    expect(results.some((r) => r.id === phoneId)).toBe(false);
    expect(doctorExitCode(results)).toBe(1);
  });

  it("accepts NEXT_PUBLIC_SUPABASE_URL", async () => {
    server.use(...healthyGraph());
    const results = await doctor({
      env: doctorEnv({ SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_URL: "http://x" }),
    });
    expect(byId(results, "env").ok).toBe(true);
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
    expect(phone.hint).toMatch(/expiró o fue revocado/);
    expect(allStrings(results)).not.toContain(SENTINEL_TOKEN);
  });

  it("fails a phone with RED quality", async () => {
    server.use(
      graphHandlers.phoneOk("RED"),
      graphHandlers.subscribed(),
      graphHandlers.templatesOk(),
      graphHandlers.webhookEcho(),
    );
    const phone = byId(await doctor(), phoneId);
    expect(phone.ok).toBe(false);
    expect(phone.detail).toContain("RED");
  });

  it("reports missing tables", async () => {
    server.use(...healthyGraph());
    const adapter = await seededAdapter({ missingTables: ["wa_locks", "wa_media"] });
    const tables = byId(await doctor({ adapter }), "tables");
    expect(tables.ok).toBe(false);
    expect(tables.detail).toContain("wa_locks");
    expect(tables.detail).toContain("wa_media");
    expect(tables.hint).toMatch(/migración/);
  });

  it("reports a schema version mismatch and a missing version", async () => {
    server.use(...healthyGraph());
    const older = byId(
      await doctor({ adapter: await seededAdapter({ schemaVersion: WA_SCHEMA_VERSION - 1 }) }),
      "schema-version",
    );
    expect(older.ok).toBe(false);
    expect(older.hint).toMatch(/migración/);
    const newer = byId(
      await doctor({ adapter: await seededAdapter({ schemaVersion: WA_SCHEMA_VERSION + 1 }) }),
      "schema-version",
    );
    expect(newer.ok).toBe(false);
    expect(newer.hint).toMatch(/Actualiza @quami\/wa-li/);
    const none = byId(
      await doctor({ adapter: await seededAdapter({ schemaVersion: null }) }),
      "schema-version",
    );
    expect(none.ok).toBe(false);
  });

  it("reports a missing storage bucket", async () => {
    server.use(...healthyGraph());
    const storage = byId(
      await doctor({
        adapter: await seededAdapter({ bucketExists: false }),
        env: doctorEnv({ WA_STORAGE_BUCKET: "media-x" }),
      }),
      "storage",
    );
    expect(storage.ok).toBe(false);
    expect(storage.detail).toContain("media-x");
  });

  it("fails when no accounts exist or the requested account is unknown", async () => {
    server.use(...healthyGraph());
    const empty = byId(await doctor({ adapter: memoryAdapter() }), "accounts");
    expect(empty.ok).toBe(false);
    expect(empty.hint).toMatch(/accounts add/);
    const unknown = byId(await doctor({ accountId: "nope" }), "accounts");
    expect(unknown.ok).toBe(false);
  });

  it("checks only the requested account by phone number id or id", async () => {
    server.use(...healthyGraph());
    const adapter = await seededAdapter();
    await adapter.accounts.insert({
      phoneNumberId: "100000000000002",
      wabaId: "200000000000002",
      displayPhone: "+2",
      tokenRef: "WA_TOKEN_OTHER",
    });
    const results = await doctor({ adapter, accountId: PHONE_NUMBER_ID });
    expect(results.filter((r) => r.id.startsWith("account:")).map((r) => r.id)).toEqual([
      phoneId,
      subscriptionId,
      templatesId,
    ]);
    expect(byId(results, "env").ok).toBe(true);
    const [account] = await adapter.accounts.list();
    const byUuid = await doctor({ adapter, accountId: account?.id });
    expect(byUuid.some((r) => r.id === phoneId)).toBe(true);
  });

  it("fails an unsubscribed WABA", async () => {
    server.use(
      graphHandlers.phoneOk(),
      graphHandlers.subscribed([]),
      graphHandlers.templatesOk(),
      graphHandlers.webhookEcho(),
    );
    const sub = byId(await doctor(), subscriptionId);
    expect(sub.ok).toBe(false);
    expect(sub.hint).toMatch(/subscribed_apps/);
  });

  it("fails when WA_APP_ID is not among the subscribed apps", async () => {
    server.use(...healthyGraph());
    const ok = byId(await doctor({ env: doctorEnv({ WA_APP_ID: "999" }) }), subscriptionId);
    expect(ok.ok).toBe(true);
    const other = byId(await doctor({ env: doctorEnv({ WA_APP_ID: "123" }) }), subscriptionId);
    expect(other.ok).toBe(false);
    expect(other.detail).toContain("Mi App");
  });

  it("fails template sync errors", async () => {
    server.use(
      graphHandlers.phoneOk(),
      graphHandlers.subscribed(),
      graphHandlers.templatesError(),
      graphHandlers.webhookEcho(),
    );
    const templates = byId(await doctor(), templatesId);
    expect(templates.ok).toBe(false);
    expect(templates.hint).toMatch(/permisos/);
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
    expect(hook.detail).toContain("no devolvió el challenge");
  });

  it("fails a webhook with a mismatched verify token (403)", async () => {
    server.use(...healthyGraph());
    const hook = byId(
      await doctor({ env: doctorEnv({ WA_VERIFY_TOKEN: "other-verify-token" }) }),
      "webhook-url",
    );
    expect(hook.ok).toBe(false);
    expect(hook.detail).toContain("403");
    expect(hook.hint).toMatch(/WA_VERIFY_TOKEN/);
  });

  it("fails an unreachable webhook URL without leaking the verify token", async () => {
    server.use(
      graphHandlers.phoneOk(),
      graphHandlers.subscribed(),
      graphHandlers.templatesOk(),
      http.get(WEBHOOK_URL, () => HttpResponse.error()),
    );
    const results = await doctor();
    const hook = byId(results, "webhook-url");
    expect(hook.ok).toBe(false);
    expect(hook.hint).toMatch(/No se pudo conectar/);
    expect(allStrings(results)).not.toContain(VERIFY_TOKEN);
  });

  it("uses an injected fetch for the webhook URL", async () => {
    server.use(graphHandlers.phoneOk(), graphHandlers.subscribed(), graphHandlers.templatesOk());
    const fetchFn: typeof fetch = (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response(url.searchParams.get("hub.challenge")));
    };
    expect(byId(await doctor({ fetch: fetchFn }), "webhook-url").ok).toBe(true);
  });

  it("reports adapter-dependent checks as failed when there is no adapter", async () => {
    server.use(graphHandlers.webhookEcho());
    const results = await runDoctor({
      env: doctorEnv(),
      adapter: null,
      graph: createGraphClient(),
      url: WEBHOOK_URL,
    });
    for (const id of ["tables", "schema-version", "storage", "accounts"]) {
      expect(byId(results, id).ok).toBe(false);
      expect(byId(results, id).hint).toMatch(/SUPABASE_URL/);
    }
    expect(byId(results, "webhook-url").ok).toBe(true);
  });

  it("never throws when the adapter throws", async () => {
    server.use(graphHandlers.webhookEcho());
    const fail = () => Promise.reject(new Error(`boom ${SERVICE_ROLE_KEY}`));
    const broken = {
      ...memoryAdapter(),
      accounts: { ...memoryAdapter().accounts, list: fail },
      healthCheck: fail,
      schemaVersion: fail,
      storage: { ...memoryAdapter().storage, bucketExists: fail },
    } as WhatsAppAdapter;
    const results = await doctor({ adapter: broken });
    for (const id of ["tables", "schema-version", "storage", "accounts"]) {
      expect(byId(results, id).ok).toBe(false);
    }
    expect(allStrings(results)).not.toContain(SERVICE_ROLE_KEY);
  });

  it("redacts every secret from every result string", async () => {
    server.use(
      http.get(`https://graph.facebook.com/:v/:id`, () =>
        HttpResponse.json(
          { error: { code: 100, message: `bad ${SENTINEL_TOKEN} ${APP_SECRET} ${VERIFY_TOKEN}` } },
          { status: 400 },
        ),
      ),
      graphHandlers.subscribed(),
      graphHandlers.templatesOk(),
      http.get(WEBHOOK_URL, () => new HttpResponse(`echo ${SENTINEL_TOKEN} ${VERIFY_TOKEN}`)),
    );
    const results = await doctor();
    const text = allStrings(results);
    for (const secret of [SENTINEL_TOKEN, APP_SECRET, VERIFY_TOKEN, SERVICE_ROLE_KEY]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("doctorExitCode", () => {
  it("maps results to 0/1", () => {
    const pass = { id: "a", label: "A", ok: true, detail: "" };
    expect(doctorExitCode([])).toBe(0);
    expect(doctorExitCode([pass])).toBe(0);
    expect(doctorExitCode([pass, { ...pass, ok: false }])).toBe(1);
  });
});
