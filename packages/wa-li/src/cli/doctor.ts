import type { WhatsAppAdapter } from "../adapters/types";
import type { GraphClient } from "../client/graph-client";
import { MetaApiError } from "../errors/meta-api-error";
import type { Account } from "../types/entities";
import { createRedactingLogger, type Logger } from "../utils/logger";
import { redactText } from "../utils/redact";
import { WA_SCHEMA_VERSION } from "../utils/schema-version";

/** Result of one `doctor` check. `detail` and `hint` never contain secrets. */
export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Fix hint, present on failures. */
  hint?: string;
}

export type DoctorEnv = Record<string, string | undefined>;

export interface RunDoctorOptions {
  env: DoctorEnv;
  /** `null` when the storage adapter could not be built (e.g. Supabase env missing). */
  adapter: WhatsAppAdapter | null;
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
}

/** Env vars whose values are secrets and must never be printed. */
export const DOCTOR_SECRET_ENV_KEYS = [
  "WA_APP_SECRET",
  "WA_VERIFY_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const SUPABASE_URL_KEYS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
const DEFAULT_URL_TIMEOUT_MS = 10_000;

const NO_ADAPTER_HINT =
  "Define SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY en .env.local.";

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

function metaHint(error: unknown, fallback: string): string {
  if (error instanceof MetaApiError) {
    if (error.isInvalidToken) {
      return "El token expiró o fue revocado (error 190 de Meta). Genera un token permanente de usuario del sistema en Meta Business Manager y actualiza la variable de entorno.";
    }
    if (error.status === 0) {
      return "No se pudo conectar con graph.facebook.com. Revisa tu conexión a internet o proxy.";
    }
    if (error.metaCode === 100) {
      return "Meta no encontró el recurso o el token no tiene permiso sobre él. Verifica el ID y que el token tenga los permisos whatsapp_business_messaging y whatsapp_business_management.";
    }
    if (error.metaCode === 10 || error.metaCode === 200) {
      return "Al token le faltan permisos. Asigna whatsapp_business_messaging y whatsapp_business_management al usuario del sistema.";
    }
  }
  return fallback;
}

function accountName(account: Account): string {
  return account.displayPhone === ""
    ? account.phoneNumberId
    : `${account.displayPhone} (${account.phoneNumberId})`;
}

function randomChallenge(): string {
  return String(Math.floor(100_000_000 + Math.random() * 900_000_000));
}

/**
 * Runs every `doctor` check and returns one result per check. Never throws:
 * failures become `ok: false` results with a Spanish fix hint. Secrets (tokens,
 * app secret, verify token, service role key) are redacted from every string.
 */
export async function runDoctor(options: RunDoctorOptions): Promise<CheckResult[]> {
  const { env, adapter, graph } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const secrets = new Set<string>();
  for (const key of DOCTOR_SECRET_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") secrets.add(value);
  }
  const secretList = () => [...secrets];
  const logger = createRedactingLogger(options.logger, secretList);
  const results: CheckResult[] = [];

  const push = (result: CheckResult) => {
    results.push(result);
  };

  const check = async (
    id: string,
    label: string,
    fn: () => Promise<Omit<CheckResult, "id" | "label">>,
    onError: (error: unknown) => string,
  ) => {
    try {
      push({ id, label, ...(await fn()) });
    } catch (error) {
      logger.debug(`[wa-li doctor] ${id} failed`, error);
      push({ id, label, ok: false, detail: errorText(error), hint: onError(error) });
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
  if (!present(env, "WA_APP_SECRET")) missing.push("WA_APP_SECRET");
  if (!present(env, "WA_VERIFY_TOKEN")) missing.push("WA_VERIFY_TOKEN");
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
              ? "WA_APP_SECRET, WA_VERIFY_TOKEN y Supabase definidas."
              : `WA_APP_SECRET, WA_VERIFY_TOKEN, Supabase y ${accounts.length} token(s) de cuenta definidos.`,
        }
      : {
          id: "env",
          label: "Variables de entorno",
          ok: false,
          detail: `Faltan o están vacías: ${missing.join(", ")}.`,
          hint: "Agrégalas a .env.local (o al entorno de tu despliegue). Cada cuenta necesita la variable indicada en wa_accounts.token_ref con su token de Meta.",
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
        hint: NO_ADAPTER_HINT,
      });
    }
  } else {
    await check(
      "tables",
      "Tablas de la base de datos",
      async () => {
        const health = await adapter.healthCheck();
        return health.tablesOk
          ? { ok: true, detail: "Todas las tablas wa_* existen." }
          : {
              ok: false,
              detail: `Faltan tablas: ${health.missing.join(", ")}.`,
              hint: "Aplica la migración de @quami/wa-li-schema (supabase migration up o supabase db push).",
            };
      },
      () => "Revisa SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y que la migración esté aplicada.",
    );

    await check(
      "schema-version",
      "Versión del esquema",
      async () => {
        const version = await adapter.schemaVersion();
        if (version === null) {
          return {
            ok: false,
            detail: "wa_schema_meta no existe o no tiene versión.",
            hint: "Aplica la migración de @quami/wa-li-schema (supabase migration up).",
          };
        }
        if (version === WA_SCHEMA_VERSION) {
          return { ok: true, detail: `Versión ${version}.` };
        }
        return {
          ok: false,
          detail: `La base de datos tiene la versión ${version}; @quami/wa-li espera la ${WA_SCHEMA_VERSION}.`,
          hint:
            version < WA_SCHEMA_VERSION
              ? "Agrega la migración más reciente con npx shadcn add @quami/wa-li-schema y aplícala."
              : "Actualiza @quami/wa-li a la versión que corresponde a tu esquema.",
        };
      },
      () => "Revisa la conexión a Supabase y que la migración esté aplicada.",
    );

    await check(
      "storage",
      "Bucket de almacenamiento",
      async () => {
        const bucket = env.WA_STORAGE_BUCKET?.trim() || "whatsapp-media";
        return (await adapter.storage.bucketExists())
          ? { ok: true, detail: `El bucket ${bucket} existe.` }
          : {
              ok: false,
              detail: `El bucket ${bucket} no existe.`,
              hint: `Crea un bucket privado llamado ${bucket} en Supabase Storage (o define WA_STORAGE_BUCKET).`,
            };
      },
      () => "Revisa la conexión a Supabase Storage y SUPABASE_SERVICE_ROLE_KEY.",
    );

    if (accountsError !== null) {
      push({
        id: "accounts",
        label: "Cuentas de WhatsApp",
        ok: false,
        detail: errorText(accountsError),
        hint: "No se pudo leer wa_accounts. Revisa la conexión a Supabase y la migración.",
      });
    } else if (accounts.length === 0) {
      push({
        id: "accounts",
        label: "Cuentas de WhatsApp",
        ok: false,
        detail:
          options.accountId === undefined
            ? "No hay cuentas activas en wa_accounts."
            : `No existe una cuenta activa con id o phone_number_id ${options.accountId}.`,
        hint: "Registra el número con npx @quami/wa-li accounts add.",
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
        hint: `Define ${account.tokenRef} con el token permanente del usuario del sistema de Meta.`,
      });
      return;
    }

    await check(
      `account:${account.phoneNumberId}:phone`,
      `Token y número ${name}`,
      async () => {
        const phone = await graph.getPhoneNumber(token, account.phoneNumberId);
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
            hint: "La calidad del número está en ROJO; Meta puede limitar los envíos. Revisa los mensajes enviados en WhatsApp Manager.",
          };
        }
        return { ok: true, detail };
      },
      (error) =>
        metaHint(
          error,
          `Verifica que ${account.tokenRef} sea válido y que phone_number_id ${account.phoneNumberId} pertenezca a tu WABA.`,
        ),
    );

    if (account.wabaId === "") {
      push({
        id: `account:${account.phoneNumberId}:subscription`,
        label: `Suscripción del webhook ${name}`,
        ok: false,
        detail: "La cuenta no tiene waba_id.",
        hint: "Actualiza wa_accounts.waba_id con el ID de tu WhatsApp Business Account.",
      });
      return;
    }

    await check(
      `account:${account.phoneNumberId}:subscription`,
      `Suscripción del webhook ${name}`,
      async () => {
        const apps = await graph.getSubscribedApps(token, account.wabaId);
        const names = apps.map((app) => app.name ?? app.id ?? "app sin nombre");
        if (apps.length === 0) {
          return {
            ok: false,
            detail: `La WABA ${account.wabaId} no tiene apps suscritas.`,
            hint: `Suscribe tu app: POST /${account.wabaId}/subscribed_apps con el token, y en el panel de Meta suscribe el webhook al campo messages.`,
          };
        }
        const appId = env.WA_APP_ID?.trim();
        if (appId !== undefined && appId !== "" && !apps.some((app) => app.id === appId)) {
          return {
            ok: false,
            detail: `La WABA ${account.wabaId} tiene suscritas: ${names.join(", ")}, pero no la app ${appId}.`,
            hint: `Suscribe la app ${appId}: POST /${account.wabaId}/subscribed_apps con un token de esa app.`,
          };
        }
        return { ok: true, detail: `Apps suscritas: ${names.join(", ")}.` };
      },
      (error) => metaHint(error, `Verifica que waba_id ${account.wabaId} sea correcto.`),
    );

    await check(
      `account:${account.phoneNumberId}:templates`,
      `Sincronización de plantillas ${name}`,
      async () => {
        const templates = await graph.listTemplates(token, account.wabaId);
        const approved = templates.filter((t) => t.status === "APPROVED").length;
        return {
          ok: true,
          detail: `${templates.length} plantilla(s), ${approved} aprobada(s).`,
        };
      },
      (error) =>
        metaHint(
          error,
          "Verifica que el token tenga el permiso whatsapp_business_management sobre la WABA.",
        ),
    );
  }

  async function checkWebhookUrl(url: string): Promise<void> {
    const id = "webhook-url";
    const label = "URL del webhook";
    const verifyToken = env.WA_VERIFY_TOKEN ?? "";
    if (verifyToken === "") {
      push({
        id,
        label,
        ok: false,
        detail: "WA_VERIFY_TOKEN no está definido; no se puede probar el challenge.",
        hint: "Define WA_VERIFY_TOKEN con el mismo valor que configuraste en el panel de Meta.",
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
            hint: "WA_VERIFY_TOKEN no coincide con el del servidor o la ruta no usa el mismo valor. Revisa las variables de entorno del despliegue.",
          };
        }
        if (!response.ok) {
          return {
            ok: false,
            detail: `${url} respondió ${response.status}.`,
            hint: "Verifica que la ruta del webhook exista (por ejemplo app/api/whatsapp/route.ts) y exporte GET.",
          };
        }
        return {
          ok: false,
          detail: `${url} respondió 200 pero no devolvió el challenge.`,
          hint: "La ruta GET debe responder exactamente el valor de hub.challenge en texto plano (usa wa.handleWebhook o toNextHandlers).",
        };
      },
      () =>
        "No se pudo conectar con la URL. Verifica que sea pública (https), que la app esté desplegada y que no haya autenticación delante del webhook.",
    );
  }
}

async function loadAccounts(adapter: WhatsAppAdapter, accountId?: string): Promise<Account[]> {
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
  if (result.hint !== undefined) out.hint = redactText(result.hint, secrets);
  return out;
}

/** `0` when every check passed, `1` otherwise. */
export function doctorExitCode(results: readonly CheckResult[]): 0 | 1 {
  return results.every((result) => result.ok) ? 0 : 1;
}
