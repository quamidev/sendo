import type { MediaStore } from "../media/types";
import type { SendoAdapter } from "../adapters/types";
import type { GraphClient } from "../client/graph-client";
import { ConnectRequestError, createConnectClient } from "../connect/client";
import { resolveConnectConfig, type ResolvedConnectConfig } from "../connect/config";
import { MetaApiError } from "../errors/meta-api-error";
import type { Account } from "../types/entities";
import { createRedactingLogger, type Logger } from "../utils/logger";
import { redactText } from "../utils/redact";
import {
  SCHEMA_MIGRATIONS,
  SENDO_SCHEMA_VERSION,
  pendingSchemaMigrations,
  schemaDriftMessage,
  type SchemaExpectation,
} from "../utils/schema-version";

export type DoctorFixKind =
  "env" | "migration" | "meta_permission" | "billing" | "webhook" | "config";

/** What to do about a failing check, for people and coding agents. */
export interface DoctorFix {
  kind: DoctorFixKind;
  /** Actionable instruction in English. */
  detail: string;
  /** `https://sendo.dev/docs/<slug>` */
  docsUrl?: string;
}

/** Result of one `doctor` check. No field ever contains secrets. */
export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Present on every failing check. */
  fix?: DoctorFix;
  /** `true` on a failing check that does not fail the run (`doctorExitCode` ignores it). */
  warning?: true;
  /** Same text as `fix.detail`; kept for older callers. */
  hint?: string;
}

/** Internal: a failing outcome (error or warning) must say how to fix it. */
type CheckOutcome =
  { ok: true; detail: string } | { ok: false; detail: string; fix: DoctorFix; warning?: true };

export type DoctorEnv = Record<string, string | undefined>;

export interface RunDoctorOptions {
  env: DoctorEnv;
  /** `null` when the storage adapter could not be built (e.g. Supabase env missing). */
  adapter: SendoAdapter | null;
  /** The app's `MediaStore` (`--config` module's `media`); default the adapter's `storage`. */
  media?: MediaStore | null;
  graph: GraphClient;
  /** Used for the webhook URL round-trip. Default `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Restrict account checks to one account (UUID id or phone number id). */
  accountId?: string;
  /** Public webhook URL; enables the verify challenge round-trip check. */
  url?: string;
  logger?: Logger;
  /** Timeout for the webhook URL request. Default 10 s. */
  urlTimeoutMs?: number;
  /** Schema the package expects. Default `SENDO_SCHEMA_VERSION` and `SCHEMA_MIGRATIONS`. */
  schema?: SchemaExpectation;
}

/** Env vars whose values are secrets and must never be printed. */
export const DOCTOR_SECRET_ENV_KEYS = [
  "SENDO_META_APP_SECRET",
  "SENDO_VERIFY_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SENDO_CONNECT_API_KEY",
  "SENDO_CONNECT_SIGNING_SECRET",
] as const;

const CONNECT_ENV_KEYS = ["SENDO_CONNECT_API_KEY", "SENDO_CONNECT_SIGNING_SECRET"] as const;

const SUPABASE_URL_KEYS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
const DEFAULT_URL_TIMEOUT_MS = 10_000;

const DOCS = "https://sendo.dev/docs";

function makeFix(kind: DoctorFixKind, detail: string, slug: string): DoctorFix {
  return { kind, detail, docsUrl: `${DOCS}/${slug}` };
}

const NO_ADAPTER_FIX = makeFix(
  "env",
  "Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  "quickstart",
);

const MIGRATION_FIX = makeFix(
  "migration",
  "Add the migration with npx shadcn add @sendo/schema and apply it (supabase migration up or supabase db push).",
  "quickstart",
);

