/**
 * Product spec — Batch 2 — "Embedded Signup and billing state", Flow B (incl. failure states).
 *
 * [AC-ES-2] `sendo.accounts.completeEmbeddedSignup` runs the tech spec sequence on
 *           GRAPH_API_VERSION: code exchange → subscribe → register (PIN; skipped for
 *           coexistence) → phone read → storeToken → insert/reactivate → first-number default →
 *           billing. ConfigError without storeToken / meta.appId / app secret. Failures in the
 *           Meta steps leave storage untouched; failures after storeToken call deleteToken,
 *           unsubscribe the app (best effort) and leave no row. Distinct codes: expired code,
 *           missing permission, PIN conflict, duplicate.
 * Tokens (and the app secret, code and PIN) never reach logs, errors, rows or event payloads:
 * every test scans the captured logger output (all levels), serialized errors, stored rows and
 * the events for them.
 */
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import type { SendoAdapter } from "../../src/adapters/types";
import { GRAPH_API_VERSION } from "../../src/client/graph-client";
import type { StoreTokenInput } from "../../src/core/accounts";
import { GRAPH, makeClient, useGraphServer, type ClientOptions } from "../../src/core/test-utils";
import { SendoError } from "../../src/errors/base";
import { metaDirect } from "../../src/transport/meta-direct";

const graph = useGraphServer();

const APP_ID = "1234567890";
const APP_SECRET = "app-secret-value";
const CODE = "AQD-single-use-code-xyz";
const BUSINESS_TOKEN = "EAAB-business-token-from-msw-0001";
const TENANT = "tenant-a";
const WABA = "200000000000077";
const PHONE_ID = "100000000000077";
const DISPLAY = "+502 5555 0077";
const SECRETS = [BUSINESS_TOKEN, APP_SECRET, CODE];

const metaError = (code: number, status = 400, extra: Record<string, unknown> = {}) =>
  HttpResponse.json(
    {
      error: { code, type: "OAuthException", message: "Meta says no", fbtrace_id: "TR", ...extra },
    },
    { status },
  );

interface MetaOverrides {
  exchange?: () => Response;
  subscribe?: () => Response;
  register?: () => Response;
  phone?: () => Response;
  waba?: () => Response;
}

/** A Meta that accepts the whole sequence unless a step is overridden. */
function meta(overrides: MetaOverrides = {}) {
  graph.server.use(
    http.get(`${GRAPH}/oauth/access_token`, () =>
      overrides.exchange
        ? overrides.exchange()
        : HttpResponse.json({ access_token: BUSINESS_TOKEN, token_type: "bearer" }),
    ),
    http.post(`${GRAPH}/:waba/subscribed_apps`, () =>
      overrides.subscribe ? overrides.subscribe() : HttpResponse.json({ success: true }),
    ),
    http.delete(`${GRAPH}/:waba/subscribed_apps`, () => HttpResponse.json({ success: true })),
    http.post(`${GRAPH}/:phone/register`, () =>
      overrides.register ? overrides.register() : HttpResponse.json({ success: true }),
    ),
    http.get(`${GRAPH}/:id`, ({ request, params }) => {
      const fields = new URL(request.url).searchParams.get("fields") ?? "";
      if (fields === "primary_funding_id") {
        return overrides.waba
          ? overrides.waba()
          : HttpResponse.json({ id: params.id, primary_funding_id: "987654321" });
      }
      return overrides.phone
        ? overrides.phone()
        : HttpResponse.json({
            id: params.id,
            display_phone_number: DISPLAY,
            verified_name: "Demo",
          });
    }),
  );
}

/** Path + method of every Graph request, e.g. `GET oauth/access_token`. */
function calls(): string[] {
  return graph.requests.map((r) => {
    const url = new URL(r.url);
    return `${r.method} ${url.pathname.replace(`/${GRAPH_API_VERSION}/`, "")}`;
  });
}

function client(options: ClientOptions = {}) {
  const stored = new Map<string, string>();
  let refs = 0;
  const storeToken = vi.fn((input: StoreTokenInput) => {
    refs++;
    const ref = `vault:${input.account.phoneNumberId ?? ""}:${String(refs)}`;
    stored.set(ref, input.token);
    return Promise.resolve(ref);
  });
  const deleteToken = vi.fn((ref: string) => {
    stored.delete(ref);
    return Promise.resolve();
  });
  const c = makeClient({ storeToken, deleteToken, meta: { appId: APP_ID }, ...options });
  const events: unknown[] = [];
  for (const name of ["account.default", "account.billing", "account.error"] as const) {
    c.sendo.on(name, (payload) => {
      events.push({ name, payload });
    });
  }
  return { ...c, stored, storeToken, deleteToken, events };
}

