import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MediaTooLargeError } from "../errors/errors";
import { MetaApiError } from "../errors/meta-api-error";
import type { LogFn, Logger } from "../utils/logger";
import { createGraphClient, GRAPH_API_VERSION, mediaTypeForMime } from "./graph-client";
import { buildTextPayload } from "./payloads";

const TOKEN = "EAAG-super-secret-token-123456";
const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const PHONE_ID = "1098765";
const WABA_ID = "2002002";

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

function makeLogger(): { logger: Logger; lines: () => string[] } {
  const calls: unknown[][] = [];
  const record: LogFn = (...args) => calls.push(args);
  return {
    logger: { debug: record, info: record, warn: record, error: record },
    lines: () =>
      calls.map((args) =>
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
      ),
  };
}

function metaError(code: number, message: string, extra: Record<string, unknown> = {}) {
  return { error: { message, type: "OAuthException", code, fbtrace_id: "Atrace123", ...extra } };
}

function errorChainText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    if (current instanceof Error) {
      parts.push(current.message, current.stack ?? "", JSON.stringify(current));
      current = current.cause;
    } else {
      parts.push(JSON.stringify(current));
      current = undefined;
    }
  }
  return parts.join("\n");
}

describe("createGraphClient", () => {
  it("pins a v-prefixed default version and accepts overrides", () => {
    expect(GRAPH_API_VERSION).toMatch(/^v\d+\.\d+$/);
    expect(createGraphClient().version).toBe(GRAPH_API_VERSION);
    expect(createGraphClient({ version: "24.0" }).version).toBe("v24.0");
  });

  it("sends messages with the bearer token and returns the Meta id", async () => {
    let seen: { auth: string | null; body: unknown } | undefined;
    server.use(
      http.post(`${GRAPH}/${PHONE_ID}/messages`, async ({ request }) => {
        seen = { auth: request.headers.get("authorization"), body: await request.json() };
        return HttpResponse.json({
          messaging_product: "whatsapp",
          contacts: [{ input: "+50255551234", wa_id: "50255551234" }],
          messages: [{ id: "wamid.OUT1" }],
        });
      }),
    );
    const payload = buildTextPayload("+50255551234", "Hola");
    const result = await createGraphClient().sendMessage(TOKEN, PHONE_ID, payload);
    expect(result).toEqual({ metaMessageId: "wamid.OUT1" });
    expect(seen?.auth).toBe(`Bearer ${TOKEN}`);
    expect(seen?.body).toEqual(payload);
  });

  it("uses a custom version, base URL and fetch", async () => {
    const urls: string[] = [];
    const fakeFetch: typeof fetch = (input) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(Response.json({ messages: [{ id: "wamid.X" }] }));
    };
    const client = createGraphClient({
      version: "v99.0",
      baseUrl: "https://graph.test/",
      fetch: fakeFetch,
    });
    await client.sendMessage(TOKEN, PHONE_ID, buildTextPayload("+1", "x"));
    expect(urls).toEqual([`https://graph.test/v99.0/${PHONE_ID}/messages`]);
  });

  it("throws MetaApiError when the response has no message id", async () => {
    server.use(
      http.post(`${GRAPH}/${PHONE_ID}/messages`, () => HttpResponse.json({ messages: [] })),
    );
    await expect(
      createGraphClient().sendMessage(TOKEN, PHONE_ID, buildTextPayload("+1", "x")),
    ).rejects.toBeInstanceOf(MetaApiError);
  });

  it("maps Graph error bodies to MetaApiError with code, subcode and fbtraceId", async () => {
    server.use(
      http.post(`${GRAPH}/${PHONE_ID}/messages`, () =>
        HttpResponse.json(
          metaError(131047, "Re-engagement message", {
            type: "OAuthException",
            error_subcode: 2494010,
            error_data: { details: "More than 24 hours have passed" },
          }),
          { status: 400 },
        ),
      ),
    );
    const error = await createGraphClient()
      .sendMessage(TOKEN, PHONE_ID, buildTextPayload("+1", "x"))
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({
      status: 400,
      metaCode: 131047,
      subcode: 2494010,
      fbtraceId: "Atrace123",
      details: "More than 24 hours have passed",
      isInvalidToken: false,
    });
  });

  it("flags error 190 as an invalid token", async () => {
    server.use(
      http.get(`${GRAPH}/${PHONE_ID}`, () =>
        HttpResponse.json(metaError(190, "Error validating access token"), { status: 401 }),
      ),
    );
    const error = await createGraphClient()
      .getPhoneNumber(TOKEN, PHONE_ID)
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).metaCode).toBe(190);
    expect((error as MetaApiError).isInvalidToken).toBe(true);
    expect((error as MetaApiError).code).toBe("META_API_ERROR");
  });

  it("maps non-JSON error bodies", async () => {
    server.use(http.get(`${GRAPH}/m1`, () => new HttpResponse("Bad gateway", { status: 502 })));
    await expect(createGraphClient().getMediaUrl(TOKEN, "m1")).rejects.toMatchObject({
      status: 502,
      metaCode: null,
    });
  });

  it("gets a media URL", async () => {
    server.use(
      http.get(`${GRAPH}/media-1`, () =>
        HttpResponse.json({
          messaging_product: "whatsapp",
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
          mime_type: "image/jpeg",
          sha256: "abc",
          file_size: "2048",
          id: "media-1",
        }),
      ),
    );
    expect(await createGraphClient().getMediaUrl(TOKEN, "media-1")).toEqual({
      url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
      mimeType: "image/jpeg",
      sha256: "abc",
      fileSize: 2048,
    });
  });

  it("downloads media sending the bearer token", async () => {
    const url = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1";
    let auth: string | null = null;
    server.use(
      http.get("https://lookaside.fbsbx.com/whatsapp_business/attachments/", ({ request }) => {
        auth = request.headers.get("authorization");
        return new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "image/jpeg" },
        });
      }),
    );
    const bytes = await createGraphClient().downloadMedia(TOKEN, url);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(auth).toBe(`Bearer ${TOKEN}`);
  });

  it("uploads media as multipart form data", async () => {
    let raw = "";
    let contentType: string | null = null;
    server.use(
      http.post(`${GRAPH}/${PHONE_ID}/media`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        raw = await request.text();
        return HttpResponse.json({ id: "uploaded-1" });
      }),
    );
    const result = await createGraphClient().uploadMedia(
      TOKEN,
      PHONE_ID,
      new TextEncoder().encode("%PDF-1.7"),
      "application/pdf",
      "orden.pdf",
    );
    expect(result).toEqual({ mediaId: "uploaded-1" });
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(raw).toMatch(/name="messaging_product"\r\n\r\nwhatsapp\r\n/);
    expect(raw).toMatch(/name="type"\r\n\r\napplication\/pdf\r\n/);
    expect(raw).toMatch(
      /name="file"; filename="orden\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-1\.7\r\n/,
    );
  });

  it("rejects oversized media before any upload request", async () => {
    let requests = 0;
    server.use(
      http.post(`${GRAPH}/${PHONE_ID}/media`, () => {
        requests++;
        return HttpResponse.json({ id: "x" });
      }),
    );
    const big = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" });
    await expect(
      createGraphClient().uploadMedia(TOKEN, PHONE_ID, big, "image/png"),
    ).rejects.toBeInstanceOf(MediaTooLargeError);
    await expect(
      createGraphClient().uploadMedia(TOKEN, PHONE_ID, new Uint8Array(600 * 1024), "image/png", {
        mediaType: "sticker",
      }),
    ).rejects.toBeInstanceOf(MediaTooLargeError);
    expect(requests).toBe(0);
  });

  it("lists templates following paging.next", async () => {
    const pages: string[] = [];
    server.use(
      http.get(`${GRAPH}/${WABA_ID}/message_templates`, ({ request }) => {
        const url = new URL(request.url);
        pages.push(url.searchParams.get("after") ?? "first");
        expect(request.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
        if (url.searchParams.get("after") === "CURSOR2") {
          return HttpResponse.json({
            data: [
              {
                id: "t3",
                name: "promo",
                language: "es",
                status: "REJECTED",
                category: "MARKETING",
                components: [],
              },
            ],
            paging: { cursors: { before: "x", after: "y" } },
          });
        }
        return HttpResponse.json({
          data: [
            {
              id: "t1",
              name: "recordatorio",
              language: "es",
              status: "APPROVED",
              category: "UTILITY",
              parameter_format: "POSITIONAL",
              components: [{ type: "BODY", text: "Hola {{1}}, tu cita es a las {{2}}" }],
            },
            {
              id: "t2",
              name: "recordatorio",
              language: "en_US",
              status: "APPROVED",
              category: "UTILITY",
              components: [],
            },
          ],
          paging: { next: `${GRAPH}/${WABA_ID}/message_templates?limit=2&after=CURSOR2` },
        });
      }),
    );
    const templates = await createGraphClient().listTemplates(TOKEN, WABA_ID);
    expect(pages).toEqual(["first", "CURSOR2"]);
    expect(templates.map((t) => `${t.name}:${t.language}:${t.status}`)).toEqual([
      "recordatorio:es:APPROVED",
      "recordatorio:en_US:APPROVED",
      "promo:es:REJECTED",
    ]);
    expect(templates[0]).toMatchObject({
      id: "t1",
      category: "UTILITY",
      parameter_format: "POSITIONAL",
      components: [{ type: "BODY", text: "Hola {{1}}, tu cita es a las {{2}}" }],
    });
  });

  it("stops when paging.next repeats", async () => {
    let calls = 0;
    const next = `${GRAPH}/${WABA_ID}/message_templates?after=SAME`;
    server.use(
      http.get(`${GRAPH}/${WABA_ID}/message_templates`, () => {
        calls++;
        return HttpResponse.json({ data: [], paging: { next } });
      }),
    );
    await createGraphClient().listTemplates(TOKEN, WABA_ID);
    expect(calls).toBe(2);
  });

  it("gets the phone number with the doctor fields", async () => {
    let fields: string | null = null;
    server.use(
      http.get(`${GRAPH}/${PHONE_ID}`, ({ request }) => {
        fields = new URL(request.url).searchParams.get("fields");
        return HttpResponse.json({
          id: PHONE_ID,
          display_phone_number: "+502 5555 0000",
          verified_name: "Clínica Demo",
          quality_rating: "GREEN",
          code_verification_status: "VERIFIED",
          throughput: { level: "STANDARD" },
        });
      }),
    );
    const phone = await createGraphClient().getPhoneNumber(TOKEN, PHONE_ID);
    expect(fields).toContain("display_phone_number");
    expect(fields).toContain("code_verification_status");
    expect(phone).toEqual({
      id: PHONE_ID,
      displayPhoneNumber: "+502 5555 0000",
      verifiedName: "Clínica Demo",
      qualityRating: "GREEN",
      codeVerificationStatus: "VERIFIED",
      nameStatus: null,
      platformType: null,
      throughputLevel: "STANDARD",
    });
  });

  it("gets subscribed apps", async () => {
    server.use(
      http.get(`${GRAPH}/${WABA_ID}/subscribed_apps`, () =>
        HttpResponse.json({
          data: [
            {
              whatsapp_business_api_data: { id: "app1", name: "Quami", link: "https://quami.dev" },
            },
          ],
        }),
      ),
    );
    expect(await createGraphClient().getSubscribedApps(TOKEN, WABA_ID)).toEqual([
      { id: "app1", name: "Quami", link: "https://quami.dev" },
    ]);
  });

  it("marks a message as read", async () => {
    let body: unknown;
    server.use(
      http.post(`${GRAPH}/${PHONE_ID}/messages`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );
    await createGraphClient().markRead(TOKEN, PHONE_ID, "wamid.IN1");
    expect(body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.IN1",
    });
  });

  it("wraps network failures in MetaApiError without leaking the token", async () => {
    const failingFetch: typeof fetch = () =>
      Promise.reject(new TypeError(`connect ECONNREFUSED (Authorization: Bearer ${TOKEN})`));
    const { logger, lines } = makeLogger();
    const error = await createGraphClient({ fetch: failingFetch, logger })
      .getMediaUrl(TOKEN, "m1")
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MetaApiError);
    expect(error).toMatchObject({ status: 0, type: "NetworkError" });
    expect(errorChainText(error)).not.toContain(TOKEN);
    expect(lines().join("\n")).not.toContain(TOKEN);
  });
});

