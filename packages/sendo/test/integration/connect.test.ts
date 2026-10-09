/**
 * Product spec — Batch 5 — "Sendo Connect", package side (AC-CN-3; US-3, US-36).
 *
 * [AC-CN-3] With `connect: { apiKey, signingSecret }`:
 *   - webhooks are verified with `X-Sendo-Signature: t=<unix>,v1=<hmac_sha256(signingSecret,
 *     t + "." + rawBody)>` (5-minute tolerance, constant-time), `appSecret` is not required and
 *     Meta's own signature is NOT accepted; without `connect` the Meta path is unchanged;
 *   - `completeEmbeddedSignup` goes through `POST {baseUrl}/v1/signup/complete` (Bearer apiKey)
 *     and continues from `storeToken` with the same compensation; sending stays direct to Graph;
 *   - `sendo doctor` checks the key, the registered webhook URL and the last relay delivery.
 *
 * Security boundary (isolation justified by AGENTS.md). Ways the relay signature check can fail,
 * one test each, all through `sendo.handleWebhook`; every rejection is 401 and stores nothing:
 *   1. signed with the wrong secret
 *   2. timestamp older than 5 minutes (replay) — and one more than 5 minutes in the future
 *   3. header missing
 *   4. body changed after signing
 *   5. only Meta's X-Hub-Signature-256 (valid for the app secret) — Meta is not trusted with connect
 *   6. a Meta-format value (`sha256=…`) inside X-Sendo-Signature, even keyed with the signing secret
 *   7. a valid `v1` re-used with a fresh `t` (timestamp swap)
 *   8. malformed headers: non-numeric t, no t, no v1, duplicate t, unknown scheme only, junk
 *   9. accepted edge: a signature 4 minutes old or 4 minutes ahead (clock skew) is valid
 *  10. secrets: the signing secret / API key never reach logs, errors or stored rows
 * The expected signatures are computed here with node:crypto, not with the package's signer.
 */
import { createHmac } from "node:crypto";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import type { SendoAdapter } from "../../src/adapters/types";
import { GRAPH_API_VERSION } from "../../src/client/graph-client";
import { runCli, type CliDeps } from "../../src/cli/main";
import type { CheckResult } from "../../src/cli/doctor";
import {
  PHONE_NUMBER_ID as CLI_PHONE_ID,
  WEBHOOK_URL as CLI_WEBHOOK_URL,
  doctorEnv,
  healthyGraph,
  seededAdapter,
} from "../../src/cli/test-helpers";
import type { StoreTokenInput } from "../../src/core/accounts";
import { createSendo } from "../../src/core/create-sendo";
import { GRAPH, makeClient, useGraphServer, type ClientOptions } from "../../src/core/test-utils";
import { SendoError } from "../../src/errors/base";
import { FIXTURE_IDS } from "../support/fixtures";
import { signFixture } from "../support/sign";
import { APP_SECRET, WEBHOOK_URL, dumpState, errorSurface, freshFixture } from "./harness";

const graph = useGraphServer();

const CONNECT = "https://connect.sendo.dev";
const API_KEY = "sk_connect_test_key_0123456789";
const SIGNING_SECRET = "whsec_connect_signing_secret_abcdef";
const CONNECT_OPTIONS = { apiKey: API_KEY, signingSecret: SIGNING_SECRET };

const CODE = "AQD-connect-single-use-code-777";
const BUSINESS_TOKEN = "EAAB-business-token-from-connect-0042";
const TENANT = "tenant-a";
const WABA = FIXTURE_IDS.wabaId;
const PHONE_ID = FIXTURE_IDS.phoneNumberId;
const DISPLAY = "+502 5555 0042";
const SECRETS = [API_KEY, SIGNING_SECRET, BUSINESS_TOKEN, CODE];

const nowSec = () => Math.floor(Date.now() / 1000);

/** The relay's header, computed independently of the package. */
function relaySignature(body: string, secret = SIGNING_SECRET, t = nowSec()): string {
  const hex = createHmac("sha256", secret)
    .update(`${String(t)}.${body}`)
    .digest("hex");
  return `t=${String(t)},v1=${hex}`;
}

