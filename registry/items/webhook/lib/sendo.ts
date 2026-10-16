import { createSendo, type Account } from "@quami/sendo";
import { supabaseAdapter } from "@quami/sendo/adapters/supabase";
import { createClient } from "@supabase/supabase-js";
// After installing @sendo/numbers (Embedded Signup), uncomment:
// import { createVaultTokenStore } from "@/lib/sendo-token-store";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`[sendo] Missing environment variable ${name}. Add it to .env.local.`);
  }
  return value;
}

// Service-role client: server only, never import this file from client components.
const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const VAULT_PREFIX = "vault:";
const VAULT_CACHE_MS = 60_000;
const vaultCache = new Map<string, { token: string; expires: number }>();

/**
 * The access token of an account. `token_ref` is either the NAME of the env var holding it
 * (e.g. SENDO_TOKEN_MAIN, numbers added by hand) or `vault:<secret id>` for numbers connected
 * with Embedded Signup (numbers stores those in Supabase Vault). Vault reads are cached
 * in memory for a minute; the token is never logged or put in an error.
 */
async function resolveAccountToken(account: Account): Promise<string> {
  if (account.tokenRef.startsWith(VAULT_PREFIX)) {
    const cached = vaultCache.get(account.tokenRef);
    if (cached !== undefined && cached.expires > Date.now()) return cached.token;
    const response = await supabaseAdmin.rpc("sendo_vault_read_token", {
      secret_id: account.tokenRef.slice(VAULT_PREFIX.length),
    });
    const data: unknown = response.data;
    const error = response.error;
    if (error !== null || typeof data !== "string" || data === "") {
      vaultCache.delete(account.tokenRef);
      throw new Error(
        `[sendo] Could not read the access token of account ${account.phoneNumberId ?? account.id} from Supabase Vault (${account.tokenRef}${error === null ? "" : `, ${error.code}`}).`,
      );
    }
    vaultCache.set(account.tokenRef, { token: data, expires: Date.now() + VAULT_CACHE_MS });
    return data;
  }
  const token = process.env[account.tokenRef];
  if (token === undefined || token === "") {
    throw new Error(
      `[sendo] Missing access token for account ${account.phoneNumberId ?? account.id}: set the ${account.tokenRef} environment variable.`,
    );
  }
  return token;
}

export const sendo = createSendo({
  adapter: supabaseAdapter(supabaseAdmin, {
    storageBucket: process.env.SENDO_STORAGE_BUCKET ?? "sendo-media",
  }),
  appSecret: requireEnv("SENDO_META_APP_SECRET"),
  verifyToken: requireEnv("SENDO_VERIFY_TOKEN"),
  resolveToken: resolveAccountToken,
  // Embedded Signup (@sendo/numbers): uncomment after installing it and applying its
  // migration. Tokens go to Supabase Vault; the code exchange uses your Meta app.
  // ...createVaultTokenStore(supabaseAdmin),
  // meta: {
  //   appId: process.env.NEXT_PUBLIC_SENDO_META_APP_ID,
  //   configId: process.env.SENDO_META_CONFIG_ID ?? process.env.NEXT_PUBLIC_SENDO_META_CONFIG_ID,
  // },
  // Sendo Connect (Quami's Meta app instead of your own; https://sendo.quami.dev/docs/sendo-connect):
  // delete the `appSecret` line above and uncomment this. Webhooks then arrive through the Connect
  // relay signed with X-Sendo-Signature (Meta's own signature is no longer accepted), Embedded
  // Signup completes through Connect, and sending still goes straight to Meta. Set `meta.appId` /
  // `configId` above to Quami's values from the Connect panel.
  // connect: {
  //   apiKey: requireEnv("SENDO_CONNECT_API_KEY"),
  //   signingSecret: requireEnv("SENDO_CONNECT_SIGNING_SECRET"),
  // },
  // TODO: the user's role in a tenant ("agent" | "supervisor" | "admin"), or null for no access.
  // The numbers screen requires "admin" to change numbers (sendo.actor fails closed without this).
  // resolveRole: async ({ userId, tenantId }) => {
  //   const role = await findMemberRole(userId, tenantId);
  //   return role === null ? null : { role };
  // },
  // TODO: link the contact to your app's own entity. Receives { phone (E.164), account, contact };
  // return its id (e.g. await findPatientIdByPhone(phone, account.tenantId)) or null.
  linkContact: () => null,
  // TODO: who receives a handed-off conversation. Receives { to, account, conversation, contact };
  // return user ids (e.g. await listAdminIds(account.tenantId)). Exactly one id auto-assigns.
  resolveHandoffTargets: () => [],
  agentDefaults: { historyLimit: 20, maxStepsPerTurn: 5, maxMessagesPerMinutePerContact: 10 },
  eventRetentionDays: 30,
  logger: console,
});

// Example agent. Uncomment and adapt (requires `zod`):
//
// import { z } from "zod";
//
// sendo.agent({
//   name: "recepcion",
//   model: requireEnv("SENDO_AGENT_MODEL"),
//   instructions: "Eres la recepcionista de la clínica. Responde breve y en español.",
//   tools: {
//     horarios: {
//       description: "Horarios de atención",
//       input: z.object({}),
//       run: async () => ({ lunesAViernes: "08:00-17:00", sabado: "08:00-12:00" }),
//     },
//   },
//   handoff: { when: "El paciente pide hablar con una persona", to: "recepcion" },
// });
