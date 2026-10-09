import { inspect } from "node:util";
import { http, HttpResponse } from "msw";
import { expect } from "vitest";
import { GRAPH, accountInput, makeClient, type ClientOptions } from "../../src/core/test-utils";
import type { MessageEvent } from "../../src/core/events";
import type { SendoEvent } from "../../src/types/entities";
import { FIXTURE_IDS, loadWebhookFixtureText, type WebhookFixtureName } from "../support/fixtures";
import { signFixture } from "../support/sign";

/** Shared harness for the WAL-6.1 integration suites: real client, memory adapter, msw Graph API. */

export const APP_SECRET = "app-secret-value";
export const VERIFY_TOKEN = "verify-token-value";
export const WEBHOOK_URL = "https://app.example/api/sendo/webhook";
export const LOOKASIDE = "https://lookaside.example/media";
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Media ids used by the fixtures and the MIME type Meta reports for each. */
export const FIXTURE_MEDIA: Record<string, string> = {
  "300000000000001": "image/jpeg",
  "300000000000002": "audio/ogg; codecs=opus",
  "300000000000003": "video/mp4",
  "300000000000004": "application/pdf",
  "300000000000005": "image/webp",
};

export const MEDIA_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

/** Graph media lookups plus the lookaside download for every fixture media id. */
export function mediaHandlers(bytes: Uint8Array = MEDIA_BYTES) {
  return [
    http.get(`${GRAPH}/:mediaId`, ({ params }) => {
      const id = String(params.mediaId);
      const mime = FIXTURE_MEDIA[id];
      if (!mime)
        return HttpResponse.json({ error: { code: 100, message: "nope" } }, { status: 404 });
      return HttpResponse.json({
        id,
        url: `${LOOKASIDE}/${id}`,
        mime_type: mime,
        sha256: `sha-${id}`,
        file_size: bytes.byteLength,
      });
    }),
    http.get(`${LOOKASIDE}/:mediaId`, ({ params }) => {
      const mime = FIXTURE_MEDIA[String(params.mediaId)] ?? "application/octet-stream";
      return new HttpResponse(bytes.slice(), { headers: { "content-type": mime } });
    }),
  ];
}

/** Fixture text with every message timestamp moved to now (so the 24 h window is open). */
export function freshFixture(
  name: WebhookFixtureName,
  patch: (json: string) => string = (s) => s,
): string {
  const now = String(Math.floor(Date.now() / 1000));
  return patch(loadWebhookFixtureText(name)).replace(
    /"timestamp":\s*"\d+"/g,
    `"timestamp": "${now}"`,
  );
}

/** A fixture name or a raw JSON body. */
export type Body = string;

export function bodyOf(body: Body): string {
  return /^\s*[{[]/.test(body) ? body : loadWebhookFixtureText(body as WebhookFixtureName);
}

export function signedPost(body: Body, secret = APP_SECRET): Request {
  const signed = signFixture(bodyOf(body), secret);
  return new Request(WEBHOOK_URL, { method: "POST", headers: signed.headers, body: signed.body });
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** A client with the fixture account (phone number id 100000000000001, tenant-a). */
export async function createHarness(options: ClientOptions = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(
    accountInput({ phoneNumberId: FIXTURE_IDS.phoneNumberId, wabaId: FIXTURE_IDS.wabaId }),
  );
  const messageEvents: MessageEvent[] = [];
  client.sendo.on("message", (e) => {
    messageEvents.push(e);
  });

  /** Posts a signed body, expects 200 and waits for the background work. Returns the stored event. */
  async function deliver(body: Body): Promise<SendoEvent> {
    const before = new Set(client.adapter.__state.events.keys());
    const tasks: Promise<unknown>[] = [];
    const response = await client.sendo.handleWebhook(signedPost(body), {
      waitUntil: (p) => tasks.push(p),
    });
    expect(response.status).toBe(200);
    await Promise.all(tasks);
    const event = [...client.adapter.__state.events.values()].find((e) => !before.has(e.id));
    if (!event) throw new Error("no event stored");
    return event;
  }

  function messages(direction?: "in" | "out") {
    return [...client.adapter.__state.messages.values()]
      .filter((m) => direction === undefined || m.direction === direction)
      .sort((a, b) => a.seq - b.seq);
  }

  return { ...client, account, messageEvents, deliver, messages };
}

/** JSON of the whole memory state, Maps and bytes included. */
export function dumpState(state: object): string {
  return JSON.stringify(state, (_key, value: unknown) => {
    if (value instanceof Map) return [...value.entries()];
    if (value instanceof Uint8Array) return Buffer.from(value).toString("latin1");
    return value;
  });
}

/** Everything an error exposes: message, toJSON, util.inspect (stack, props) and the cause chain. */
export function errorSurface(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 10; depth++) {
    parts.push(inspect(current, { depth: 20 }));
    if (current instanceof Error) {
      parts.push(current.message, current.stack ?? "");
      const toJSON = (current as { toJSON?: () => unknown }).toJSON;
      if (typeof toJSON === "function") parts.push(JSON.stringify(toJSON.call(current)));
      current = current.cause;
    } else {
      current = undefined;
    }
  }
  return parts.join("\n");
}
