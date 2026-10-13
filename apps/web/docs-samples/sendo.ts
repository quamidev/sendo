// #region config
import { createSendo } from "@quami/sendo";
import { supabaseAdapter } from "@quami/sendo/adapters/supabase";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

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

export const sendo = createSendo({
  adapter: supabaseAdapter(supabaseAdmin, {
    storageBucket: process.env.SENDO_STORAGE_BUCKET ?? "sendo-media",
  }),
  appSecret: requireEnv("SENDO_META_APP_SECRET"),
  verifyToken: requireEnv("SENDO_VERIFY_TOKEN"),
  // sendo_accounts.token_ref holds the NAME of the env var with the token (e.g. SENDO_TOKEN_MAIN).
  resolveToken: (account) => process.env[account.tokenRef],
  // findPatientIdByPhone / listAdminIds stand for your own queries.
  // Your entity id for this phone number (patient, resident, user), or null.
  linkContact: async ({ phone, account }) => findPatientIdByPhone(phone, account.tenantId),
  // Who gets a handed-off conversation. Exactly one id auto-assigns it.
  resolveHandoffTargets: async ({ account }) => listAdminIds(account.tenantId),
  agentDefaults: { historyLimit: 20, maxStepsPerTurn: 5, maxMessagesPerMinutePerContact: 10 },
  eventRetentionDays: 30,
  logger: console,
});
// #endregion config

// #region agent
sendo.agent({
  name: "recepcion",
  model: requireEnv("SENDO_AGENT_MODEL"), // e.g. "openai/gpt-5-mini" via the AI Gateway
  instructions: "Eres la recepcionista de la clínica. Responde breve y en español.",
  tools: {
    horarios: {
      description: "Horarios de atención de la clínica",
      input: z.object({}),
      run: async () => ({ lunesAViernes: "08:00-17:00", sabado: "08:00-12:00" }),
    },
  },
  handoff: { when: "El paciente pide hablar con una persona", to: "recepcion" },
  fallbackMessage: "Tuvimos un problema. Una persona del equipo te responderá pronto.",
});
// #endregion agent

// App-side helpers used above (replace with your own queries).
async function findPatientIdByPhone(_phone: string, _tenantId: string | null) {
  return null as string | null;
}
async function listAdminIds(_tenantId: string | null): Promise<string[]> {
  return [];
}