function post(body: string, headers: Record<string, string>): Request {
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const relayPost = (body: string, header = relaySignature(body)) =>
  post(body, { "x-sendo-signature": header });

async function failure(promise: Promise<unknown>): Promise<SendoError> {
  const error = await promise.then(
    () => expect.fail("expected a rejection"),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SendoError);
  return error as SendoError;
}

function connectClient(options: ClientOptions = {}) {
  const c = makeClient({ connect: CONNECT_OPTIONS, ...options });
  return c;
}

/** Posts and waits for the background work; returns status and the number of stored events. */
async function deliver(
  sendo: ReturnType<typeof makeClient>["sendo"],
  adapter: ReturnType<typeof memoryAdapter>,
  request: Request,
) {
  const tasks: Promise<unknown>[] = [];
  const response = await sendo.handleWebhook(request, { waitUntil: (p) => tasks.push(p) });
  await Promise.all(tasks);
  return { status: response.status, events: adapter.__state.events.size, tasks: tasks.length };
}

describe("[AC-CN-3] webhooks through the Connect relay", () => {
  it("accepts a relay-signed body (also with ±4 minutes of clock skew) and processes it", async () => {
    const c = connectClient();
    await c.adapter.accounts.insert({
      tenantId: TENANT,
      phoneNumberId: PHONE_ID,
      wabaId: WABA,
      displayPhone: DISPLAY,
      tokenRef: "SENDO_TOKEN_A",
    });
    const body = freshFixture("text");
    const results = [
      await deliver(c.sendo, c.adapter, relayPost(body)),
      await deliver(
        c.sendo,
        c.adapter,
        relayPost(body, relaySignature(body, SIGNING_SECRET, nowSec() - 240)),
      ),
      await deliver(
        c.sendo,
        c.adapter,
        relayPost(body, relaySignature(body, SIGNING_SECRET, nowSec() + 240)),
      ),
    ];
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(results.at(-1)?.events).toBe(3);
    const stored = [...c.adapter.__state.messages.values()].filter((m) => m.direction === "in");
    expect(stored).toHaveLength(1); // same Meta id three times → one message
    expect([...c.adapter.__state.events.values()].every((e) => e.status === "processed")).toBe(
      true,
    );
  });

  describe("rejects with 401 and stores nothing", () => {
    const body = () => freshFixture("text");
    const hex = (b: string, secret: string, t: number) =>
      createHmac("sha256", secret)
        .update(`${String(t)}.${b}`)
        .digest("hex");
    const cases: { name: string; request: () => Request }[] = [
      {
        name: "1. signed with the wrong secret",
        request: () => {
          const b = body();
          return relayPost(b, relaySignature(b, "whsec_some_other_project_secret"));
        },
      },
      {
        name: "2a. timestamp more than 5 minutes old (replay)",
        request: () => {
          const b = body();
          return relayPost(b, relaySignature(b, SIGNING_SECRET, nowSec() - 301));
        },
      },
      {
        name: "2b. timestamp more than 5 minutes in the future",
        request: () => {
          const b = body();
          return relayPost(b, relaySignature(b, SIGNING_SECRET, nowSec() + 301));
        },
      },
      {
        name: "3. header missing",
        request: () => post(body(), {}),
      },
      {
        name: "4. body changed after signing",
        request: () => {
          const b = body();
          return relayPost(b.replace("wamid.TEXT0001", "wamid.FORGED"), relaySignature(b));
        },
      },
      {
        name: "5. only Meta's X-Hub-Signature-256, valid for the app secret",
        request: () => {
          const signed = signFixture(body(), APP_SECRET);
          return post(signed.body, signed.headers);
        },
      },
      {
        name: "5b. Meta's signature next to a broken relay signature",
        request: () => {
          const signed = signFixture(body(), APP_SECRET);
          return post(signed.body, { ...signed.headers, "x-sendo-signature": "t=1,v1=00" });
        },
      },
      {
        name: "6. a Meta-format value inside X-Sendo-Signature, keyed with the signing secret",
        request: () => {
          const b = body();
          const meta = signFixture(b, SIGNING_SECRET).headers["x-hub-signature-256"];
          return post(b, { "x-sendo-signature": meta, "x-hub-signature-256": meta });
        },
      },
      {
        name: "7. a valid v1 re-used with a fresh timestamp",
        request: () => {
          const b = body();
          const old = nowSec() - 120;
          return relayPost(b, `t=${String(nowSec())},v1=${hex(b, SIGNING_SECRET, old)}`);
        },
      },
      {
        name: "8a. non-numeric timestamp",
        request: () => {
          const b = body();
          return relayPost(b, `t=now,v1=${hex(b, SIGNING_SECRET, nowSec())}`);
        },
      },
      {
        name: "8b. no timestamp",
        request: () => {
          const b = body();
          return relayPost(b, `v1=${hex(b, SIGNING_SECRET, nowSec())}`);
        },
      },
      {
        name: "8c. no v1",
        request: () => relayPost(body(), `t=${String(nowSec())}`),
      },
      {
        name: "8d. duplicate t",
        request: () => {
          const b = body();
          const t = nowSec();
          return relayPost(b, `t=${String(t)},t=${String(t)},v1=${hex(b, SIGNING_SECRET, t)}`);
        },
      },
      {
        name: "8e. unknown scheme only",
        request: () => {
          const b = body();
          const t = nowSec();
          return relayPost(b, `t=${String(t)},v0=${hex(b, SIGNING_SECRET, t)}`);
        },
      },
      {
        name: "8f. junk",
        request: () => relayPost(body(), "garbage"),
      },
    ];

    for (const t of cases) {
      it(t.name, async () => {
        const c = connectClient();
        const result = await deliver(c.sendo, c.adapter, t.request());
        expect(result).toEqual({ status: 401, events: 0, tasks: 0 });
        expect(dumpState(c.adapter.__state)).not.toContain("wamid.TEXT0001");
        expect(c.logs.of("warn").join("\n")).toContain("X-Sendo-Signature");
        const logs = JSON.stringify(c.logs.entries.map((e) => e.args.map(String)));
        for (const secret of [SIGNING_SECRET, API_KEY, APP_SECRET]) {
          expect(logs).not.toContain(secret);
        }
        expect(graph.requests).toHaveLength(0);
      });
    }
  });

  it("without `connect` the Meta path is unchanged and X-Sendo-Signature is ignored", async () => {
    const c = makeClient();
    const meta = signFixture(freshFixture("text"), APP_SECRET);
    const relayOnly = freshFixture("text");
    expect((await deliver(c.sendo, c.adapter, post(meta.body, meta.headers))).status).toBe(200);
    expect((await deliver(c.sendo, c.adapter, relayPost(relayOnly))).status).toBe(401);
  });

  it("`appSecret` is not required with `connect`; still required without it", async () => {
    const adapter = memoryAdapter();
    const base = { adapter, verifyToken: "verify-token-value", resolveToken: () => "unused" };
    const sendo = createSendo({ ...base, connect: CONNECT_OPTIONS });
    const body = freshFixture("unrouted-phone-number");
    const tasks: Promise<unknown>[] = [];
    const response = await sendo.handleWebhook(relayPost(body), {
      waitUntil: (p) => tasks.push(p),
    });
    await Promise.all(tasks);
    expect(response.status).toBe(200);
    expect(adapter.__state.events.size).toBe(1);

    const errors = [
      () => createSendo({ ...base }),
      () => createSendo({ ...base, connect: { apiKey: API_KEY, signingSecret: " " } }),
      () =>
        createSendo({
          ...base,
          connect: { ...CONNECT_OPTIONS, baseUrl: "http://connect.example" },
        }),
      () =>
        createSendo({
          adapter,
          connect: CONNECT_OPTIONS,
          transport: { kind: "custom", send: vi.fn(), fetchMedia: vi.fn() },
        }),
    ].map((build) => {
      try {
        build();
        return null;
      } catch (error) {
        return error as SendoError;
      }
    });
    expect(errors.map((e) => e?.code)).toEqual([
      "CONFIG_ERROR",
      "CONFIG_ERROR",
      "CONFIG_ERROR",
      "CONFIG_ERROR",
    ]);
    expect(errors[0]?.message).toContain("connect");
    expect(errors[1]?.message).toContain("connect.signingSecret");
    expect(errors[2]?.message).toContain("connect.baseUrl");
    expect(errors[3]?.message).toContain("meta-direct");
    for (const error of errors) expect(errorSurface(error)).not.toContain(API_KEY);
  });
});

/* ---------------------------------------------------------------- signup via Connect */

interface ConnectCall {
  authorization: string | null;
  body: unknown;
}

/** Connect's signup endpoint: answers `respond()` (default success) and records each call. */
function connectSignup(respond?: () => Response) {
  const calls: ConnectCall[] = [];
  graph.server.use(
    http.post(`${CONNECT}/v1/signup/complete`, async ({ request }) => {
      calls.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      });
      return respond
        ? respond()
        : HttpResponse.json({
            token: BUSINESS_TOKEN,
            displayPhone: DISPLAY,
            wabaId: WABA,
            phoneNumberId: PHONE_ID,
          });
    }),
  );
  return calls;
}

