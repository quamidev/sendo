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

/** Header the Sendo Connect relay signs every forwarded webhook with. */
export const CONNECT_SIGNATURE_HEADER = "x-sendo-signature";

/** How far (seconds, either direction) a Connect signature timestamp may be from now. */
export const CONNECT_SIGNATURE_TOLERANCE_SEC = 300;

const CONNECT_TIMESTAMP_PATTERN = /^\d{1,12}$/;
const CONNECT_V1_PATTERN = /^[0-9a-f]{64}$/i;

function connectHmac(
  rawBody: string | Uint8Array,
  signingSecret: string,
  timestamp: string,
): Buffer {
  return createHmac("sha256", signingSecret).update(`${timestamp}.`).update(rawBody).digest();
}

/**
 * The `X-Sendo-Signature` value the Connect relay sends for `rawBody`:
 * `t=<unix seconds>,v1=<hex hmac_sha256(signingSecret, t + "." + rawBody)>`.
 */
export function signConnectBody(
  rawBody: string | Uint8Array,
  signingSecret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const t = String(Math.floor(timestamp));
  return `t=${t},v1=${connectHmac(rawBody, signingSecret, t).toString("hex")}`;
}

/**
 * Checks a Sendo Connect `X-Sendo-Signature` header against the raw body: one `t`, at least one
 * `v1` (any may match, for secret rotation), `t` within `toleranceSec` of `now` (ms, default
 * `Date.now()`), constant-time compare. Anything else (missing, malformed, stale) is `false`.
 */
export function verifyConnectSignature(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  signingSecret: string,
  opts: { now?: number; toleranceSec?: number } = {},
): boolean {
  if (!header || !signingSecret) return false;
  let timestamp: string | null = null;
  const received: Buffer[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return false;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (timestamp !== null) return false;
      timestamp = value;
    } else if (key === "v1" && CONNECT_V1_PATTERN.test(value)) {
      received.push(Buffer.from(value, "hex"));
    }
  }
  if (timestamp === null || !CONNECT_TIMESTAMP_PATTERN.test(timestamp) || received.length === 0) {
    return false;
  }
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  const tolerance = opts.toleranceSec ?? CONNECT_SIGNATURE_TOLERANCE_SEC;
  if (Math.abs(nowSec - Number(timestamp)) > tolerance) return false;
  const expected = connectHmac(rawBody, signingSecret, timestamp);
  let match = false;
  for (const candidate of received) {
    if (timingSafeEqual(candidate, expected)) match = true;
  }
  return match;
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