function present(env: DoctorEnv, key: string): boolean {
  const value = env[key];
  return value !== undefined && value.trim() !== "";
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function metaFix(error: unknown, fallback: DoctorFix): DoctorFix {
  return metaErrorFix(error) ?? fallback;
}

/** The fix for a known Meta error (invalid token, permissions, network), else `null`. */
export function metaErrorFix(error: unknown): DoctorFix | null {
  if (error instanceof MetaApiError) {
    if (error.isInvalidToken) {
      return makeFix(
        "meta_permission",
        "The token expired or was revoked (Meta error 190). Generate a permanent system user token in Meta Business Manager and update the environment variable.",
        "meta-setup",
      );
    }
    if (error.status === 0) {
      return makeFix(
        "config",
        "Could not connect to graph.facebook.com. Check your internet connection or proxy.",
        "meta-setup",
      );
    }
    if (error.metaCode === 100) {
      return makeFix(
        "meta_permission",
        "Meta could not find the resource, or the token has no permission on it. Check the ID and that the token has the whatsapp_business_messaging and whatsapp_business_management permissions.",
        "meta-setup",
      );
    }
    if (error.metaCode === 10 || error.metaCode === 200) {
      return makeFix(
        "meta_permission",
        "The token is missing permissions. Assign whatsapp_business_messaging and whatsapp_business_management to the system user.",
        "meta-setup",
      );
    }
  }
  return null;
}

function schemaMigrationFix(version: number, schema: SchemaExpectation): DoctorFix {
  const pending = pendingSchemaMigrations(version, schema);
  if (pending.length === 0) return MIGRATION_FIX;
  const changelogs = [...new Set(pending.map((m) => m.changelog))];
  return makeFix(
    "migration",
    `Copy the migrations with npx shadcn add @sendo/schema and apply them in this order (supabase migration up): ${pending.map((m) => m.file).join(", ")}. Changes: ${changelogs.join(", ")}`,
    "quickstart",
  );
}

function accountName(account: Account): string {
  const id = account.phoneNumberId ?? account.id;
  return account.displayPhone === "" ? id : `${account.displayPhone} (${id})`;
}

function randomChallenge(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

/**
 * Runs every `doctor` check and returns one result per check. Never throws:
 * failures become `ok: false` results with a `fix`. Secrets (tokens,
 * app secret, verify token, service role key) are redacted from every string.
 */
export async function runDoctor(options: RunDoctorOptions): Promise<CheckResult[]> {
  const { env, adapter, graph } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const schema = options.schema ?? { version: SENDO_SCHEMA_VERSION, migrations: SCHEMA_MIGRATIONS };
  const secrets = new Set<string>();
  for (const key of DOCTOR_SECRET_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") secrets.add(value);
  }
  const secretList = () => [...secrets];
  const logger = createRedactingLogger(options.logger, secretList);
  const results: CheckResult[] = [];

  const push = (result: { id: string; label: string } & CheckOutcome) => {
    results.push(result);
  };

  const check = async (
    id: string,
    label: string,
    fn: () => Promise<CheckOutcome>,
    onError: (error: unknown) => DoctorFix,
  ) => {
    try {
      push({ id, label, ...(await fn()) });
    } catch (error) {
      logger.debug(`[sendo doctor] ${id} failed`, error);
      push({ id, label, ok: false, detail: errorText(error), fix: onError(error) });
    }
  };

  // 1. Accounts (needed for the env check: each account's token env).
  let accounts: Account[] = [];
  let accountsError: unknown = null;
  if (adapter !== null) {
    try {
      accounts = await loadAccounts(adapter, options.accountId);
    } catch (error) {
      accountsError = error;
    }
  }
  for (const account of accounts) {
    const token = env[account.tokenRef];
    if (token !== undefined && token !== "") secrets.add(token);
  }

  // 2. Env vars. With Sendo Connect the relay signs webhooks, so the Meta app secret is optional.
  const viaConnect = CONNECT_ENV_KEYS.some((key) => present(env, key));
  const missing: string[] = [];
  if (viaConnect) {
    for (const key of CONNECT_ENV_KEYS) if (!present(env, key)) missing.push(key);
  } else if (!present(env, "SENDO_META_APP_SECRET")) {
    missing.push("SENDO_META_APP_SECRET");
  }
  if (!present(env, "SENDO_VERIFY_TOKEN")) missing.push("SENDO_VERIFY_TOKEN");
  if (!SUPABASE_URL_KEYS.some((key) => present(env, key))) missing.push("SUPABASE_URL");
  if (!present(env, "SUPABASE_SERVICE_ROLE_KEY")) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  for (const account of accounts) {
    if (!present(env, account.tokenRef) && !missing.includes(account.tokenRef)) {
      missing.push(account.tokenRef);
    }
  }
  const webhookSecretEnv = viaConnect ? CONNECT_ENV_KEYS.join(", ") : "SENDO_META_APP_SECRET";
  push(
    missing.length === 0
      ? {
          id: "env",
          label: "Environment variables",
          ok: true,
          detail:
            accounts.length === 0
              ? `${webhookSecretEnv}, SENDO_VERIFY_TOKEN and Supabase are set.`
              : `${webhookSecretEnv}, SENDO_VERIFY_TOKEN, Supabase and ${accounts.length} account token(s) are set.`,
        }
      : {
          id: "env",
          label: "Environment variables",
          ok: false,
          detail: `Missing or empty: ${missing.join(", ")}.`,
          fix: makeFix(
            "env",
            `Add ${missing.join(", ")} to .env.local (or to your deployment's environment). Each account needs the variable named in sendo_accounts.token_ref, holding its Meta token.`,
            "quickstart",
          ),
        },
  );

  // 3. Tables, schema version, storage bucket.
  if (adapter === null) {
    for (const [id, label] of [
      ["tables", "Database tables"],
      ["schema-version", "Schema version"],
      ["storage", "Storage bucket"],
      ["accounts", "WhatsApp accounts"],
    ] as const) {
      push({
        id,
        label,
        ok: false,
        detail: "Could not create the Supabase adapter.",
        fix: NO_ADAPTER_FIX,
      });
    }
  } else {
    await check(
      "tables",
      "Database tables",
      async () => {
        const health = await adapter.healthCheck();
        return health.tablesOk
          ? { ok: true, detail: "All sendo_* tables exist." }
          : {
              ok: false,
              detail: `Missing tables: ${health.missing.join(", ")}.`,
              fix: MIGRATION_FIX,
            };
      },
      () =>
        makeFix(
          "env",
          "Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and that the migration is applied.",
          "quickstart",
        ),
    );

    await check(
      "schema-version",
      "Schema version",
      async () => {
        const version = await adapter.schemaVersion();
        if (version === null) {
          return {
            ok: false,
            detail: "sendo_schema_meta does not exist or has no version.",
            fix: MIGRATION_FIX,
          };
        }
        if (version === schema.version) {
          return { ok: true, detail: `Version ${version}.` };
        }
        if (version > schema.version) {
          return {
            ok: false,
            detail: `Your database is at schema version ${version} and Sendo expects ${schema.version}.`,
            fix: makeFix(
              "config",
              `Upgrade @quami/sendo to a version that supports schema ${version}.`,
              "quickstart",
            ),
          };
        }
        return {
          ok: false,
          detail: schemaDriftMessage(version, schema),
          fix: schemaMigrationFix(version, schema),
        };
      },
      () =>
        makeFix(
          "env",
          "Check the Supabase connection and that the migration is applied.",
          "quickstart",
        ),
    );

    await check(
      "storage",
      "Storage bucket",
      async () => {
        const bucket = env.SENDO_STORAGE_BUCKET?.trim() || "sendo-media";
        const custom = options.media !== undefined && options.media !== null;
        const store = custom ? options.media : adapter.storage;
        if (store === undefined || store === null) {
          return {
            ok: false,
            detail: "No media storage is configured: incoming media is stored as failed.",
            fix: makeFix(
              "config",
              "Pass `media` to createSendo (supabaseStorage() from @quami/sendo/storage/supabase or s3Storage() from @quami/sendo/storage/s3) and export it as `media` from the --config module.",
              "api-reference#media-store",
            ),
          };
        }
        if (store.exists === undefined) {
          return {
            ok: true,
            detail: "The media store does not implement exists(); the bucket was not checked.",
          };
        }
        if (custom) {
          return (await store.exists())
            ? { ok: true, detail: "The media store bucket exists." }
            : {
                ok: false,
                detail: "The media store bucket does not exist.",
                fix: makeFix(
                  "config",
                  "Create the private bucket you passed to s3Storage()/supabaseStorage(), or fix its name.",
                  "api-reference#media-store",
                ),
              };
        }
        return (await store.exists())
          ? { ok: true, detail: `Bucket ${bucket} exists.` }
          : {
              ok: false,
              detail: `Bucket ${bucket} does not exist.`,
              fix: makeFix(
                "config",
                `Create a private bucket named ${bucket} in Supabase Storage (or set SENDO_STORAGE_BUCKET).`,
                "security",
              ),
            };
      },
      () =>
        makeFix(
          "env",
          "Check the Supabase Storage connection and SUPABASE_SERVICE_ROLE_KEY.",
          "security",
        ),
    );

    if (accountsError !== null) {
      push({
        id: "accounts",
        label: "WhatsApp accounts",
        ok: false,
        detail: errorText(accountsError),
        fix: makeFix(
          "migration",
          "Could not read sendo_accounts. Check the Supabase connection and that the migration is applied.",
          "quickstart",
        ),
      });
    } else if (accounts.length === 0) {
      push({
        id: "accounts",
        label: "WhatsApp accounts",
        ok: false,
        detail:
          options.accountId === undefined
            ? "There are no active accounts in sendo_accounts."
            : `There is no active account with id or phone_number_id ${options.accountId}.`,
        fix: makeFix("config", "Register the number with npx @quami/sendo accounts add.", "cli"),
      });
    } else {
      push({
        id: "accounts",
        label: "WhatsApp accounts",
        ok: true,
        detail: `${accounts.length} active account(s): ${accounts.map(accountName).join(", ")}.`,
      });
    }
  }

  // 4. Per-account Meta checks and the stored billing state.
  for (const account of accounts) {
    await checkAccount(account);
    push(billingCheck(account));
  }

  // 5. Webhook URL round-trip.
  if (options.url !== undefined) {
    await checkWebhookUrl(options.url);
  }

  // 6. Sendo Connect: API key, registered webhook URL, last relay delivery.
  if (viaConnect) {
    await checkConnect();
  }

  return results.map((result) => redactResult(result, secretList()));

  async function checkAccount(account: Account): Promise<void> {
    const name = accountName(account);
    const token = env[account.tokenRef];
    if (token === undefined || token.trim() === "") {
      push({
        id: `account:${account.phoneNumberId}:token`,
        label: `Token for ${name}`,
        ok: false,
        detail: `${account.tokenRef} is empty; the number, subscription and templates cannot be checked.`,
        fix: makeFix(
          "env",
          `Set ${account.tokenRef} to the permanent Meta system user token.`,
          "meta-setup",
        ),
      });
      return;
    }

    await check(
      `account:${account.phoneNumberId}:phone`,
      `Token and number ${name}`,
      async () => {
        const phone = await graph.getPhoneNumber(token, account.phoneNumberId ?? "");
        const parts = [
          `Number ${phone.displayPhoneNumber ?? account.phoneNumberId}`,
          phone.verifiedName === null ? null : `name ${phone.verifiedName}`,
          `verification ${phone.codeVerificationStatus ?? "unknown"}`,
          `quality ${phone.qualityRating ?? "unknown"}`,
        ].filter((part): part is string => part !== null);
        const detail = `${parts.join(", ")}.`;
        if (phone.qualityRating === "RED") {
          return {
            ok: false,
            detail,
            fix: makeFix(
              "meta_permission",
              "The number's quality rating is RED; Meta may limit sends. Review the messages you sent in WhatsApp Manager.",
              "meta-setup",
            ),
          };
        }
        return { ok: true, detail };
      },
      (error) =>
        metaFix(
          error,
          makeFix(
            "meta_permission",
            `Check that ${account.tokenRef} is valid and that phone_number_id ${account.phoneNumberId} belongs to your WABA.`,
            "meta-setup",
          ),
        ),
    );

    if (account.wabaId === null || account.wabaId === "") {
      push({
        id: `account:${account.phoneNumberId}:subscription`,
        label: `Webhook subscription ${name}`,
        ok: false,
        detail: "The account has no waba_id.",
        fix: makeFix(
          "config",
          "Set sendo_accounts.waba_id to your WhatsApp Business Account ID.",
          "multi-number",
        ),
      });
      return;
    }

    await check(
      `account:${account.phoneNumberId}:subscription`,
      `Webhook subscription ${name}`,
      async () => {
        const apps = await graph.getSubscribedApps(token, account.wabaId ?? "");
        const names = apps.map((app) => app.name ?? app.id ?? "unnamed app");
        if (apps.length === 0) {
          return {
            ok: false,
            detail: `WABA ${account.wabaId} has no subscribed apps.`,
            fix: makeFix(
              "webhook",
              `Subscribe your app: POST /${account.wabaId}/subscribed_apps with the token, and in the Meta dashboard subscribe the webhook to the messages field.`,
              "meta-setup",
            ),
          };
        }
        const appId = env.SENDO_META_APP_ID?.trim();
        if (appId !== undefined && appId !== "" && !apps.some((app) => app.id === appId)) {
          return {
            ok: false,
            detail: `WABA ${account.wabaId} has these apps subscribed: ${names.join(", ")}, but not app ${appId}.`,
            fix: makeFix(
              "webhook",
              `Subscribe app ${appId}: POST /${account.wabaId}/subscribed_apps with a token from that app.`,
              "meta-setup",
            ),
          };
        }
        return { ok: true, detail: `Subscribed apps: ${names.join(", ")}.` };
      },
      (error) =>
        metaFix(
          error,
          makeFix("config", `Check that waba_id ${account.wabaId} is correct.`, "multi-number"),
        ),
    );

    await check(
      `account:${account.phoneNumberId}:templates`,
      `Template sync ${name}`,
      async () => {
        const templates = await graph.listTemplates(token, account.wabaId ?? "");
        const approved = templates.filter((t) => t.status === "APPROVED").length;
        return {
          ok: true,
          detail: `${templates.length} template(s), ${approved} approved.`,
        };
      },
      (error) =>
        metaFix(
          error,
          makeFix(
            "meta_permission",
            "Check that the token has the whatsapp_business_management permission on the WABA.",
            "meta-setup",
          ),
        ),
    );
  }

  async function checkConnect(): Promise<void> {
    const keyId = "connect:key";
    const keyLabel = "Sendo Connect key";
    let config: ResolvedConnectConfig | null;
    try {
      config = resolveConnectConfig({
        connect: {
          apiKey: env.SENDO_CONNECT_API_KEY ?? "",
          signingSecret: env.SENDO_CONNECT_SIGNING_SECRET ?? "",
          ...(present(env, "SENDO_CONNECT_BASE_URL") && { baseUrl: env.SENDO_CONNECT_BASE_URL }),
        },
      });
    } catch (error) {
      push({
        id: keyId,
        label: keyLabel,
        ok: false,
        detail: errorText(error),
        fix: makeFix(
          "env",
          "Set SENDO_CONNECT_API_KEY and SENDO_CONNECT_SIGNING_SECRET (from the Sendo Connect panel) and, if you use it, SENDO_CONNECT_BASE_URL as an https URL.",
          "sendo-connect",
        ),
      });
      return;
    }
    if (config === null) return;
    const baseUrl = config.baseUrl;
    const client = createConnectClient({
      config,
      fetch: fetchFn,
      timeoutMs: options.urlTimeoutMs ?? DEFAULT_URL_TIMEOUT_MS,
    });

    let status: Awaited<ReturnType<typeof client.getWebhook>>;
    try {
      status = await client.getWebhook();
    } catch (error) {
      logger.debug(`[sendo doctor] ${keyId} failed`, error);
      push({
        id: keyId,
        label: keyLabel,
        ok: false,
        detail: errorText(error),
        fix: connectRequestFix(error, baseUrl),
      });
      return;
    }
    push({
      id: keyId,
      label: keyLabel,
      ok: true,
      detail: `Sendo Connect accepted the key${status.projectId === null ? "" : ` (project ${status.projectId})`}.`,
    });

    const registered = status.url;
    const expected = options.url;
    const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
    if (registered === null) {
      push({
        id: "connect:webhook",
        label: "Webhook URL in Connect",
        ok: false,
        detail:
          "No webhook URL is registered in Sendo Connect: the relay has nowhere to forward to.",
        fix: makeFix(
          "webhook",
          `Register ${expected ?? "https://<your-domain>/api/sendo/webhook"} as the webhook URL in the Sendo Connect panel.`,
          "sendo-connect",
        ),
      });
    } else if (expected !== undefined && !sameUrl(registered, expected)) {
      push({
        id: "connect:webhook",
        label: "Webhook URL in Connect",
        ok: false,
        detail: `Sendo Connect forwards to ${registered}, not to ${expected}.`,
        fix: makeFix(
          "webhook",
          `Change the webhook URL in the Sendo Connect panel to ${expected}.`,
          "sendo-connect",
        ),
      });
    } else {
      push({
        id: "connect:webhook",
        label: "Webhook URL in Connect",
        ok: true,
        detail: `Sendo Connect forwards to ${registered}.`,
      });
    }

    push(connectDeliveryCheck(status.lastDelivery));
  }

  async function checkWebhookUrl(url: string): Promise<void> {
    const id = "webhook-url";
    const label = "Webhook URL";
    const verifyToken = env.SENDO_VERIFY_TOKEN ?? "";
    if (verifyToken === "") {
      push({
        id,
        label,
        ok: false,
        detail: "SENDO_VERIFY_TOKEN is not set; the challenge cannot be tested.",
        fix: makeFix(
          "env",
          "Set SENDO_VERIFY_TOKEN to the same value you configured in the Meta dashboard.",
          "meta-setup",
        ),
      });
      return;
    }
    await check(
      id,
      label,
      async () => {
        const target = new URL(url);
        const challenge = randomChallenge();
        target.searchParams.set("hub.mode", "subscribe");
        target.searchParams.set("hub.verify_token", verifyToken);
        target.searchParams.set("hub.challenge", challenge);
        const response = await fetchFn(target, {
          method: "GET",
          signal: AbortSignal.timeout(options.urlTimeoutMs ?? DEFAULT_URL_TIMEOUT_MS),
        });
        const body = (await response.text()).trim();
        if (response.ok && body === challenge) {
          return { ok: true, detail: `${url} answered the challenge.` };
        }
        if (response.status === 403) {
          return {
            ok: false,
            detail: `${url} answered 403.`,
            fix: makeFix(
              "env",
              "SENDO_VERIFY_TOKEN does not match the server's value, or the route does not use the same value. Check your deployment's environment variables.",
              "meta-setup",
            ),
          };
        }
        if (!response.ok) {
          return {
            ok: false,
            detail: `${url} answered ${response.status}.`,
            fix: makeFix(
              "webhook",
              "Check that the webhook route exists (for example app/api/sendo/webhook/route.ts) and exports GET.",
              "quickstart",
            ),
          };
        }
        return {
          ok: false,
          detail: `${url} answered 200 but did not return the challenge.`,
          fix: makeFix(
            "webhook",
            "The GET route must answer with exactly the hub.challenge value as plain text (use sendo.handleWebhook or toNextHandlers).",
            "quickstart",
          ),
        };
      },
      () =>
        makeFix(
          "webhook",
          "Could not connect to the URL. Check that it is public (https), that the app is deployed and that no authentication sits in front of the webhook.",
          "meta-setup",
        ),
    );
  }
}

function connectRequestFix(error: unknown, baseUrl: string): DoctorFix {
  if (error instanceof ConnectRequestError && error.isUnauthorized) {
    return makeFix(
      "env",
      "Sendo Connect rejected SENDO_CONNECT_API_KEY. Copy the current key from the Sendo Connect panel to .env.local and to your deployment.",
      "sendo-connect",
    );
  }
  if (error instanceof ConnectRequestError && error.status === 0) {
    return makeFix(
      "config",
      `Could not connect to ${baseUrl}. Check your connection and SENDO_CONNECT_BASE_URL (default https://connect.sendo.dev).`,
      "sendo-connect",
    );
  }
  return makeFix(
    "config",
    `Sendo Connect (${baseUrl}) answered with an error. Try again; if it persists, check the service status in the Connect panel.`,
    "sendo-connect",
  );
}

/** The relay's last delivery to the app: none yet warns; a non-2xx answer fails. */
function connectDeliveryCheck(
  delivery: { at: Date; statusCode: number | null } | null,
): { id: string; label: string } & CheckOutcome {
  const id = "connect:delivery";
  const label = "Last relay delivery";
  if (delivery === null) {
    return {
      id,
      label,
      ok: false,
      warning: true,
      detail: "Sendo Connect has not delivered any webhook to your app yet.",
      fix: makeFix(
        "webhook",
        "Send a WhatsApp message to one of your numbers and run doctor again.",
        "sendo-connect",
      ),
    };
  }
  const code = delivery.statusCode;
  const when = delivery.at.toISOString();
  if (code !== null && code >= 200 && code < 300) {
    return { id, label, ok: true, detail: `Your app answered ${String(code)} at ${when}.` };
  }
  if (code === 401) {
    return {
      id,
      label,
      ok: false,
      detail: `Your app rejected the delivery at ${when} with 401 (invalid signature).`,
      fix: makeFix(
        "env",
        "SENDO_CONNECT_SIGNING_SECRET does not match the one in the Sendo Connect panel (or the server clock is more than 5 minutes off). Fix the variable in your deployment.",
        "sendo-connect",
      ),
    };
  }
  return {
    id,
    label,
    ok: false,
    detail:
      code === null
        ? `The delivery at ${when} got no answer from your app.`
        : `Your app answered ${String(code)} to the delivery at ${when}.`,
    fix: makeFix(
      "webhook",
      "Check that the webhook route is deployed and public (no authentication in front of it) and read your app's logs; the relay retries for 24 h.",
      "sendo-connect",
    ),
  };
}

/** Product spec AC-ES-6: `billingReady` `false` or `null` warns (sends still work until Meta says no). */
function billingCheck(account: Account): { id: string; label: string } & CheckOutcome {
  const id = `account:${account.phoneNumberId ?? account.id}:billing`;
  const label = `Payment method ${accountName(account)}`;
  if (account.billingReady === true) {
    return { id, label, ok: true, detail: "Meta reports a payment method on the WABA." };
  }
  const settings =
    account.wabaId === null || account.wabaId === ""
      ? "https://business.facebook.com/settings/whatsapp-business-accounts"
      : `https://business.facebook.com/settings/whatsapp-business-accounts/${account.wabaId}`;
  const fix = makeFix(
    "billing",
    `Add a payment method to the WABA in Meta Business Settings (${settings}), then verify with sendo.accounts.refreshBilling("${account.id}") or with the billing verify button on the Numbers screen.`,
    "embedded-signup",
  );
  return {
    id,
    label,
    ok: false,
    warning: true,
    detail:
      account.billingReady === false
        ? "Meta says the WABA has no payment method: sends fail with error 131042."
        : "Payment status unknown: not verified with Meta yet.",
    fix,
  };
}

async function loadAccounts(adapter: SendoAdapter, accountId?: string): Promise<Account[]> {
  if (accountId === undefined) return adapter.accounts.list({ active: true });
  const byId = await adapter.accounts.getById(accountId);
  const account = byId ?? (await adapter.accounts.getByPhoneNumberId(accountId));
  return account !== null && account.active ? [account] : [];
}

function redactResult(result: CheckResult, secrets: readonly string[]): CheckResult {
  const out: CheckResult = {
    id: result.id,
    label: redactText(result.label, secrets),
    ok: result.ok,
    detail: redactText(result.detail, secrets),
  };
  if (result.warning === true) out.warning = true;
  if (result.fix !== undefined) {
    const fix: DoctorFix = {
      kind: result.fix.kind,
      detail: redactText(result.fix.detail, secrets),
    };
    if (result.fix.docsUrl !== undefined) fix.docsUrl = result.fix.docsUrl;
    out.fix = fix;
    out.hint = fix.detail;
  }
  return out;
}

/** `0` when every check passed or only warned, `1` otherwise. */
export function doctorExitCode(results: readonly CheckResult[]): 0 | 1 {
  return results.every((result) => result.ok || result.warning === true) ? 0 : 1;
}
