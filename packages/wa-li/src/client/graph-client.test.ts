import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MediaTooLargeError } from "../errors/errors";
import { MetaApiError } from "../errors/meta-api-error";
import type { LogFn, Logger } from "../utils/logger";
import { createGraphClient, GRAPH_API_VERSION } from "./graph-client";

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
  it("maps non-JSON error bodies", async () => {
    server.use(http.get(`${GRAPH}/m1`, () => new HttpResponse("Bad gateway", { status: 502 })));
    await expect(createGraphClient().getMediaUrl(TOKEN, "m1")).rejects.toMatchObject({
      status: 502,
      metaCode: null,
    });
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
