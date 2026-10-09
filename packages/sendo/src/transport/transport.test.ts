import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GRAPH_API_VERSION } from "../client/graph-client";
import { buildTextPayload } from "../client/payloads";
import type { Account } from "../types/entities";
import { metaDirect } from "./meta-direct";

const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const TOKENS: Record<string, string> = {
  SENDO_TOKEN_A: "token-account-a-xyz",
  SENDO_TOKEN_B: "token-account-b-xyz",
};

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-a",
    tenantId: "tenant-1",
    phoneNumberId: "PN_A",
    wabaId: "WABA_A",
    displayPhone: "+50255550000",
    tokenRef: "SENDO_TOKEN_A",
    timezone: "America/Guatemala",
    active: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeTransport() {
  return metaDirect({
    appSecret: "app-secret",
    verifyToken: "verify-me",
    resolveToken: (account) => TOKENS[account.tokenRef],
  });
}

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

describe("metaDirect", () => {
  it("sends with each account's own token and phone number id", async () => {
    const seen: { path: string; auth: string | null }[] = [];
    server.use(
      http.post(`${GRAPH}/:phoneId/messages`, ({ request, params }) => {
        seen.push({ path: String(params.phoneId), auth: request.headers.get("authorization") });
        return HttpResponse.json({ messages: [{ id: `wamid.${String(params.phoneId)}` }] });
      }),
    );
    const transport = makeTransport();
    const payload = buildTextPayload("+50255551234", "Hola");
    const a = await transport.send(makeAccount(), payload);
    const b = await transport.send(
      makeAccount({
        id: "acc-b",
        tenantId: "tenant-2",
        phoneNumberId: "PN_B",
        tokenRef: "SENDO_TOKEN_B",
      }),
      payload,
    );
    expect(a).toEqual({ metaMessageId: "wamid.PN_A" });
    expect(b).toEqual({ metaMessageId: "wamid.PN_B" });
    expect(seen).toEqual([
      { path: "PN_A", auth: "Bearer token-account-a-xyz" },
      { path: "PN_B", auth: "Bearer token-account-b-xyz" },
    ]);
  });
});
