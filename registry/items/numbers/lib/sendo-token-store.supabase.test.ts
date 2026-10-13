/**
 * Security boundary: the Supabase Vault token store (`lib/sendo-token-store.ts` + the
 * `numbers_vault_tokens` migration) against local Supabase. Ways it could fail:
 *
 * [VT-1] `storeToken` returns a ref that leaks the token, or a ref `lib/sendo.ts` can't read
 *        back through `sendo_vault_read_token` with the service role.
 * [VT-2] A browser role (`anon`, or a signed-in `authenticated` user) can store, read or
 *        delete tokens through the RPC functions.
 * [VT-3] `deleteToken` leaves the secret readable, touches Vault for refs it didn't create
 *        (env var names `disconnect` also passes), or silently accepts a malformed `vault:` ref.
 *
 * Needs `pnpm supabase start` with the migration applied (`pnpm supabase db reset`, or run
 * `registry/items/numbers/supabase/migrations/20261012000000_numbers_vault_tokens.sql`).
 * Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (defaults read from
 * `supabase status -o env`). Skips when Supabase is unreachable unless `SENDO_REQUIRE_SUPABASE=1`.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { createVaultTokenStore, VAULT_TOKEN_PREFIX } from "./sendo-token-store";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "http://127.0.0.1:55321").replace(/\/+$/, "");
const REQUIRED = process.env.SENDO_REQUIRE_SUPABASE === "1";
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

async function isReachable(url: string): Promise<boolean> {
  try {
    await fetch(`${url}/rest/v1/`, { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

async function readKeys(): Promise<{ service: string | null; anon: string | null }> {
  let service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  let anon = process.env.SUPABASE_ANON_KEY ?? null;
  if (service !== null && anon !== null) return { service, anon };
  try {
    const { stdout } = await promisify(execFile)(
      "npx",
      ["pnpm@10.34.6", "supabase", "status", "-o", "env"],
      { cwd: REPO_ROOT, timeout: 20_000 },
    );
    const read = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(stdout)?.[1];
    service ??= read("SERVICE_ROLE_KEY") ?? read("SECRET_KEY") ?? null;
    anon ??= read("ANON_KEY") ?? read("PUBLISHABLE_KEY") ?? null;
  } catch {
    // reported as unavailable below
  }
  return { service, anon };
}

const reachable = await isReachable(SUPABASE_URL);
const keys = reachable ? await readKeys() : { service: null, anon: null };
const admin: SupabaseClient | null =
  keys.service === null ? null : createClient(SUPABASE_URL, keys.service, clientOptions);
const migrated =
  admin !== null &&
  (await admin.rpc("sendo_vault_read_token", { secret_id: crypto.randomUUID() })).error === null;
const unavailable = !reachable
  ? "Supabase unreachable"
  : keys.service === null || keys.anon === null
    ? "SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY not found"
    : !migrated
      ? "the numbers_vault_tokens migration is not applied"
      : null;

if (unavailable !== null && REQUIRED) {
  describe("vault token store prerequisites", () => {
    it("has a reachable local Supabase with the numbers_vault_tokens migration", () => {
      expect.fail(
        `${unavailable} at ${SUPABASE_URL}. Run \`pnpm supabase start && pnpm supabase db reset\`.`,
      );
    });
  });
}

// Each test makes several round trips to Supabase (auth admin, sign-in, RPCs); 5 s is too tight
// when the other workspaces run their suites at the same time.
describe.skipIf(unavailable !== null)(
  "numbers: Supabase Vault token store",
  { timeout: 30_000 },
  () => {
    const service = admin ?? createClient(SUPABASE_URL, "missing", clientOptions);
    const store = createVaultTokenStore(service);
    const account = {
      tenantId: crypto.randomUUID(),
      phoneNumberId: "PN-VAULT-TEST",
      wabaId: "WABA-VAULT",
    };
    const refs: string[] = [];
    const userIds: string[] = [];

    async function read(ref: string): Promise<unknown> {
      const response = await service.rpc("sendo_vault_read_token", {
        secret_id: ref.slice(VAULT_TOKEN_PREFIX.length),
      });
      if (response.error !== null) throw new Error(response.error.message);
      const data: unknown = response.data;
      return data;
    }

    afterAll(async () => {
      for (const ref of refs) await store.deleteToken(ref).catch(() => undefined);
      for (const id of userIds) await service.auth.admin.deleteUser(id).catch(() => undefined);
    });

    it("[VT-1] stores the token under an opaque vault: ref that the service role reads back", async () => {
      const token = `EAAG-test-${crypto.randomUUID()}`;
      const ref = await store.storeToken({ account, token });
      refs.push(ref);
      expect(ref).toMatch(/^vault:[0-9a-f-]{36}$/);
      expect(ref).not.toContain(token);
      expect(await read(ref)).toBe(token);
    });

    it("[VT-2] browser roles can't store, read or delete tokens", async () => {
      const token = `EAAG-test-${crypto.randomUUID()}`;
      const ref = await store.storeToken({ account, token });
      refs.push(ref);
      const secretId = ref.slice(VAULT_TOKEN_PREFIX.length);

      const anon = createClient(SUPABASE_URL, keys.anon ?? "missing", clientOptions);
      const email = `vault-${crypto.randomUUID()}@sendo.test`;
      const created = await service.auth.admin.createUser({
        email,
        password: "sendo-vault-test-password",
        email_confirm: true,
      });
      if (created.error !== null) throw created.error;
      userIds.push(created.data.user.id);
      const member = createClient(SUPABASE_URL, keys.anon ?? "missing", clientOptions);
      const signIn = await member.auth.signInWithPassword({
        email,
        password: "sendo-vault-test-password",
      });
      if (signIn.error !== null) throw signIn.error;

      for (const client of [anon, member]) {
        const reading = await client.rpc("sendo_vault_read_token", { secret_id: secretId });
        expect(reading.error?.code).toBe("42501");
        expect(reading.data).toBeNull();
        const storing = await client.rpc("sendo_vault_store_token", { token: "stolen" });
        expect(storing.error?.code).toBe("42501");
        const deleting = await client.rpc("sendo_vault_delete_token", { secret_id: secretId });
        expect(deleting.error?.code).toBe("42501");
      }
      expect(await read(ref)).toBe(token);
    });

    it("[VT-3] deletes vault secrets, ignores refs it did not create and rejects malformed ones", async () => {
      const ref = await store.storeToken({ account, token: `EAAG-test-${crypto.randomUUID()}` });
      await store.deleteToken(ref);
      expect(await read(ref)).toBeNull();
      await expect(store.deleteToken(ref)).resolves.toBeUndefined();

      let calls = 0;
      const spy = createVaultTokenStore(
        new Proxy(service, {
          get(target, key, receiver) {
            if (key === "rpc") calls += 1;
            return Reflect.get(target, key, receiver) as unknown;
          },
        }),
      );
      await spy.deleteToken("SENDO_TOKEN_MAIN");
      await spy.deleteToken("playground:123");
      expect(calls).toBe(0);
      await expect(spy.deleteToken("vault:not-a-uuid")).rejects.toThrow(
        /Malformed Vault token ref/,
      );
    });
  },
);