/** Graph: billing read, unsubscribe (compensation) and sends, each with the business token. */
function graphForConnect(sends: unknown[] = []) {
  graph.server.use(
    http.get(`${GRAPH}/:id`, ({ params }) =>
      HttpResponse.json({ id: params.id, primary_funding_id: "987654321" }),
    ),
    http.delete(`${GRAPH}/:waba/subscribed_apps`, () => HttpResponse.json({ success: true })),
    http.post(`${GRAPH}/:phone/messages`, async ({ request }) => {
      sends.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      });
      return HttpResponse.json({ messages: [{ id: "wamid.OUT1" }] });
    }),
  );
}

/** Graph and Connect calls in order, e.g. `GET {waba}` or `POST connect /v1/signup/complete`. */
function calls(): string[] {
  return graph.requests.map((r) => {
    const url = new URL(r.url);
    if (url.origin === CONNECT) return `${r.method} connect ${url.pathname}`;
    return `${r.method} ${url.pathname.replace(`/${GRAPH_API_VERSION}/`, "")}`;
  });
}

function signupClient(options: ClientOptions = {}) {
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
  // No `meta.appId` and no app secret: Connect uses Quami's Meta app.
  const c = makeClient({
    connect: CONNECT_OPTIONS,
    appSecret: undefined,
    storeToken,
    deleteToken,
    resolveToken: (account) => stored.get(account.tokenRef),
    ...options,
  });
  const events: unknown[] = [];
  for (const name of ["account.default", "account.billing", "account.error"] as const) {
    c.sendo.on(name, (payload) => {
      events.push({ name, payload });
    });
  }
  return { ...c, stored, storeToken, deleteToken, events };
}

