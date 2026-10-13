import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { runAdapterContract } from "../contract";
import type { SendoAdapter } from "../types";
import { supabaseAdapter } from ".";
import { servicesRequired, supabaseAvailable } from "../../../test/support/services";

/**
 * Runs the adapter contract against a local Supabase (`pnpm supabase start && pnpm supabase db reset`).
 * - `SUPABASE_URL` (default `http://127.0.0.1:55321`)
 * - `SUPABASE_SERVICE_ROLE_KEY` (default: read from `supabase status -o env`)
 * - `SENDO_TEST_STORAGE_BUCKET` (default `sendo-media`, created by the sendo v1 migration)
 * Skips when Supabase is unreachable unless `SENDO_REQUIRE_SUPABASE=1`.
 */
const guard = await supabaseAvailable();
const SUPABASE_URL = guard.url;
const BUCKET = process.env.SENDO_TEST_STORAGE_BUCKET ?? "sendo-media";

const { serviceRoleKey, unavailable } = guard;

if (unavailable && servicesRequired) {
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
  snippetIds: new Set<string>(),
  tagIds: new Set<string>(),
  ruleIds: new Set<string>(),
};

function trackingAdapter(): SendoAdapter {
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
    snippets: {
      ...base.snippets,
      upsert: async (input) => {
        const snippet = await base.snippets.upsert(input);
        created.snippetIds.add(snippet.id);
        return snippet;
      },
    },
    tags: {
      ...base.tags,
      upsert: async (input) => {
        const tag = await base.tags.upsert(input);
        created.tagIds.add(tag.id);
        return tag;
      },
    },
    rules: {
      ...base.rules,
      upsert: async (input, opts) => {
        const result = await base.rules.upsert(input, opts);
        created.ruleIds.add(result.rule.id);
        return result;
      },
    },
  };
}

async function cleanup(): Promise<void> {
  const ids = (set: Set<string>) => [...set];
  // Accounts cascade to contacts, conversations, messages, media, templates and account-scoped
  // snippets and rules; tags cascade to conversation tags.
  const results = await Promise.all([
    created.accountIds.size
      ? client.from("sendo_accounts").delete().in("id", ids(created.accountIds))
      : null,
    created.placeholderMetaIds.size
      ? client
          .from("sendo_messages")
          .delete()
          .in("meta_message_id", ids(created.placeholderMetaIds))
      : null,
    created.eventIds.size
      ? client.from("sendo_events").delete().in("id", ids(created.eventIds))
      : null,
    created.lockKeys.size
      ? client.from("sendo_locks").delete().in("key", ids(created.lockKeys))
      : null,
    created.snippetIds.size
      ? client.from("sendo_snippets").delete().in("id", ids(created.snippetIds))
      : null,
    created.tagIds.size ? client.from("sendo_tags").delete().in("id", ids(created.tagIds)) : null,
    created.ruleIds.size
      ? client.from("sendo_rules").delete().in("id", ids(created.ruleIds))
      : null,
  ]);
  const failed = results.find((r) => r?.error);
  if (failed?.error) throw new Error(`cleanup failed: ${failed.error.message}`);
  for (const set of Object.values(created)) set.clear();
}

describe.skipIf(!guard.available)("supabase adapter", { meta: { skipReason: "supabase" } }, () => {
  runAdapterContract("supabase", trackingAdapter, {
    skip: unavailable ?? false,
    afterEach: unavailable ? undefined : cleanup,
  });
});
