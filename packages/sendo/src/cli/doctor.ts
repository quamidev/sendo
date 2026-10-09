import type { SendoAdapter } from "../adapters/types";
import type { GraphClient } from "../client/graph-client";
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
  /** Spanish, actionable instruction. */
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
  /** Same text as `fix.detail`; kept for older callers. */
  hint?: string;
}

/** Internal: a failing outcome must say how to fix it. */
type CheckOutcome = { ok: true; detail: string } | { ok: false; detail: string; fix: DoctorFix };

export type DoctorEnv = Record<string, string | undefined>;

export interface RunDoctorOptions {
  env: DoctorEnv;
  /** `null` when the storage adapter could not be built (e.g. Supabase env missing). */
  adapter: SendoAdapter | null;
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
] as const;

const SUPABASE_URL_KEYS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
const DEFAULT_URL_TIMEOUT_MS = 10_000;

const DOCS = "https://sendo.dev/docs";

function makeFix(kind: DoctorFixKind, detail: string, slug: string): DoctorFix {
  return { kind, detail, docsUrl: `${DOCS}/${slug}` };
}

const NO_ADAPTER_FIX = makeFix(
  "env",
  "Define SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env.local.",
  "quickstart",
);

const MIGRATION_FIX = makeFix(
  "migration",
  "Agrega la migración con npx shadcn add @sendo/sendo-schema y aplícala (supabase migration up o supabase db push).",
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
    return "Error desconocido";
  }
}

function metaFix(error: unknown, fallback: DoctorFix): DoctorFix {
  if (error instanceof MetaApiError) {
    if (error.isInvalidToken) {
      return makeFix(
        "meta_permission",
        "El token expiró o fue revocado (error 190 de Meta). Genera un token permanente de usuario del sistema en Meta Business Manager y actualiza la variable de entorno.",
        "meta-setup",
      );
    }
    if (error.status === 0) {
      return makeFix(
        "config",
        "No se pudo conectar con graph.facebook.com. Revisa tu conexión a internet o proxy.",
        "meta-setup",
      );
    }
    if (error.metaCode === 100) {
      return makeFix(
        "meta_permission",
        "Meta no encontró el recurso o el token no tiene permiso sobre él. Verifica el ID y que el token tenga los permisos whatsapp_business_messaging y whatsapp_business_management.",
        "meta-setup",
      );
    }
    if (error.metaCode === 10 || error.metaCode === 200) {
      return makeFix(
        "meta_permission",
        "Al token le faltan permisos. Asigna whatsapp_business_messaging y whatsapp_business_management al usuario del sistema.",
        "meta-setup",
      );
    }
  }
  return fallback;
}