type SignupClient = ReturnType<typeof signupClient>;

async function expectNoSecrets(c: SignupClient, error?: unknown, extra: string[] = []) {
  const haystack = [
    JSON.stringify(c.logs.entries.map((e) => e.args.map(String))),
    JSON.stringify(await c.adapter.accounts.list({})),
    dumpState(c.adapter.__state),
    JSON.stringify(c.events),
    error === undefined ? "" : errorSurface(error),
  ].join("\n");
  for (const secret of [...SECRETS, ...extra]) expect(haystack).not.toContain(secret);
}

const input = (overrides: Record<string, unknown> = {}) => ({
  code: CODE,
  tenantId: TENANT,
  wabaId: WABA,
  phoneNumberId: PHONE_ID,
  ...overrides,
});

describe("[AC-CN-3] Embedded Signup through Connect", () => {
  it("POSTs to Connect with the API key, stores the token, then a relayed message is answered straight through Graph", async () => {
    const connect = connectSignup();
    const sends: { authorization: string | null; body: unknown }[] = [];
    graphForConnect(sends);
    const c = signupClient();

    const account = await c.sendo.accounts.completeEmbeddedSignup(input());

    expect(connect).toHaveLength(1);
    expect(connect[0]?.authorization).toBe(`Bearer ${API_KEY}`);
    const sent = connect[0]?.body as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      "code",
      "coexistence",
      "phoneNumberId",
      "pin",
      "wabaId",
    ]);
    expect(sent).toMatchObject({
      code: CODE,
      wabaId: WABA,
      phoneNumberId: PHONE_ID,
      coexistence: false,
    });
    expect(sent.pin).toMatch(/^\d{6}$/);
    // Steps 1–4 never touch Graph from the app; only the billing read (step 8) does.
    expect(calls()).toEqual(["POST connect /v1/signup/complete", `GET ${WABA}`]);
    expect(c.storeToken).toHaveBeenCalledWith({
      account: { tenantId: TENANT, phoneNumberId: PHONE_ID, wabaId: WABA },
      token: BUSINESS_TOKEN,
    });
    expect(account).toMatchObject({
      tenantId: TENANT,
      phoneNumberId: PHONE_ID,
      displayPhone: DISPLAY,
      tokenRef: `vault:${PHONE_ID}:1`,
      active: true,
      isDefault: true,
      onboardedVia: "connect",
      billingReady: true,
    });

    // The relay forwards the customer's message; the reply goes directly to Meta.
    const relayed = await deliver(c.sendo, c.adapter, relayPost(freshFixture("text")));
    expect(relayed.status).toBe(200);
    graph.requests.length = 0;
    await c.sendo.send.text(FIXTURE_IDS.waId, "Hola desde Connect", { account: account.id });
    expect(calls()).toEqual([`POST ${PHONE_ID}/messages`]);
    expect(sends[0]?.authorization).toBe(`Bearer ${BUSINESS_TOKEN}`);
    await expectNoSecrets(c, undefined, [String(sent.pin)]);
  });

  it("coexistence sends pin null; a given PIN is passed through and never stored", async () => {
    const connect = connectSignup();
    graphForConnect();
    const c = signupClient();
    await c.sendo.accounts.completeEmbeddedSignup(input({ coexistence: true }));
    await c.sendo.accounts.completeEmbeddedSignup(
      input({ phoneNumberId: "100000000000088", pin: "424242" }),
    );
    expect(connect.map((call) => call.body)).toMatchObject([
      { coexistence: true, pin: null },
      { coexistence: false, pin: "424242", phoneNumberId: "100000000000088" },
    ]);
    await expectNoSecrets(c, undefined, ["424242"]);
  });

  it("a number connected in another tenant is ACCOUNT_EXISTS before Connect is called", async () => {
    const connect = connectSignup();
    const c = signupClient();
    await c.adapter.accounts.insert({
      tenantId: "tenant-b",
      phoneNumberId: PHONE_ID,
      wabaId: WABA,
      displayPhone: DISPLAY,
      tokenRef: "SENDO_TOKEN_B",
    });
    const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
    expect(error.code).toBe("ACCOUNT_EXISTS");
    expect(connect).toHaveLength(0);
  });

  describe("Connect failures leave storage untouched", () => {
    const connectError = (status: number, error: Record<string, unknown>) => () =>
      HttpResponse.json({ error }, { status });
    const cases: {
      name: string;
      respond: () => Response;
      code: string;
      step?: string;
      message?: string;
    }[] = [
      {
        name: "API key rejected (401) → CONFIG_ERROR naming SENDO_CONNECT_API_KEY",
        respond: connectError(401, { code: "unauthorized", message: `bad key ${API_KEY}` }),
        code: "CONFIG_ERROR",
        message: "SENDO_CONNECT_API_KEY",
      },
      {
        name: "expired code reported by Connect (exchange_code, 100/36007)",
        respond: connectError(400, {
          code: "meta_error",
          step: "exchange_code",
          metaCode: 100,
          subcode: 36007,
          fbtraceId: "TR",
          message: `This authorization code has expired. code=${CODE}`,
        }),
        code: "SIGNUP_CODE_EXPIRED",
        step: "exchange_code",
      },
      {
        name: "PIN conflict reported by Connect (register_phone, 133005)",
        respond: connectError(400, {
          code: "meta_error",
          step: "register_phone",
          metaCode: 133005,
          message: "PIN mismatch",
        }),
        code: "PIN_CONFLICT",
        step: "register_phone",
      },
      {
        name: "missing permission reported by Connect (subscribe_app, 200)",
        respond: connectError(403, {
          code: "meta_error",
          step: "subscribe_app",
          metaCode: 200,
          message: "Permissions error",
        }),
        code: "META_PERMISSION_MISSING",
        step: "subscribe_app",
      },
      {
        name: "Connect 500 without a step",
        respond: connectError(500, { code: "internal", message: "relay database down" }),
        code: "SIGNUP_FAILED",
        step: "connect",
      },
      {
        name: "Connect unreachable",
        respond: () => HttpResponse.error(),
        code: "SIGNUP_FAILED",
        step: "connect",
      },
      {
        name: "200 without a token",
        respond: () => HttpResponse.json({ displayPhone: DISPLAY }),
        code: "SIGNUP_FAILED",
        step: "connect",
      },
    ];

    for (const t of cases) {
      it(`${t.name} → ${t.code}`, async () => {
        connectSignup(t.respond);
        const c = signupClient();
        const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
        expect(error.toJSON()).toMatchObject({ code: t.code, ...(t.step && { step: t.step }) });
        if (t.message !== undefined) expect(error.message).toContain(t.message);
        expect(calls()).toEqual(["POST connect /v1/signup/complete"]);
        expect(c.storeToken).not.toHaveBeenCalled();
        expect(c.deleteToken).not.toHaveBeenCalled();
        expect(await c.adapter.accounts.list({})).toEqual([]);
        await expectNoSecrets(c, error);
      });
    }
  });

  it("a failure after storeToken compensates: deleteToken, app unsubscribed with the token, no row", async () => {
    connectSignup();
    graphForConnect();
    const c = signupClient();
    const original = c.adapter.accounts.insert.bind(c.adapter.accounts);
    let broken = false;
    (c.adapter.accounts as { insert: SendoAdapter["accounts"]["insert"] }).insert = (row) => {
      if (broken) return original(row);
      broken = true;
      return Promise.reject(new Error("database unavailable"));
    };

    const error = await failure(c.sendo.accounts.completeEmbeddedSignup(input()));
    expect(error.toJSON()).toMatchObject({ code: "SIGNUP_FAILED", step: "save_account" });
    expect(c.deleteToken).toHaveBeenCalledWith(`vault:${PHONE_ID}:1`);
    expect(c.stored.size).toBe(0);
    expect(calls()).toEqual(["POST connect /v1/signup/complete", `DELETE ${WABA}/subscribed_apps`]);
    const unsubscribe = graph.requests.at(-1);
    expect(unsubscribe?.url).toContain(`/${WABA}/subscribed_apps`);
    expect(await c.adapter.accounts.list({})).toEqual([]);
    await expectNoSecrets(c, error);
  });
});

