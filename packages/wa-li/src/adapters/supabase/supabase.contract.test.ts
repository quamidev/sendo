import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runAdapterContract } from "../contract";
import type { WhatsAppAdapter } from "../types";
import { supabaseAdapter } from ".";

/**
 * Runs the adapter contract against a local Supabase (`pnpm supabase start && pnpm supabase db reset`).
 * - `SUPABASE_URL` (default `http://127.0.0.1:55321`)
 * - `SUPABASE_SERVICE_ROLE_KEY` (default: read from `supabase status -o env`)
 * - `WA_LI_STORAGE_BUCKET` (default `whatsapp-media`, created by `supabase/seed.sql`)
 * Skips when Supabase is unreachable unless `WA_LI_REQUIRE_SUPABASE=1`.
 */
const SUPABASE_URL = (process.env.SUPABASE_URL ?? "http://127.0.0.1:55321").replace(/\/+$/, "");
const BUCKET = process.env.WA_LI_STORAGE_BUCKET ?? "whatsapp-media";
const REQUIRED = process.env.WA_LI_REQUIRE_SUPABASE === "1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function readServiceRoleKey(): Promise<string | null> {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (fromEnv) return fromEnv;
  try {
    const { stdout } = await promisify(execFile)(
      "npx",
      ["pnpm@10.34.6", "supabase", "status", "-o", "env"],
      { cwd: REPO_ROOT, timeout: 20_000 },
    );
    const read = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(stdout)?.[1];
    return read("SERVICE_ROLE_KEY") ?? read("SECRET_KEY") ?? null;
  } catch {
    return null;
  }
}

const reachable = await isReachable(SUPABASE_URL);
const serviceRoleKey = reachable ? await readServiceRoleKey() : null;
const unavailable = !reachable
  ? "Supabase unreachable"
  : !serviceRoleKey
    ? "SUPABASE_SERVICE_ROLE_KEY not set"
    : null;

if (unavailable && REQUIRED) {
  describe("supabase adapter prerequisites", () => {
    it("has a reachable local Supabase with a service role key", () => {
      expect.fail(
        `${unavailable} at ${SUPABASE_URL}. Run \`pnpm supabase start && pnpm supabase db reset\` ` +
          "or set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
      );
    });
  });
}

const client = createClient(SUPABASE_URL, serviceRoleKey ?? "missing-key", {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Cleanup is scoped to rows this suite created, tracked through a thin adapter wrapper, so it can
 * run in parallel with other Supabase-backed files (the parity test) that share the database.
 */
const created = {
  accountIds: new Set<string>(),
  eventIds: new Set<string>(),
  placeholderMetaIds: new Set<string>(),
  lockKeys: new Set<string>(),
};

function trackingAdapter(): WhatsAppAdapter {
  const base = supabaseAdapter(client, { storageBucket: BUCKET });
  return {
    ...base,
    accounts: {
      ...base.accounts,
      insert: async (input) => {
        const account = await base.accounts.insert(input);
        created.accountIds.add(account.id);
        return account;
      },
    },
    events: {
      ...base.events,
      insert: async (input) => {
        const event = await base.events.insert(input);
        created.eventIds.add(event.id);
        return event;
      },
    },
    messages: {
      ...base.messages,
      updateStatus: async (metaId, status, opts) => {
        const result = await base.messages.updateStatus(metaId, status, opts);
        if (result === "placeholder") created.placeholderMetaIds.add(metaId);
        return result;
      },
    },
    locks: {
      ...base.locks,
      acquire: async (key, ttlMs) => {
        created.lockKeys.add(key);
        return base.locks.acquire(key, ttlMs);
      },
    },
  };
}

async function cleanup(): Promise<void> {
  const ids = (set: Set<string>) => [...set];
  // Accounts cascade to contacts, conversations, messages, media and templates.
  const results = await Promise.all([
    created.accountIds.size
      ? client.from("wa_accounts").delete().in("id", ids(created.accountIds))
      : null,
    created.placeholderMetaIds.size
      ? client.from("wa_messages").delete().in("meta_message_id", ids(created.placeholderMetaIds))
      : null,
    created.eventIds.size
      ? client.from("wa_events").delete().in("id", ids(created.eventIds))
      : null,
    created.lockKeys.size
      ? client.from("wa_locks").delete().in("key", ids(created.lockKeys))
      : null,
  ]);
  const failed = results.find((r) => r?.error);
  if (failed?.error) throw new Error(`cleanup failed: ${failed.error.message}`);
  for (const set of Object.values(created)) set.clear();
}

runAdapterContract("supabase", trackingAdapter, {
  skip: unavailable ?? false,
  afterEach: unavailable ? undefined : cleanup,
});
