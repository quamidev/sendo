// Scenarios for the CLI language guard (`test/integration/cli-language.test.ts`, [CC-LANG-CLI]).
// The spawned `sendo` process reads `SENDO_LANG_SCENARIO`: `graph-preload.mjs` fakes Meta, Sendo
// Connect, the webhook URL and Supabase's REST API with it, and `doctor-config.mjs` builds the
// memory adapter `--config` hands to doctor. Data keeps Spanish names on purpose (allow-listed).

export const WEBHOOK_URL = "https://app.example.com/api/sendo/webhook";
export const SUPABASE_URL = "http://supabase.sendo.test";
export const VERIFY_TOKEN = "verify-token-xyz-987654";
export const PHONE_NUMBER_ID = "100000000000001";
export const WABA_ID = "200000000000001";
export const VERIFIED_NAME = "Clínica Demo";

/**
 * name → { memory?, account?, noAccount?, broken?, media?, graph?, webhook?, connect?, supabase? }
 * graph.phone / subscribed / templates: "ok" | "red" | "empty" | "network" | <Meta error code>.
 * webhook: "echo" | "hello" | 404 | "network". connect: answer of GET /v1/projects/current/webhook.
 */
export const SCENARIOS = {
  healthy: { webhook: "echo" },
  drift: {
    memory: { missingTables: ["sendo_locks"], schemaVersion: 2, bucketExists: false },
    graph: { phone: "red", subscribed: "empty", templates: 200 },
    webhook: "hello",
  },
  token: {
    account: { billingReady: false },
    graph: { phone: 190, templates: 100 },
    webhook: 404,
  },
  permissions: { account: { wabaId: "" }, graph: { phone: 10 }, webhook: "echo" },
  "empty-token": {
    memory: { schemaVersion: null },
    account: { tokenRef: "SENDO_TOKEN_EMPTY" },
    webhook: "network",
  },
  broken: { broken: true, webhook: "echo" },
  "newer-schema": {
    memory: { schemaVersion: 99 },
    graph: { phone: "network", subscribed: "network", templates: "network" },
    webhook: "echo",
  },
  "meta-other": { graph: { phone: 2, subscribed: 2, templates: 2 }, webhook: "echo" },
  "no-media": { media: "none", noAccount: true, webhook: "echo" },
  "custom-media-missing": { media: "missing-bucket", webhook: "echo" },
  "custom-media-no-exists": { media: "no-exists", webhook: "echo" },
  "bad-media": { media: "invalid" },
  "connect-ok": {
    connect: {
      body: {
        projectId: "prj_123",
        url: WEBHOOK_URL,
        lastDelivery: { at: "2026-10-09T11:59:00.000Z", statusCode: 200 },
      },
    },
    webhook: "echo",
  },
  "connect-401": {
    connect: { status: 401, body: { error: { code: "unauthorized", message: "bad key" } } },
  },
  "connect-network": { connect: { network: true } },
  "connect-suspended": {
    connect: {
      status: 403,
      body: { error: { code: "PROJECT_SUSPENDED", message: "Project suspended for non-payment" } },
    },
  },
  "connect-500": { connect: { status: 500, body: { error: { code: "internal", message: "x" } } } },
  "connect-bad-url": { connect: { body: {} } },
  "connect-no-url": { connect: { body: { projectId: "prj_123", url: null, lastDelivery: null } } },
  "connect-other-url": {
    connect: {
      body: {
        url: "https://old.example.com/api/sendo/webhook",
        lastDelivery: { at: "2026-10-09T11:59:00.000Z", statusCode: 401 },
      },
    },
    webhook: "echo",
  },
  "connect-delivery-500": {
    connect: {
      body: { url: WEBHOOK_URL, lastDelivery: { at: "2026-10-09T11:59:00.000Z", statusCode: 500 } },
    },
    webhook: "echo",
  },
  "connect-no-answer": {
    connect: {
      body: {
        url: WEBHOOK_URL,
        lastDelivery: { at: "2026-10-09T11:59:00.000Z", statusCode: null },
      },
    },
    webhook: "echo",
  },
  "supabase-accounts": {
    supabase: {
      accounts: [
        {
          id: "0b7c2f4e-5a1d-4c3e-9f80-1a2b3c4d5e6f",
          tenant_id: null,
          channel: "whatsapp",
          label: "Recepción",
          phone_number_id: PHONE_NUMBER_ID,
          waba_id: WABA_ID,
          display_phone: "+502 5555 0101",
          token_ref: "SENDO_TOKEN_MAIN",
          timezone: "America/Guatemala",
          active: true,
          is_default: true,
          coexistence: false,
          onboarded_via: "manual",
          agent_paused: false,
          agent_mode: null,
          billing_ready: null,
          billing_checked_at: null,
          created_at: "2026-10-01T12:00:00.000Z",
        },
        {
          id: "7d3c1a2b-0e4f-4a5b-8c6d-1e2f3a4b5c6d",
          tenant_id: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
          channel: "whatsapp",
          label: null,
          phone_number_id: "100000000000002",
          waba_id: WABA_ID,
          display_phone: "+502 5555 0202",
          token_ref: "SENDO_TOKEN_B",
          timezone: "America/Guatemala",
          active: false,
          is_default: false,
          coexistence: true,
          onboarded_via: "embedded_signup",
          agent_paused: false,
          agent_mode: null,
          billing_ready: false,
          billing_checked_at: null,
          created_at: "2026-10-02T12:00:00.000Z",
        },
      ],
    },
  },
  "supabase-empty": { supabase: { accounts: [] } },
  "supabase-down": { supabase: { status: 500 } },
};

export function currentScenario() {
  const name = process.env.SENDO_LANG_SCENARIO ?? "healthy";
  const scenario = SCENARIOS[name];
  if (scenario === undefined) throw new Error(`Unknown SENDO_LANG_SCENARIO: ${name}`);
  return scenario;
}
