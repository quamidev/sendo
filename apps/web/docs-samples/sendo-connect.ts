import { createSendo, signConnectBody, type StoreToken } from "@quami/sendo";
import { memoryAdapter } from "@quami/sendo/adapters/memory";

const storeToken: StoreToken = async ({ token }) => `vault:${await saveSecret(token)}`;

// #region config
export const sendo = createSendo({
  adapter: memoryAdapter(), // your adapter
  // No appSecret: with `connect`, webhooks are verified with X-Sendo-Signature only.
  verifyToken: process.env.SENDO_VERIFY_TOKEN ?? "",
  resolveToken: (account) => readSecret(account.tokenRef),
  storeToken, // Embedded Signup tokens still go to your secret store
  connect: {
    apiKey: process.env.SENDO_CONNECT_API_KEY ?? "",
    signingSecret: process.env.SENDO_CONNECT_SIGNING_SECRET ?? "",
  },
});
// #endregion config

// #region local-test
// Sign a body the way the relay does, to try your webhook route locally.
export function relayHeaders(rawBody: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-sendo-signature": signConnectBody(rawBody, process.env.SENDO_CONNECT_SIGNING_SECRET ?? ""),
  };
}
// #endregion local-test

// Your secret store (Supabase Vault, AWS Secrets Manager...).
async function saveSecret(_value: string): Promise<string> {
  return "secret-id";
}
async function readSecret(_ref: string): Promise<string> {
  return "";
}
