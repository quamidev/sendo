import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import type { WhatsAppAdapter } from "../adapters/types";
import { createGraphClient } from "../client/graph-client";
import { useGraphServer } from "../core/test-utils";
import { WA_SCHEMA_VERSION } from "../utils/schema-version";
import { doctorExitCode, runDoctor, type CheckResult, type RunDoctorOptions } from "./doctor";
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

  it("fails an unsubscribed WABA instead of reporting OK", async () => {
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
});