/* ---------------------------------------------------------------- doctor */

interface WebhookAnswer {
  status?: number;
  body?: Record<string, unknown>;
  network?: true;
}

function connectWebhook(answer: WebhookAnswer = {}) {
  const auth: (string | null)[] = [];
  graph.server.use(
    http.get(`${CONNECT}/v1/projects/current/webhook`, ({ request }) => {
      auth.push(request.headers.get("authorization"));
      if (answer.network) return HttpResponse.error();
      return HttpResponse.json(
        answer.body ?? {
          projectId: "prj_123",
          url: CLI_WEBHOOK_URL,
          lastDelivery: { at: "2026-10-09T11:59:00.000Z", statusCode: 200 },
        },
        { status: answer.status ?? 200 },
      );
    }),
  );
  return auth;
}

const connectEnv = (overrides: Record<string, string | undefined> = {}) =>
  doctorEnv({
    SENDO_META_APP_SECRET: undefined,
    SENDO_CONNECT_API_KEY: API_KEY,
    SENDO_CONNECT_SIGNING_SECRET: SIGNING_SECRET,
    ...overrides,
  });

async function doctor(env: Record<string, string | undefined>) {
  const adapter = await seededAdapter();
  const out: string[] = [];
  const deps: CliDeps = {
    env,
    cwd: "/app",
    stdout: (text) => out.push(text),
    stderr: () => undefined,
    readFile: () => null,
    createAdapter: () => Promise.resolve(adapter),
    version: "9.9.9",
  };
  const code = await runCli(["doctor", "--url", CLI_WEBHOOK_URL, "--json"], deps);
  const raw = out.join("");
  return { code, raw, results: JSON.parse(raw) as CheckResult[] };
}

