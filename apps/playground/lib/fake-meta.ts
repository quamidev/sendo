import type { JsonObject } from "@quami/sendo";
import type { FakeWaba } from "@/fixtures/numbers";

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
  /**
   * Billing and token answers per WABA id (`fixtures/numbers/`). Unlisted WABAs have a
   * payment method and a valid token.
   */
  wabas?: Record<string, FakeWaba>;
}

/** Meta app and Embedded Signup configuration of the fake SDK (`public/fake-facebook-sdk.js`). */
export const FAKE_META_APP_ID = "playground-meta-app";
export const FAKE_META_CONFIG_ID = "playground-es-config";

/** Prefix of the business tokens the fake code exchange returns. */
export const FAKE_SIGNUP_TOKEN_PREFIX = "playground-es-token-";

/** Two-step PIN of fake Embedded Signup numbers whose id ends in `0000` (the PIN-retry case). */
export const FAKE_TWO_STEP_PIN = "123456";

function displayPhoneFor(phoneNumberId: string): string {
  if (phoneNumberId === "100000000000001") return "+1 555-000-1111";
  const digits = phoneNumberId.replace(/\D/g, "").padStart(7, "0");
  return `+1 555-${digits.slice(-7, -4)}-${digits.slice(-4)}`;
}

function metaError(status: number, code: number, message: string, subcode?: number): Response {
  return json(
    {
      error: {
        message,
        type: "OAuthException",
        code,
        ...(subcode === undefined ? {} : { error_subcode: subcode }),
        fbtrace_id: "FAKEPLAYGROUND",
      },
    },
    status,
  );
}

/**
 * A `fetch` that answers the Graph API calls sendo makes, without network:
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
    // Embedded Signup (fake FB SDK in public/fake-facebook-sdk.js): code exchange, subscribe, register.
    if (method === "GET" && last === "access_token") {
      const code = url.searchParams.get("code") ?? "";
      if (code.startsWith("expired")) {
        return metaError(400, 100, "This authorization code has expired.", 36007);
      }
      return json({ access_token: `${FAKE_SIGNUP_TOKEN_PREFIX}${code}`, token_type: "bearer" });
    }
    if (last === "subscribed_apps" && (method === "POST" || method === "DELETE")) {
      return json({ success: true });
    }
    if (method === "POST" && last === "register") {
      const body: unknown = init?.body === undefined ? null : JSON.parse(String(init.body));
      const pin =
        typeof body === "object" && body !== null && "pin" in body ? String(body.pin) : "";
      const phoneNumberId = segments.at(-2) ?? "";
      if (phoneNumberId.endsWith("0000") && pin !== FAKE_TWO_STEP_PIN) {
        return metaError(400, 133005, "Two step verification PIN Mismatch");
      }
      return json({ success: true });
    }
    // `refreshBilling`: GET /{waba}?fields=primary_funding_id
    if (method === "GET" && url.searchParams.get("fields")?.includes("primary_funding_id")) {
      const waba = options.wabas?.[last];
      const bearer = new Headers(init?.headers).get("authorization") ?? "";
      // Tokens from a (fake) Embedded Signup are valid; the seeded token of the WABA is revoked.
      if (waba?.tokenInvalid === true && !bearer.includes(FAKE_SIGNUP_TOKEN_PREFIX)) {
        return metaError(
          401,
          190,
          "Error validating access token: The session has been invalidated because the user changed their password.",
        );
      }
      if (waba?.funding === "unknown") return json({ name: "Playground WABA" });
      if (waba?.funding === "missing") return json({ id: last });
      return json({ id: last, primary_funding_id: `fake-funding-${last}` });
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
        display_phone_number: displayPhoneFor(last),
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
