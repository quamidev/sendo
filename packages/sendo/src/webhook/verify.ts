import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i;

function hmacSha256(rawBody: string | Uint8Array, appSecret: string): Buffer {
  return createHmac("sha256", appSecret).update(rawBody).digest();
}

/** Constant-time string comparison that does not leak the length of either value. */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB) && a.length === b.length;
}

/** Returns the `X-Hub-Signature-256` value Meta would send for `rawBody`. */
export function signBody(rawBody: string | Uint8Array, appSecret: string): string {
  return `sha256=${hmacSha256(rawBody, appSecret).toString("hex")}`;
}

/** Checks Meta's `X-Hub-Signature-256` header against the raw request body. */
export function verifySignature(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const match = SIGNATURE_PATTERN.exec(header.trim());
  const hex = match?.[1];
  if (!hex) return false;
  const received = Buffer.from(hex, "hex");
  const expected = hmacSha256(rawBody, appSecret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Handles Meta's GET subscription handshake: 200 with `hub.challenge`, otherwise 403. */
export function verifyChallenge(url: URL, verifyToken: string): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const tokenMatches = token !== null && verifyToken !== "" && safeEqual(token, verifyToken);
  if (mode === "subscribe" && tokenMatches && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response("Forbidden", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