function schemaMigrationFix(version: number, schema: SchemaExpectation): DoctorFix {
  const pending = pendingSchemaMigrations(version, schema);
  if (pending.length === 0) return MIGRATION_FIX;
  const changelogs = [...new Set(pending.map((m) => m.changelog))];
  return makeFix(
    "migration",
    `Copia las migraciones con npx shadcn add @sendo/sendo-schema y aplícalas en este orden (supabase migration up): ${pending.map((m) => m.file).join(", ")}. Cambios: ${changelogs.join(", ")}`,
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
 * failures become `ok: false` results with a Spanish `fix`. Secrets (tokens,
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

  // 2. Env vars.
  const missing: string[] = [];
  if (!present(env, "SENDO_META_APP_SECRET")) missing.push("SENDO_META_APP_SECRET");
  if (!present(env, "SENDO_VERIFY_TOKEN")) missing.push("SENDO_VERIFY_TOKEN");
  if (!SUPABASE_URL_KEYS.some((key) => present(env, key))) missing.push("SUPABASE_URL");
  if (!present(env, "SUPABASE_SERVICE_ROLE_KEY")) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  for (const account of accounts) {
    if (!present(env, account.tokenRef) && !missing.includes(account.tokenRef)) {
      missing.push(account.tokenRef);
    }
  }
  push(
    missing.length === 0
      ? {
          id: "env",
          label: "Variables de entorno",
          ok: true,
          detail:
            accounts.length === 0
              ? "SENDO_META_APP_SECRET, SENDO_VERIFY_TOKEN y Supabase definidas."
              : `SENDO_META_APP_SECRET, SENDO_VERIFY_TOKEN, Supabase y ${accounts.length} token(s) de cuenta definidos.`,
        }
      : {
          id: "env",
          label: "Variables de entorno",
          ok: false,
          detail: `Faltan o están vacías: ${missing.join(", ")}.`,
          fix: makeFix(
            "env",
            `Agrega ${missing.join(", ")} a .env.local (o al entorno de tu despliegue). Cada cuenta necesita la variable indicada en sendo_accounts.token_ref con su token de Meta.`,
            "quickstart",
          ),
        },
  );

  // 3. Tables, schema version, storage bucket.
  if (adapter === null) {
    for (const [id, label] of [
      ["tables", "Tablas de la base de datos"],
      ["schema-version", "Versión del esquema"],
      ["storage", "Bucket de almacenamiento"],
      ["accounts", "Cuentas de WhatsApp"],
    ] as const) {
      push({
        id,
        label,
        ok: false,
        detail: "No se pudo crear el adaptador de Supabase.",
        fix: NO_ADAPTER_FIX,
      });
    }
  } else {
    await check(
      "tables",
      "Tablas de la base de datos",
      async () => {
        const health = await adapter.healthCheck();
        return health.tablesOk
          ? { ok: true, detail: "Todas las tablas sendo_* existen." }
          : {
              ok: false,
              detail: `Faltan tablas: ${health.missing.join(", ")}.`,
              fix: MIGRATION_FIX,
            };
      },
      () =>
        makeFix(
          "env",
          "Revisa SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y que la migración esté aplicada.",
          "quickstart",
        ),
    );

    await check(
      "schema-version",
      "Versión del esquema",
      async () => {
        const version = await adapter.schemaVersion();
        if (version === null) {
          return {
            ok: false,
            detail: "sendo_schema_meta no existe o no tiene versión.",
            fix: MIGRATION_FIX,
          };
        }
        if (version === schema.version) {
          return { ok: true, detail: `Versión ${version}.` };
        }
        if (version > schema.version) {
          return {
            ok: false,
            detail: `Tu base está en la versión ${version} y Sendo espera la ${schema.version}.`,
            fix: makeFix(
              "config",
              `Actualiza @quami/sendo a una versión que soporte el esquema ${version}.`,
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
          "Revisa la conexión a Supabase y que la migración esté aplicada.",
          "quickstart",
        ),
    );

    await check(
      "storage",
      "Bucket de almacenamiento",
      async () => {
        const bucket = env.SENDO_STORAGE_BUCKET?.trim() || "sendo-media";
        return (await adapter.storage.bucketExists())
          ? { ok: true, detail: `El bucket ${bucket} existe.` }
          : {
              ok: false,
              detail: `El bucket ${bucket} no existe.`,
              fix: makeFix(
                "config",
                `Crea un bucket privado llamado ${bucket} en Supabase Storage (o define SENDO_STORAGE_BUCKET).`,
                "security",
              ),
            };
      },
      () =>
        makeFix(
          "env",
          "Revisa la conexión a Supabase Storage y SUPABASE_SERVICE_ROLE_KEY.",
          "security",
        ),
    );

    if (accountsError !== null) {
      push({
        id: "accounts",
        label: "Cuentas de WhatsApp",
        ok: false,
        detail: errorText(accountsError),
        fix: makeFix(
          "migration",
          "No se pudo leer sendo_accounts. Revisa la conexión a Supabase y que la migración esté aplicada.",
          "quickstart",
        ),
      });
    } else if (accounts.length === 0) {
      push({
        id: "accounts",
        label: "Cuentas de WhatsApp",
        ok: false,
        detail:
          options.accountId === undefined
            ? "No hay cuentas activas en sendo_accounts."
            : `No existe una cuenta activa con id o phone_number_id ${options.accountId}.`,
        fix: makeFix("config", "Registra el número con npx @quami/sendo accounts add.", "cli"),
      });
    } else {
      push({
        id: "accounts",
        label: "Cuentas de WhatsApp",
        ok: true,
        detail: `${accounts.length} cuenta(s) activa(s): ${accounts.map(accountName).join(", ")}.`,
      });
    }
  }

  // 4. Per-account Meta checks.
  for (const account of accounts) {
    await checkAccount(account);
  }

  // 5. Webhook URL round-trip.
  if (options.url !== undefined) {
    await checkWebhookUrl(options.url);
  }

  return results.map((result) => redactResult(result, secretList()));

  async function checkAccount(account: Account): Promise<void> {
    const name = accountName(account);
    const token = env[account.tokenRef];
    if (token === undefined || token.trim() === "") {
      push({
        id: `account:${account.phoneNumberId}:token`,
        label: `Token de ${name}`,
        ok: false,
        detail: `La variable ${account.tokenRef} está vacía; no se pueden verificar el número, la suscripción ni las plantillas.`,
        fix: makeFix(
          "env",
          `Define ${account.tokenRef} con el token permanente del usuario del sistema de Meta.`,
          "meta-setup",
        ),
      });
      return;
    }

    await check(
      `account:${account.phoneNumberId}:phone`,
      `Token y número ${name}`,
      async () => {
        const phone = await graph.getPhoneNumber(token, account.phoneNumberId ?? "");
        const parts = [
          `Número ${phone.displayPhoneNumber ?? account.phoneNumberId}`,
          phone.verifiedName === null ? null : `nombre ${phone.verifiedName}`,
          `verificación ${phone.codeVerificationStatus ?? "desconocida"}`,
          `calidad ${phone.qualityRating ?? "desconocida"}`,
        ].filter((part): part is string => part !== null);
        const detail = `${parts.join(", ")}.`;
        if (phone.qualityRating === "RED") {
          return {
            ok: false,
            detail,
            fix: makeFix(
              "meta_permission",
              "La calidad del número está en ROJO; Meta puede limitar los envíos. Revisa los mensajes enviados en WhatsApp Manager.",
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
            `Verifica que ${account.tokenRef} sea válido y que phone_number_id ${account.phoneNumberId} pertenezca a tu WABA.`,
            "meta-setup",
          ),
        ),
    );

    if (account.wabaId === null || account.wabaId === "") {
      push({
        id: `account:${account.phoneNumberId}:subscription`,
        label: `Suscripción del webhook ${name}`,
        ok: false,
        detail: "La cuenta no tiene waba_id.",
        fix: makeFix(
          "config",
          "Actualiza sendo_accounts.waba_id con el ID de tu WhatsApp Business Account.",
          "multi-number",
        ),
      });
      return;
    }

    await check(
      `account:${account.phoneNumberId}:subscription`,
      `Suscripción del webhook ${name}`,
      async () => {
        const apps = await graph.getSubscribedApps(token, account.wabaId ?? "");
        const names = apps.map((app) => app.name ?? app.id ?? "app sin nombre");
        if (apps.length === 0) {
          return {
            ok: false,
            detail: `La WABA ${account.wabaId} no tiene apps suscritas.`,
            fix: makeFix(
              "webhook",
              `Suscribe tu app: POST /${account.wabaId}/subscribed_apps con el token, y en el panel de Meta suscribe el webhook al campo messages.`,
              "meta-setup",
            ),
          };
        }
        const appId = env.SENDO_META_APP_ID?.trim();
        if (appId !== undefined && appId !== "" && !apps.some((app) => app.id === appId)) {
          return {
            ok: false,
            detail: `La WABA ${account.wabaId} tiene suscritas: ${names.join(", ")}, pero no la app ${appId}.`,
            fix: makeFix(
              "webhook",
              `Suscribe la app ${appId}: POST /${account.wabaId}/subscribed_apps con un token de esa app.`,
              "meta-setup",
            ),
          };
        }
        return { ok: true, detail: `Apps suscritas: ${names.join(", ")}.` };
      },
      (error) =>
        metaFix(
          error,
          makeFix("config", `Verifica que waba_id ${account.wabaId} sea correcto.`, "multi-number"),
        ),
    );

    await check(
      `account:${account.phoneNumberId}:templates`,
      `Sincronización de plantillas ${name}`,
      async () => {
        const templates = await graph.listTemplates(token, account.wabaId ?? "");
        const approved = templates.filter((t) => t.status === "APPROVED").length;
        return {
          ok: true,
          detail: `${templates.length} plantilla(s), ${approved} aprobada(s).`,
        };
      },
      (error) =>
        metaFix(
          error,
          makeFix(
            "meta_permission",
            "Verifica que el token tenga el permiso whatsapp_business_management sobre la WABA.",
            "meta-setup",
          ),
        ),
    );
  }

  async function checkWebhookUrl(url: string): Promise<void> {
    const id = "webhook-url";
    const label = "URL del webhook";
    const verifyToken = env.SENDO_VERIFY_TOKEN ?? "";
    if (verifyToken === "") {
      push({
        id,
        label,
        ok: false,
        detail: "SENDO_VERIFY_TOKEN no está definido; no se puede probar el challenge.",
        fix: makeFix(
          "env",
          "Define SENDO_VERIFY_TOKEN con el mismo valor que configuraste en el panel de Meta.",
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
          return { ok: true, detail: `${url} respondió el challenge.` };
        }
        if (response.status === 403) {
          return {
            ok: false,
            detail: `${url} respondió 403.`,
            fix: makeFix(
              "env",
              "SENDO_VERIFY_TOKEN no coincide con el del servidor o la ruta no usa el mismo valor. Revisa las variables de entorno del despliegue.",
              "meta-setup",
            ),
          };
        }
        if (!response.ok) {
          return {
            ok: false,
            detail: `${url} respondió ${response.status}.`,
            fix: makeFix(
              "webhook",
              "Verifica que la ruta del webhook exista (por ejemplo app/api/sendo/webhook/route.ts) y exporte GET.",
              "quickstart",
            ),
          };
        }
        return {
          ok: false,
          detail: `${url} respondió 200 pero no devolvió el challenge.`,
          fix: makeFix(
            "webhook",
            "La ruta GET debe responder exactamente el valor de hub.challenge en texto plano (usa sendo.handleWebhook o toNextHandlers).",
            "quickstart",
          ),
        };
      },
      () =>
        makeFix(
          "webhook",
          "No se pudo conectar con la URL. Verifica que sea pública (https), que la app esté desplegada y que no haya autenticación delante del webhook.",
          "meta-setup",
        ),
    );
  }
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

/** `0` when every check passed, `1` otherwise. */
export function doctorExitCode(results: readonly CheckResult[]): 0 | 1 {
  return results.every((result) => result.ok) ? 0 : 1;
}
