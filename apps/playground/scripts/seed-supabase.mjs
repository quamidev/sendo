#!/usr/bin/env node
// Seeds the root local Supabase for the playground (Supabase mode):
// - dev user dev@playground.local / playground, app_metadata.tenant_id = playground tenant
// - sendo_accounts row for phone_number_id 100000000000001 (matches the webhook fixtures)
// - two approved templates (fixtures/templates.json)
// Idempotent. Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY,
// read from the environment or apps/playground/.env.local. Run after `pnpm supabase db reset`.
// Keep the ids in sync with lib/playground-env.ts.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseAdapter } from "@quami/sendo/adapters/supabase";
import { createClient } from "@supabase/supabase-js";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const TENANT_ID = "00000000-0000-4000-8000-00000000a001";
const DEV_USER = {
  id: "00000000-0000-4000-8000-00000000d001",
  email: "dev@playground.local",
  password: "playground",
};
const ACCOUNT = {
  phoneNumberId: "100000000000001",
  wabaId: "200000000000001",
  displayPhone: "15550001111",
  tokenRef: "SENDO_TOKEN_MAIN",
};

for (const file of [".env.local", ".env"]) {
  const path = join(appDir, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !process.env[match[1]] && match[2] !== "") process.env[match[1]] = match[2];
  }
}

const url =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  console.error(
    "Set SUPABASE_SERVICE_ROLE_KEY (see `pnpm supabase status -o env` at the repo root).",
  );
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function seedUser() {
  const attributes = {
    email: DEV_USER.email,
    password: DEV_USER.password,
    email_confirm: true,
    app_metadata: { tenant_id: TENANT_ID },
  };
  const existing = await admin.auth.admin.getUserById(DEV_USER.id);
  if (existing.data.user) {
    const { error } = await admin.auth.admin.updateUserById(DEV_USER.id, attributes);
    if (error) throw error;
    return "updated";
  }
  const { error } = await admin.auth.admin.createUser({ id: DEV_USER.id, ...attributes });
  if (error) throw error;
  return "created";
}

async function main() {
  console.log(`Dev user ${DEV_USER.email}: ${await seedUser()}`);

  const adapter = supabaseAdapter(admin, {
    storageBucket: process.env.SENDO_STORAGE_BUCKET || "sendo-media",
  });
  const account =
    (await adapter.accounts.getByPhoneNumberId(ACCOUNT.phoneNumberId)) ??
    (await adapter.accounts.insert({ tenantId: TENANT_ID, ...ACCOUNT }));
  console.log(
    `Account ${account.phoneNumberId} (${account.id}), tenant ${String(account.tenantId)}`,
  );

  const templates = JSON.parse(readFileSync(join(appDir, "fixtures/templates.json"), "utf8"));
  const saved = await adapter.templates.upsertMany(account.id, templates);
  console.log(`Templates: ${saved.map((t) => `${t.name}/${t.language}`).join(", ")}`);
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
