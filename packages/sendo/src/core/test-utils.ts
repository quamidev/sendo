import { http, HttpResponse, passthrough, type JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { memoryAdapter, type MemoryAdapterOptions } from "../adapters/memory";
import type { AccountInsertInput } from "../adapters/types";
import { GRAPH_API_VERSION } from "../client/graph-client";
import type { Account } from "../types/entities";
import type { LogLevel } from "../utils/logger";
import type { MetaDirectShorthandConfig } from "./config";
import { getContext } from "./context";
import { createSendo } from "./create-sendo";

export const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export const TOKENS: Record<string, string> = {
  SENDO_TOKEN_A: "token-account-a-secret",
  SENDO_TOKEN_B: "token-account-b-secret",
};

export interface GraphRecorder {
  /** Every request that reached msw, in order. */
  requests: { method: string; url: string; body: unknown }[];
}

/** msw server for the Graph API; fails on unhandled requests and records every request. */
/** URL prefixes that msw lets through untouched (for example a local Supabase); default handlers survive `resetHandlers`. */
export interface GraphServerOptions {
  passthrough?: string[];
}

export function useGraphServer(
  options: GraphServerOptions = {},
): { server: ReturnType<typeof setupServer> } & GraphRecorder {
  const server = setupServer(
    ...(options.passthrough ?? []).map((prefix) => http.all(`${prefix}/*`, () => passthrough())),
  );
  const recorder: GraphRecorder = { requests: [] };
  server.events.on("request:start", ({ request }) => {
    const clone = request.clone();
    const entry = { method: request.method, url: request.url, body: undefined as unknown };
    recorder.requests.push(entry);
    const type = clone.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      void clone
        .json()
        .then((body: unknown) => {
          entry.body = body;
        })
        .catch(() => undefined); // JSON content-type with an empty body (e.g. passthrough DELETEs)
    }
  });
  beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });
  afterEach(() => {
    server.resetHandlers();
    recorder.requests.length = 0;
  });
  afterAll(() => {
    server.close();
  });
  return { server, ...recorder, requests: recorder.requests };
}

/** Accepts every send with ids `wamid.OUT1`, `wamid.OUT2`... */
export function acceptSends(bodies: unknown[] = []) {
  let n = 0;
  return http.post(`${GRAPH}/:phoneNumberId/messages`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    bodies.push(body);
    if (body.status === "read") return HttpResponse.json({ success: true });
    n++;
    return HttpResponse.json({ messages: [{ id: `wamid.OUT${n}` }] });
  });
}

export function metaError(code: number, status = 400, message = "Meta says no") {
  return http.post(`${GRAPH}/:phoneNumberId/messages`, () =>
    HttpResponse.json(
      { error: { code, message, type: "OAuthException", fbtrace_id: "TRACE" } },
      {
        status,
      },
    ),
  );
}

export function jsonResponse(method: "get" | "post", path: string, body: JsonBodyType) {
  return http[method](`${GRAPH}/${path}`, () => HttpResponse.json(body));
}

export interface CapturedLogs {
  entries: { level: LogLevel; args: unknown[] }[];
  of(level: LogLevel): string[];
}

export function captureLogger() {
  const logs: CapturedLogs = {
    entries: [],
    of: (level) =>
      logs.entries.filter((e) => e.level === level).map((e) => e.args.map(String).join(" ")),
  };
  const make =
    (level: LogLevel) =>
    (...args: unknown[]) => {
      logs.entries.push({ level, args });
    };
  return {
    logs,
    logger: { debug: make("debug"), info: make("info"), warn: make("warn"), error: make("error") },
  };
}

export function accountInput(overrides: Partial<AccountInsertInput> = {}): AccountInsertInput {
  return {
    tenantId: "tenant-a",
    phoneNumberId: "PN_A",
    wabaId: "WABA_A",
    displayPhone: "+15550001111",
    tokenRef: "SENDO_TOKEN_A",
    ...overrides,
  };
}

export interface ClientOptions extends Partial<Omit<MetaDirectShorthandConfig, "adapter">> {
  memory?: MemoryAdapterOptions;
}

export function makeClient(options: ClientOptions = {}) {
  const { memory, ...config } = options;
  const adapter = memoryAdapter(memory);
  const { logs, logger } = captureLogger();
  const sendo = createSendo({
    adapter,
    appSecret: "app-secret-value",
    verifyToken: "verify-token-value",
    resolveToken: (account) => TOKENS[account.tokenRef],
    logger,
    ...config,
  });
  return { sendo, adapter, logs, ctx: getContext(sendo) };
}

/** Creates the contact and conversation and records an inbound message `minutesAgo` ago. */
export async function openConversation(
  ctx: ReturnType<typeof getContext>,
  account: Account,
  phone = "+50255550001",
  minutesAgo = 1,
) {
  const { contact } = await ctx.services.contacts.ensure({ account, phone });
  const { conversation } = await ctx.services.conversations.ensure({
    account,
    contact,
    inbound: { at: new Date(Date.now() - minutesAgo * 60_000) },
  });
  return { contact, conversation };
}

export interface BurstMessage {
  id: string;
  body: string;
  /** Sender wa_id; default the fixture contact. */
  from?: string;
}

/**
 * One Meta payload whose single change carries several text messages (Meta batching a
 * burst), timestamped now in order so the window is open.
 */
export function burstWebhook(messages: BurstMessage[], phoneNumberId = "100000000000001"): string {
  const now = Math.floor(Date.now() / 1000);
  const senders = [...new Set(messages.map((m) => m.from ?? "50255550001"))];
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: phoneNumberId },
              contacts: senders.map((waId, i) => ({
                profile: { name: `Contacto ${String(i + 1)}` },
                wa_id: waId,
              })),
              messages: messages.map((m, i) => ({
                from: m.from ?? "50255550001",
                id: m.id,
                timestamp: String(now - messages.length + i + 1),
                type: "text",
                text: { body: m.body },
              })),
            },
          },
        ],
      },
    ],
  });
}
