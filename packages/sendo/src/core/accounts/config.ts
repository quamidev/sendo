import { ConfigError } from "../../errors/errors";
import type { Account } from "../../types/entities";

export interface StoreTokenInput {
  account: Pick<Account, "tenantId" | "phoneNumberId" | "wabaId">;
  /** The business token from Embedded Signup. Store it; never log it. */
  token: string;
}

/** Stores an Embedded Signup token and returns the `tokenRef` saved on the account. */
export type StoreToken = (input: StoreTokenInput) => Promise<string>;

/**
 * Deletes a stored token. Called by `disconnect` with every account's `tokenRef`, including
 * refs this hook did not create (e.g. env var names of manual accounts): ignore those.
 */
export type DeleteToken = (tokenRef: string) => Promise<void>;

export interface MetaAppConfig {
  /** Meta app id (Embedded Signup code exchange). */
  appId?: string;
  /** Embedded Signup configuration id. */
  configId?: string;
}

export interface CoexistenceConfig {
  /** Pause the agent on a conversation when the owner replies from the phone. Default `true`. */
  pauseAgentOnPhoneReply?: boolean;
  /** Store `history` webhooks as imported messages. Default `false`. */
  importHistory?: boolean;
}

/** Account and onboarding keys of `SendoConfig` (`SendoConfigBase` extends this). */
export interface AccountsConfig {
  storeToken?: StoreToken;
  deleteToken?: DeleteToken;
  meta?: MetaAppConfig;
  coexistence?: CoexistenceConfig;
}

export interface ResolvedAccountsConfig {
  storeToken: StoreToken | null;
  deleteToken: DeleteToken | null;
  meta: { appId: string | null; configId: string | null };
  coexistence: { pauseAgentOnPhoneReply: boolean; importHistory: boolean };
}

function optionalFunction<T>(name: string, value: T | undefined): T | null {
  if (value === undefined) return null;
  if (typeof value !== "function") {
    throw new ConfigError(`createSendo: \`${name}\` must be a function.`);
  }
  return value;
}

function optionalString(name: string, value: string | undefined): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`createSendo: \`${name}\` must be a non-empty string.`);
  }
  return value.trim();
}

function optionalBoolean(name: string, value: boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean")
    throw new ConfigError(`createSendo: \`${name}\` must be a boolean.`);
  return value;
}

/** Throws `ConfigError` on invalid account keys. */
export function resolveAccountsConfig(config: AccountsConfig): ResolvedAccountsConfig {
  const meta = config.meta ?? {};
  const coexistence = config.coexistence ?? {};
  return {
    storeToken: optionalFunction("storeToken", config.storeToken),
    deleteToken: optionalFunction("deleteToken", config.deleteToken),
    meta: {
      appId: optionalString("meta.appId", meta.appId),
      configId: optionalString("meta.configId", meta.configId),
    },
    coexistence: {
      pauseAgentOnPhoneReply: optionalBoolean(
        "coexistence.pauseAgentOnPhoneReply",
        coexistence.pauseAgentOnPhoneReply,
        true,
      ),
      importHistory: optionalBoolean("coexistence.importHistory", coexistence.importHistory, false),
    },
  };
}
