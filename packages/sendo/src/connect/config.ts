import { ConfigError } from "../errors/errors";

/** Where the Sendo Connect API lives unless `connect.baseUrl` says otherwise. */
export const DEFAULT_CONNECT_BASE_URL = "https://connect.sendo.dev";

/** Sendo Connect credentials, from the Connect panel. */
export interface ConnectOptions {
  /** `SENDO_CONNECT_API_KEY`: authenticates signup and doctor calls to Connect. Never logged. */
  apiKey: string;
  /** `SENDO_CONNECT_SIGNING_SECRET`: verifies `X-Sendo-Signature` on relayed webhooks. Never logged. */
  signingSecret: string;
  /** Default `https://connect.sendo.dev`. */
  baseUrl?: string;
}

/**
 * The `connect` key of `SendoConfig` (`SendoConfigBase` extends this). With it, webhooks are
 * verified with `X-Sendo-Signature` instead of Meta's signature (`appSecret` is not needed) and
 * Embedded Signup completes through Connect. Sending still goes directly to Meta.
 */
export interface ConnectConfig {
  connect?: ConnectOptions;
}

export interface ResolvedConnectConfig {
  apiKey: string;
  signingSecret: string;
  /** Without a trailing slash. */
  baseUrl: string;
}

function requiredSecret(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(
      `createSendo: \`connect.${name}\` must be a non-empty string (from the Sendo Connect panel).`,
    );
  }
  return value.trim();
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function baseUrlOf(value: unknown): string {
  if (value === undefined) return DEFAULT_CONNECT_BASE_URL;
  let url: URL | null = null;
  if (typeof value === "string") {
    try {
      url = new URL(value.trim());
    } catch {
      url = null;
    }
  }
  const secure =
    url !== null &&
    (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)));
  if (url === null || !secure) {
    throw new ConfigError(
      `createSendo: \`connect.baseUrl\` must be an https URL (default ${DEFAULT_CONNECT_BASE_URL}).`,
    );
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** `null` without `connect`; throws `ConfigError` on invalid keys. */
export function resolveConnectConfig(config: ConnectConfig): ResolvedConnectConfig | null {
  const raw: unknown = config.connect;
  if (raw === undefined) return null;
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError(
      "createSendo: `connect` must be { apiKey, signingSecret, baseUrl? } or omitted.",
    );
  }
  const connect = raw as Partial<ConnectOptions>;
  return {
    apiKey: requiredSecret("apiKey", connect.apiKey),
    signingSecret: requiredSecret("signingSecret", connect.signingSecret),
    baseUrl: baseUrlOf(connect.baseUrl),
  };
}
