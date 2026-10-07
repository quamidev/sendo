import { createHmac } from "node:crypto";

/**
 * Test and replay helpers for signing webhook bodies the way Meta does.
 * Dependency-free (node:crypto only) so the playground replay script can copy or import it.
 */

export const SIGNATURE_HEADER = "x-hub-signature-256";

export interface SignedFixture {
  body: string;
  headers: { "x-hub-signature-256": string; "content-type": "application/json" };
}

export function signFixture(body: string | object, secret: string): SignedFixture {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return {
    body: raw,
    headers: { "x-hub-signature-256": signature, "content-type": "application/json" },
  };
}
