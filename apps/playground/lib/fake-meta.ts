import type { JsonObject } from "@quami/wa-li";

/** 1x1 transparent PNG served as downloaded media. */
const PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

const FAKE_MEDIA_HOST = "https://fake-meta.playground.local";

function json(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface FakeMetaOptions {
  /** Raw Meta templates returned by `GET /{waba}/message_templates`. */
  templates?: JsonObject[];
}

/**
 * A `fetch` that answers the Graph API calls wa-li makes, without network:
 * sends get `wamid.PLAYGROUND…` ids, media downloads return a 1x1 PNG.
 */
export function createFakeMetaFetch(options: FakeMetaOptions = {}): typeof fetch {
  let sequence = 0;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments.at(-1) ?? "";

    if (url.origin === FAKE_MEDIA_HOST) {
      return new Response(PIXEL_PNG, { headers: { "content-type": "image/png" } });
    }
    if (method === "POST" && last === "messages") {
      sequence += 1;
      const id = `wamid.PLAYGROUND${String(Date.now())}${String(sequence).padStart(4, "0")}`;
      return json({ messaging_product: "whatsapp", messages: [{ id }] });
    }
    if (method === "POST" && last === "media") {
      sequence += 1;
      return json({ id: `fake-media-${String(sequence)}` });
    }
    if (method === "GET" && last === "message_templates") {
      return json({ data: options.templates ?? [] });
    }
    if (method === "GET" && last === "subscribed_apps") {
      return json({ data: [{ whatsapp_business_api_data: { id: "1", name: "Playground" } }] });
    }
    if (method === "GET" && segments.length === 2 && url.searchParams.has("fields")) {
      return json({
        id: last,
        display_phone_number: "+1 555-000-1111",
        verified_name: "Playground",
        quality_rating: "GREEN",
        code_verification_status: "VERIFIED",
        name_status: "APPROVED",
        platform_type: "CLOUD_API",
        throughput: { level: "STANDARD" },
      });
    }
    if (method === "GET" && segments.length === 2) {
      return json({
        id: last,
        url: `${FAKE_MEDIA_HOST}/media/${last}`,
        mime_type: "image/png",
        sha256: "playground",
        file_size: PIXEL_PNG.byteLength,
        messaging_product: "whatsapp",
      });
    }
    return json(
      {
        error: {
          message: `Fake Meta: unsupported ${method} ${url.pathname}`,
          type: "OAuthException",
          code: 100,
        },
      },
      400,
    );
  };
}
