// Supabase Vault reference implementation of the `storeToken` / `deleteToken` hooks that
// Embedded Signup needs (numbers). Server only: pass the service-role client from
// lib/sendo.ts. Needs supabase/migrations/20261012000000_numbers_vault_tokens.sql.
//
//   import { createVaultTokenStore } from "@/lib/sendo-token-store";
//   createSendo({ ...createVaultTokenStore(supabaseAdmin), ... })
//
// Single-tenant apps can skip Vault: keep the token in an env var and set the account's
// token_ref to the variable's name (see components/sendo/numbers/AGENTS.md).
import type { DeleteToken, StoreToken } from "@quami/sendo";
import type { SupabaseClient } from "@supabase/supabase-js";

/** `token_ref` prefix of tokens kept in Supabase Vault; `lib/sendo.ts` reads these from Vault. */
export const VAULT_TOKEN_PREFIX = "vault:";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Vault secret id of a `vault:<id>` ref; `null` for refs this store did not create. */
export function vaultSecretId(tokenRef: string): string | null {
  if (!tokenRef.startsWith(VAULT_TOKEN_PREFIX)) return null;
  const id = tokenRef.slice(VAULT_TOKEN_PREFIX.length);
  if (!UUID_RE.test(id)) throw new TypeError(`Malformed Vault token ref "${tokenRef}".`);
  return id;
}

export interface VaultTokenStore {
  storeToken: StoreToken;
  deleteToken: DeleteToken;
}

/**
 * `storeToken` saves the business token as a Vault secret and returns `vault:<secret id>`;
 * `deleteToken` deletes `vault:` secrets and ignores every other ref (`disconnect` also
 * passes env var names of manually added numbers). Errors carry the Postgres error code
 * only, never the token.
 */
export function createVaultTokenStore(supabase: SupabaseClient): VaultTokenStore {
  return {
    async storeToken({ account, token }) {
      const response = await supabase.rpc("sendo_vault_store_token", {
        token,
        token_name: `sendo_token_${account.phoneNumberId ?? "unknown"}_${String(Date.now())}`,
        token_description: `Sendo business token · tenant ${account.tenantId ?? "none"} · WABA ${account.wabaId ?? "unknown"}`,
      });
      const data: unknown = response.data;
      const error = response.error;
      if (error !== null || typeof data !== "string" || !UUID_RE.test(data)) {
        throw new Error(
          `[sendo] Could not store the token in Supabase Vault (${error?.code ?? "no secret id"}). Is the numbers_vault_tokens migration applied?`,
        );
      }
      return `${VAULT_TOKEN_PREFIX}${data}`;
    },
    async deleteToken(tokenRef) {
      const id = vaultSecretId(tokenRef);
      if (id === null) return;
      const { error } = await supabase.rpc("sendo_vault_delete_token", { secret_id: id });
      if (error !== null) {
        throw new Error(
          `[sendo] Could not delete Vault secret ${tokenRef} (${error.code}). Delete it in Supabase > Vault.`,
        );
      }
    },
  };
}
