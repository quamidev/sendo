import { createHmac, randomBytes } from "node:crypto";
import { metaDirect, type MetaDirectTransport } from "@quami/sendo";

// The demo never talks to Meta: `fakeMeta` is the real meta-direct transport with a `fetch`
// that answers the Graph API calls Sendo makes, and webhooks are signed here with a
// per-process secret.

const APP_SECRET = randomBytes(32).toString("hex");
const VERIFY_TOKEN = randomBytes(16).toString("hex");

/** Phone number id and WABA of the demo building's WhatsApp number. */
export const DEMO_PHONE_NUMBER_ID = "100000000000777";
export const DEMO_WABA_ID = "200000000000777";
export const DEMO_DISPLAY_PHONE = "+502 2200 7777";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFakeMetaFetch(): typeof fetch {
  let sequence = 0;
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const last = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    if (method === "POST" && last === "messages") {
      const body = typeof init?.body === "string" ? init.body : "";
      // Read receipts (`status: "read"`) and sends share the endpoint.
      if (body.includes('"status":"read"')) return Promise.resolve(json({ success: true }));
      sequence += 1;
      const id = `wamid.DEMO${String(Date.now())}${String(sequence).padStart(4, "0")}`;
      return Promise.resolve(json({ messaging_product: "whatsapp", messages: [{ id }] }));
    }
    if (method === "GET" && last === "message_templates")
      return Promise.resolve(json({ data: [] }));
    return Promise.resolve(
      json({ error: { message: "Not available in the Sendo demo", code: 100 } }, 404),
    );
  };
}

export function createFakeMetaTransport(): MetaDirectTransport {
  return metaDirect({
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    resolveToken: () => "demo-access-token",
    fetch: createFakeMetaFetch(),
  });
}

/** A text message from `waId`, as Meta would deliver it, signed for `sendo.handleWebhook`. */
export function signedTextWebhook(input: {
  waId: string;
  profileName: string;
  metaMessageId: string;
  body: string;
  at: Date;
}): Request {
  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: DEMO_WABA_ID,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: DEMO_DISPLAY_PHONE.replace(/\D/g, ""),
                phone_number_id: DEMO_PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: input.profileName }, wa_id: input.waId }],
              messages: [
                {
                  from: input.waId,
                  id: input.metaMessageId,
                  timestamp: String(Math.floor(input.at.getTime() / 1000)),
                  type: "text",
                  text: { body: input.body },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = createHmac("sha256", APP_SECRET).update(payload, "utf8").digest("hex");
  return new Request("https://sendo.dev/api/sendo/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` },
    body: payload,
  });
}