type Client = ReturnType<typeof client>;

async function rows(adapter: SendoAdapter) {
  return adapter.accounts.list({});
}

/** Fails if any secret appears in logs, stored rows, events or the given error. */
async function expectNoSecrets(c: Client, error?: unknown, extra: string[] = []) {
  const haystack = [
    JSON.stringify(c.logs.entries.map((e) => e.args.map(String))),
    JSON.stringify(await rows(c.adapter)),
    JSON.stringify(c.events),
    error === undefined ? "" : JSON.stringify(error),
    error instanceof Error ? error.message : "",
  ].join("\n");
  for (const secret of [...SECRETS, ...extra]) expect(haystack).not.toContain(secret);
}

async function failure(promise: Promise<unknown>): Promise<SendoError> {
  const error = await promise.then(
    () => expect.fail("expected a rejection"),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SendoError);
  return error as SendoError;
}

const input = (overrides: Record<string, unknown> = {}) => ({
  code: CODE,
  tenantId: TENANT,
  wabaId: WABA,
  phoneNumberId: PHONE_ID,
  ...overrides,
});

describe("completeEmbeddedSignup", () => {
  it("[AC-ES-2] happy path: full sequence, token stored by reference, first number is default, billing read", async () => {
    meta();
    const c = client();
    const account = await c.sendo.accounts.completeEmbeddedSignup(input({ label: " Recepción " }));

    expect(calls()).toEqual([
      "GET oauth/access_token",
      `POST ${WABA}/subscribed_apps`,
      `POST ${PHONE_ID}/register`,
      `GET ${PHONE_ID}`,
      `GET ${WABA}`,
    ]);
    const exchange = new URL(graph.requests[0]?.url ?? "");
    expect(Object.fromEntries(exchange.searchParams)).toEqual({
      client_id: APP_ID,
      client_secret: APP_SECRET,
      code: CODE,
    });
    const register = graph.requests[2]?.body as { messaging_product: string; pin: string };
    expect(register.messaging_product).toBe("whatsapp");
    expect(register.pin).toMatch(/^\d{6}$/);

    expect(c.storeToken).toHaveBeenCalledWith({
      account: { tenantId: TENANT, phoneNumberId: PHONE_ID, wabaId: WABA },
      token: BUSINESS_TOKEN,
    });
    expect(account).toMatchObject({
      tenantId: TENANT,
      phoneNumberId: PHONE_ID,
      wabaId: WABA,
      displayPhone: DISPLAY,
      label: "Recepción",
      tokenRef: `vault:${PHONE_ID}:1`,
      active: true,
      isDefault: true,
      coexistence: false,
      onboardedVia: "embedded_signup",
      billingReady: true,
    });
    expect(account.billingCheckedAt).toBeInstanceOf(Date);
    expect(await c.sendo.accounts.get(PHONE_ID)).toEqual(account);
    expect(c.events).toEqual([
      {
        name: "account.default",
        payload: expect.objectContaining({ tenantId: TENANT, previous: null }) as unknown,
      },
      {
        name: "account.billing",
        payload: expect.objectContaining({ billingReady: true, previous: null }) as unknown,
      },
    ]);
    await expectNoSecrets(c);
  });

  it("[AC-ES-2] uses the given PIN; a second number of the tenant does not take the default", async () => {
    meta();
    const c = client();
    const first = await c.sendo.accounts.completeEmbeddedSignup(input());
    graph.requests.length = 0;
    const second = await c.sendo.accounts.completeEmbeddedSignup(
      input({ phoneNumberId: "100000000000078", pin: "246810" }),
    );
    expect((graph.requests[2]?.body as { pin: string }).pin).toBe("246810");
    expect(second.isDefault).toBe(false);
    expect((await c.sendo.accounts.get(first.id)).isDefault).toBe(true);
    await expectNoSecrets(c, undefined, ["246810"]);
  });

  it("[AC-CX-1] coexistence skips register and marks the account", async () => {
    meta();
    const c = client();
    const account = await c.sendo.accounts.completeEmbeddedSignup(input({ coexistence: true }));
    expect(calls()).not.toContain(`POST ${PHONE_ID}/register`);
    expect(account).toMatchObject({ coexistence: true, onboardedVia: "embedded_signup" });
  });

  it("[AC-ES-2] reconnects a number disconnected in the same tenant (same id, new tokenRef)", async () => {
    meta();
    const c = client();
    const original = await c.sendo.accounts.completeEmbeddedSignup(input());
    await c.sendo.accounts.disconnect(original.id);
    expect(c.deleteToken).toHaveBeenCalledWith(original.tokenRef);

    const again = await c.sendo.accounts.completeEmbeddedSignup(input());
    expect(again.id).toBe(original.id);
    expect(again).toMatchObject({ active: true, isDefault: true, tokenRef: `vault:${PHONE_ID}:2` });
    expect(c.storeToken).toHaveBeenCalledTimes(2);
    expect(await rows(c.adapter)).toHaveLength(1);
  });

  it("[AC-ES-2] a number connected in another tenant is ACCOUNT_EXISTS before the code is spent", async () => {
    meta();
    const c = client();
    await c.sendo.accounts.completeEmbeddedSignup(input({ tenantId: "tenant-b" }));
    graph.requests.length = 0;
    c.storeToken.mockClear();

    const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
    expect(error.toJSON()).toMatchObject({ code: "ACCOUNT_EXISTS", phoneNumberId: PHONE_ID });
    expect(graph.requests).toHaveLength(0);
    expect(c.storeToken).not.toHaveBeenCalled();
    expect((await rows(c.adapter)).map((a) => a.tenantId)).toEqual(["tenant-b"]);
  });

  it("[AC-ES-2] ConfigError without storeToken, meta.appId or an app secret; nothing is called", async () => {
    meta();
    const noStore = client({ storeToken: undefined });
    const noApp = client({ meta: {} });
    const noSecret = client({
      transport: metaDirect({
        appSecret: "",
        verifyToken: "v",
        resolveToken: () => "unused",
      }),
    } as unknown as ClientOptions);
    const messages: string[] = [];
    for (const c of [noStore, noApp, noSecret]) {
      const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
      expect(error.toJSON()).toMatchObject({ code: "CONFIG_ERROR" });
      messages.push(error.message);
    }
    expect(messages[0]).toContain("storeToken");
    expect(messages[1]).toContain("meta.appId");
    expect(messages[2]).toContain("appSecret");
    expect(graph.requests).toHaveLength(0);
  });

  describe("failures before storeToken leave storage untouched", () => {
    const cases: {
      name: string;
      overrides: MetaOverrides;
      code: string;
      step: string;
      lastCall: string;
    }[] = [
      {
        name: "expired or used code (100/36007)",
        overrides: {
          exchange: () =>
            metaError(100, 400, {
              error_subcode: 36007,
              message: `This authorization code has expired. code=${CODE} secret=${APP_SECRET}`,
            }),
        },
        code: "SIGNUP_CODE_EXPIRED",
        step: "exchange_code",
        lastCall: "GET oauth/access_token",
      },
      {
        name: "app without the permission (app review pending)",
        overrides: {
          subscribe: () =>
            metaError(200, 403, { message: `Permissions error for ${BUSINESS_TOKEN}` }),
        },
        code: "META_PERMISSION_MISSING",
        step: "subscribe_app",
        lastCall: `POST ${WABA}/subscribed_apps`,
      },
      {
        name: "number with another two-step PIN (133005)",
        overrides: { register: () => metaError(133005, 400, { message: "PIN mismatch" }) },
        code: "PIN_CONFLICT",
        step: "register_phone",
        lastCall: `POST ${PHONE_ID}/register`,
      },
      {
        name: "phone read fails",
        overrides: { phone: () => metaError(1, 500, { message: "Unknown error" }) },
        code: "SIGNUP_FAILED",
        step: "read_phone",
        lastCall: `GET ${PHONE_ID}`,
      },
    ];

    for (const t of cases) {
      it(`[AC-ES-2] ${t.name} → ${t.code}`, async () => {
        meta(t.overrides);
        const c = client();
        const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
        expect(error.toJSON()).toMatchObject({ code: t.code, step: t.step });
        expect(calls().at(-1)).toBe(t.lastCall);
        expect(calls()).not.toContain(`DELETE ${WABA}/subscribed_apps`);
        expect(c.storeToken).not.toHaveBeenCalled();
        expect(c.deleteToken).not.toHaveBeenCalled();
        expect(await rows(c.adapter)).toEqual([]);
        await expectNoSecrets(c, error);
      });
    }
  });

  it("[AC-ES-2] storeToken throwing surfaces the error (redacted) and inserts no row", async () => {
    meta();
    const c = client({
      storeToken: () => Promise.reject(new Error(`vault rejected ${BUSINESS_TOKEN}`)),
    });
    const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
    expect(error.toJSON()).toMatchObject({ code: "SIGNUP_FAILED", step: "store_token" });
    expect(error.message).toContain("vault rejected [REDACTED]");
    expect(await rows(c.adapter)).toEqual([]);
    await expectNoSecrets(c, error);
  });

  describe("failures after storeToken compensate", () => {
    /** Makes one adapter account method throw once. */
    function breakOnce(adapter: SendoAdapter, method: "insert" | "setDefault") {
      const original = adapter.accounts[method].bind(adapter.accounts) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      let broken = false;
      (adapter.accounts as Record<string, unknown>)[method] = (...args: unknown[]) => {
        if (broken) return original(...args);
        broken = true;
        return Promise.reject(new Error("database unavailable"));
      };
    }

    it("[AC-ES-2] insert fails → deleteToken, app unsubscribed, no row", async () => {
      meta();
      const c = client();
      breakOnce(c.adapter, "insert");
      const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
      expect(error.toJSON()).toMatchObject({ code: "SIGNUP_FAILED", step: "save_account" });
      expect(c.deleteToken).toHaveBeenCalledWith(`vault:${PHONE_ID}:1`);
      expect(c.stored.size).toBe(0);
      expect(calls().at(-1)).toBe(`DELETE ${WABA}/subscribed_apps`);
      expect(await rows(c.adapter)).toEqual([]);
      await expectNoSecrets(c, error);
    });

    it("[AC-ES-2] setDefault fails after the insert → the new row is removed", async () => {
      meta();
      const c = client();
      breakOnce(c.adapter, "setDefault");
      const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
      expect(error.toJSON()).toMatchObject({ code: "SIGNUP_FAILED", step: "save_account" });
      expect(await rows(c.adapter)).toEqual([]);
      expect(c.deleteToken).toHaveBeenCalledTimes(1);
      expect(calls()).toContain(`DELETE ${WABA}/subscribed_apps`);
      await expectNoSecrets(c, error);
    });

    it("[AC-ES-2] a failed reconnection puts the disconnected row back as it was", async () => {
      meta();
      const c = client();
      const original = await c.sendo.accounts.completeEmbeddedSignup(input());
      const disconnected = await c.sendo.accounts.disconnect(original.id);
      c.deleteToken.mockClear();
      breakOnce(c.adapter, "setDefault");

      await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
      const [row] = await rows(c.adapter);
      expect(row).toMatchObject({
        id: original.id,
        active: false,
        isDefault: false,
        tokenRef: disconnected.tokenRef,
      });
      expect(c.deleteToken).toHaveBeenCalledWith(`vault:${PHONE_ID}:2`);
    });

    it("[AC-ES-2] the app stays subscribed when another connected number shares the WABA", async () => {
      meta();
      const c = client();
      await c.sendo.accounts.completeEmbeddedSignup(input({ phoneNumberId: "100000000000099" }));
      graph.requests.length = 0;
      breakOnce(c.adapter, "insert");
      await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
      expect(calls()).not.toContain(`DELETE ${WABA}/subscribed_apps`);
      expect(c.logs.of("warn").join("\n")).toContain("other connected numbers");
    });
  });

  it("[AC-ES-4] a billing read error keeps the account connected with billingReady unknown", async () => {
    meta({ waba: () => metaError(100, 400, { error_subcode: 33 }) });
    const c = client();
    const account = await c.sendo.accounts.completeEmbeddedSignup(input());
    expect(account).toMatchObject({ active: true, billingReady: null });
    expect(account.billingCheckedAt).toBeInstanceOf(Date);
    expect(c.events.map((e) => (e as { name: string }).name)).toEqual(["account.default"]);
    await expectNoSecrets(c);
  });
});
