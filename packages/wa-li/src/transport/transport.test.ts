import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGraphClient, GRAPH_API_VERSION } from "../client/graph-client";
import { buildTextPayload } from "../client/payloads";
import { ConfigError, MediaTooLargeError, NotImplementedError } from "../errors/errors";
import { MetaApiError } from "../errors/meta-api-error";
import type { Account } from "../types/entities";
import { metaDirect } from "./meta-direct";
import { quamiCloud } from "./quami-cloud";

const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const TOKENS: Record<string, string> = {
  WA_TOKEN_A: "token-account-a-xyz",
  WA_TOKEN_B: "token-account-b-xyz",
};

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-a",
    tenantId: "tenant-1",
    phoneNumberId: "PN_A",
    wabaId: "WABA_A",
    displayPhone: "+50255550000",
    tokenRef: "WA_TOKEN_A",
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
  it("exposes its secrets and graph client for webhook and doctor use", () => {
    const graph = createGraphClient({ version: "v24.0" });
    const transport = metaDirect({
      appSecret: "s",
      verifyToken: "v",
      resolveToken: () => "t",
      graph,
    });
    expect(transport.kind).toBe("meta-direct");
    expect(transport.appSecret).toBe("s");
    expect(transport.verifyToken).toBe("v");
    expect(transport.graph).toBe(graph);
    expect(
      metaDirect({ appSecret: "s", verifyToken: "v", resolveToken: () => "t", version: "v23.0" })
        .graph.version,
    ).toBe("v23.0");
  });

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
        tokenRef: "WA_TOKEN_B",
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

  it("fetches media metadata then bytes with the bearer token", async () => {
    let downloadAuth: string | null = null;
    server.use(
      http.get(`${GRAPH}/MEDIA1`, () =>
        HttpResponse.json({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA1",
          mime_type: "audio/ogg",
          sha256: "hash",
        }),
      ),
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", ({ request }) => {
        downloadAuth = request.headers.get("authorization");
        return new HttpResponse(new Uint8Array([5, 6]));
      }),
    );
    const media = await makeTransport().fetchMedia(makeAccount(), "MEDIA1");
    expect(media).toEqual({
      bytes: new Uint8Array([5, 6]),
      mimeType: "audio/ogg",
      sha256: "hash",
      fileSize: 2,
    });
    expect(downloadAuth).toBe("Bearer token-account-a-xyz");
  });

  it("uploads media and enforces size limits first", async () => {
    let uploads = 0;
    server.use(
      http.post(`${GRAPH}/PN_A/media`, () => {
        uploads++;
        return HttpResponse.json({ id: "UP1" });
      }),
    );
    const transport = makeTransport();
    await expect(
      transport.uploadMedia(makeAccount(), {
        file: new Uint8Array(10),
        mimeType: "image/jpeg",
        mediaType: "image",
      }),
    ).resolves.toEqual({ mediaId: "UP1" });
    await expect(
      transport.uploadMedia(makeAccount(), {
        file: new Uint8Array(16 * 1024 * 1024 + 1),
        mimeType: "video/mp4",
      }),
    ).rejects.toBeInstanceOf(MediaTooLargeError);
    expect(uploads).toBe(1);
  });

  it("marks messages read", async () => {
    let body: unknown;
    server.use(
      http.post(`${GRAPH}/PN_A/messages`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );
    await makeTransport().markRead(makeAccount(), "wamid.IN");
    expect(body).toMatchObject({ status: "read", message_id: "wamid.IN" });
  });

  it("throws ConfigError when no token resolves, without calling Meta", async () => {
    const transport = makeTransport();
    await expect(
      transport.send(makeAccount({ tokenRef: "MISSING" }), buildTextPayload("+1", "x")),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("propagates MetaApiError 190 without the token", async () => {
    server.use(
      http.post(`${GRAPH}/PN_A/messages`, () =>
        HttpResponse.json(
          { error: { code: 190, message: "Error validating access token: token-account-a-xyz" } },
          { status: 401 },
        ),
      ),
    );
    const error = await makeTransport()
      .send(makeAccount(), buildTextPayload("+1", "x"))
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).isInvalidToken).toBe(true);
    expect((error as MetaApiError).message).not.toContain("token-account-a-xyz");
  });
});

describe("quamiCloud", () => {
  it("reserves the V3 transport: every method throws NotImplementedError", async () => {
    const transport = quamiCloud({ apiKey: "k" });
    expect(transport.kind).toBe("quami-cloud");
    await expect(transport.send(makeAccount(), buildTextPayload("+1", "x"))).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    await expect(transport.fetchMedia(makeAccount(), "m")).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    await expect(transport.handleWebhook?.(new Request("https://x.dev"))).rejects.toBeInstanceOf(
      NotImplementedError,
    );
    expect(() => transport.subscribe?.(() => undefined)).toThrow(NotImplementedError);
  });
});