describe("token redaction", () => {
  it("keeps the token out of logs, errors, toJSON() and error.cause", async () => {
    server.use(
      http.post(`${GRAPH}/${PHONE_ID}/messages`, () =>
        HttpResponse.json(
          metaError(190, `Invalid OAuth access token - Cannot parse access token: ${TOKEN}`, {
            error_data: { details: `access_token=${TOKEN}` },
          }),
          { status: 401 },
        ),
      ),
      http.get(`${GRAPH}/media-2`, () =>
        HttpResponse.json({
          url: `https://lookaside.fbsbx.com/m?access_token=${TOKEN}`,
          mime_type: "image/png",
        }),
      ),
    );
    const { logger, lines } = makeLogger();
    const client = createGraphClient({ logger });

    const error = await client
      .sendMessage(TOKEN, PHONE_ID, buildTextPayload("+1", "x"))
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MetaApiError);
    expect((error as MetaApiError).isInvalidToken).toBe(true);
    expect((error as MetaApiError).message).not.toContain(TOKEN);
    expect(JSON.stringify((error as MetaApiError).toJSON())).not.toContain(TOKEN);
    expect(errorChainText(error)).not.toContain(TOKEN);

    await client.getMediaUrl(TOKEN, "media-2");

    const output = lines();
    expect(output.length).toBeGreaterThan(0);
    for (const line of output) expect(line).not.toContain(TOKEN);
  });
});

describe("mediaTypeForMime", () => {
  it.each([
    ["image/jpeg", "image"],
    ["image/webp", "sticker"],
    ["audio/ogg; codecs=opus", "audio"],
    ["video/mp4", "video"],
    ["application/pdf", "document"],
  ] as const)("%s → %s", (mime, type) => {
    expect(mediaTypeForMime(mime)).toBe(type);
  });
});
