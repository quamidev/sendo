import { createWhatsApp } from "@quami/wa-li";
import { supabaseAdapter } from "@quami/wa-li/adapters/supabase";
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`[wa-li] Missing environment variable ${name}. Add it to .env.local.`);
  }
  return value;
}

// Service-role client: server only, never import this file from client components.
const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const wa = createWhatsApp({
  adapter: supabaseAdapter(supabaseAdmin, {
    storageBucket: process.env.WA_STORAGE_BUCKET ?? "whatsapp-media",
  }),
  appSecret: requireEnv("WA_APP_SECRET"),
  verifyToken: requireEnv("WA_VERIFY_TOKEN"),
  // Each wa_accounts row stores the NAME of the env var holding its access token (e.g. WA_TOKEN_MAIN).
  resolveToken: (account) => {
    const token = process.env[account.tokenRef];
    if (token === undefined || token === "") {
      throw new Error(
        `[wa-li] Missing access token for account ${account.phoneNumberId}: set the ${account.tokenRef} environment variable.`,
      );
    }
    return token;
  },
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
// wa.agent({
//   name: "recepcion",
//   model: requireEnv("WA_AGENT_MODEL"),
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