function byId(results: CheckResult[], id: string): CheckResult | undefined {
  return results.find((r) => r.id === id);
}

describe("[AC-CN-3] sendo doctor with Sendo Connect", () => {
  it("passes with a valid key, the registered URL and a 200 delivery; no Meta app secret needed", async () => {
    graph.server.use(...healthyGraph());
    const auth = connectWebhook();
    const { code, raw, results } = await doctor(connectEnv());

    expect(auth).toEqual([`Bearer ${API_KEY}`]);
    expect(byId(results, "env")).toMatchObject({ ok: true });
    expect(byId(results, "connect:key")).toMatchObject({ ok: true });
    expect(byId(results, "connect:key")?.detail).toContain("prj_123");
    expect(byId(results, "connect:webhook")).toMatchObject({ ok: true });
    expect(byId(results, "connect:delivery")).toMatchObject({ ok: true });
    expect(byId(results, `account:${CLI_PHONE_ID}:phone`)).toMatchObject({ ok: true });
    expect(code).toBe(0);
    for (const secret of [API_KEY, SIGNING_SECRET]) expect(raw).not.toContain(secret);
  });

  it("without connect env vars there are no connect checks", async () => {
    graph.server.use(...healthyGraph());
    const { results } = await doctor(doctorEnv());
    expect(results.filter((r) => r.id.startsWith("connect:"))).toEqual([]);
  });

  const scenarios: {
    name: string;
    env?: Record<string, string | undefined>;
    answer: WebhookAnswer;
    id: string;
    kind: string;
    warning?: true;
    absent?: string[];
  }[] = [
    {
      name: "key rejected",
      answer: { status: 401, body: { error: { code: "unauthorized", message: "bad key" } } },
      id: "connect:key",
      kind: "env",
      absent: ["connect:webhook", "connect:delivery"],
    },
    {
      name: "Connect unreachable",
      answer: { network: true },
      id: "connect:key",
      kind: "config",
    },
    {
      name: "only one of the two env vars",
      env: { SENDO_CONNECT_SIGNING_SECRET: undefined },
      answer: {},
      id: "env",
      kind: "env",
    },
    {
      name: "no webhook URL registered",
      answer: { body: { projectId: "prj_123", url: null, lastDelivery: null } },
      id: "connect:webhook",
      kind: "webhook",
    },
    {
      name: "a different webhook URL registered",
      answer: {
        body: { url: "https://old.example.com/api/sendo/webhook", lastDelivery: null },
      },
      id: "connect:webhook",
      kind: "webhook",
    },
    {
      name: "last delivery rejected with 401 (signing secret mismatch)",
      answer: {
        body: {
          url: CLI_WEBHOOK_URL,
          lastDelivery: { at: "2026-10-09T11:59:00.000Z", statusCode: 401 },
        },
      },
      id: "connect:delivery",
      kind: "env",
    },
    {
      name: "last delivery answered 500",
      answer: {
        body: {
          url: CLI_WEBHOOK_URL,
          lastDelivery: { at: "2026-10-09T11:59:00.000Z", statusCode: 500 },
        },
      },
      id: "connect:delivery",
      kind: "webhook",
    },
    {
      name: "no delivery yet (warning)",
      answer: { body: { url: CLI_WEBHOOK_URL, lastDelivery: null } },
      id: "connect:delivery",
      kind: "webhook",
      warning: true,
    },
  ];

  for (const s of scenarios) {
    it(`${s.name} → ${s.id} fails with a ${s.kind} fix`, async () => {
      graph.server.use(...healthyGraph());
      connectWebhook(s.answer);
      const { code, raw, results } = await doctor(connectEnv(s.env));
      const check = byId(results, s.id);
      expect(check, JSON.stringify(results.map((r) => r.id))).toBeDefined();
      expect(check?.ok).toBe(false);
      expect(check?.fix?.kind).toBe(s.kind);
      expect(check?.fix?.docsUrl).toMatch(/^https:\/\/sendo\.dev\/docs\/[a-z-]+$/);
      expect(check?.fix?.detail.length).toBeGreaterThan(10);
      if (s.warning) {
        expect(check?.warning).toBe(true);
        expect(code).toBe(0);
      } else {
        expect(code).toBe(1);
      }
      for (const id of s.absent ?? []) expect(byId(results, id)).toBeUndefined();
      for (const secret of [API_KEY, SIGNING_SECRET]) expect(raw).not.toContain(secret);
    });
  }
});
