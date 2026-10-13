import { http, HttpResponse } from "msw";
import { memoryAdapter, type MemoryAdapterOptions } from "../adapters/memory";
import type { AccountInsertInput } from "../adapters/types";
import { GRAPH } from "../core/test-utils";

export const SENTINEL_TOKEN = "EAAG-sentinel-token-1234567890";
export const APP_SECRET = "app-secret-abcdef123456";
export const VERIFY_TOKEN = "verify-token-xyz-987654";
export const SERVICE_ROLE_KEY = "service-role-key-0987654321";
export const PHONE_NUMBER_ID = "100000000000001";
export const WABA_ID = "200000000000001";
export const WEBHOOK_URL = "https://app.example.com/api/sendo/webhook";

export function doctorEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    SENDO_META_APP_SECRET: APP_SECRET,
    SENDO_VERIFY_TOKEN: VERIFY_TOKEN,
    SUPABASE_URL: "http://127.0.0.1:55321",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    SENDO_TOKEN_MAIN: SENTINEL_TOKEN,
    ...overrides,
  };
}

export function cliAccountInput(overrides: Partial<AccountInsertInput> = {}): AccountInsertInput {
  return {
    tenantId: null,
    phoneNumberId: PHONE_NUMBER_ID,
    wabaId: WABA_ID,
    displayPhone: "+1 555-000-1111",
    tokenRef: "SENDO_TOKEN_MAIN",
    ...overrides,
  };
}

export async function seededAdapter(
  options: MemoryAdapterOptions = {},
  account: Partial<AccountInsertInput> = {},
) {
  const adapter = memoryAdapter(options);
  await adapter.accounts.insert(cliAccountInput(account));
  return adapter;
}

function metaErrorBody(code: number, message: string) {
  return { error: { code, message, type: "OAuthException", fbtrace_id: "TRACE" } };
}

export const graphHandlers = {
  phoneOk: (quality = "GREEN") =>
    http.get(`${GRAPH}/:id`, ({ params }) =>
      HttpResponse.json({
        id: params.id,
        display_phone_number: "+1 555-000-1111",
        verified_name: "Clínica Demo",
        quality_rating: quality,
        code_verification_status: "VERIFIED",
      }),
    ),
  phoneError: (code: number, status = 401) =>
    http.get(`${GRAPH}/:id`, () =>
      HttpResponse.json(
        metaErrorBody(code, `Error validating access token for ${SENTINEL_TOKEN}`),
        { status },
      ),
    ),
  subscribed: (apps: { id: string; name: string }[] = [{ id: "999", name: "Mi App" }]) =>
    http.get(`${GRAPH}/:waba/subscribed_apps`, () =>
      HttpResponse.json({
        data: apps.map((app) => ({ whatsapp_business_api_data: { ...app, link: "https://x" } })),
      }),
    ),
  templatesOk: () =>
    http.get(`${GRAPH}/:waba/message_templates`, () =>
      HttpResponse.json({
        data: [
          {
            id: "1",
            name: "cita",
            language: "es",
            status: "APPROVED",
            category: "UTILITY",
            components: [],
          },
          {
            id: "2",
            name: "promo",
            language: "es",
            status: "PENDING",
            category: "MARKETING",
            components: [],
          },
        ],
      }),
    ),
  webhookEcho: () =>
    http.get(WEBHOOK_URL, ({ request }) => {
      const url = new URL(request.url);
      if (url.searchParams.get("hub.verify_token") !== VERIFY_TOKEN) {
        return new HttpResponse("Forbidden", { status: 403 });
      }
      return new HttpResponse(url.searchParams.get("hub.challenge"), { status: 200 });
    }),
};

export function healthyGraph() {
  return [
    graphHandlers.phoneOk(),
    graphHandlers.subscribed(),
    graphHandlers.templatesOk(),
    graphHandlers.webhookEcho(),
  ];
}
