import { readFileSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";
import type { SendoAdapter } from "../adapters/types";
import { createGraphClient, type GraphClient } from "../client/graph-client";
import { isSendoError } from "../errors/base";
import { redactText } from "../utils/redact";
import { isUuid } from "../core/accounts/resolver";
import { disconnectAccount, requireAccount, setDefaultAccount } from "../core/accounts/operations";
import { AccountNotFoundError, AccountStateError, DuplicateAccountError } from "../errors/errors";
import { MetaApiError } from "../errors/meta-api-error";
import type { Account } from "../types/entities";
import {
  cliAccountOps,
  connectAccountFromCli,
  formatAccountsTable,
  type AccountPrompt,
} from "./accounts";
import { loadStorageFromConfig, type ConfigStorage } from "./config-loader";
import { doctorExitCode, metaErrorFix, runDoctor } from "./doctor";
import { loadDotenvFiles } from "./dotenv";
import { loadAgentData, runMcpServer } from "./mcp";
import { formatAccount, formatDoctorReport } from "./report";
import { runRulesSync } from "./rules";
import { createSupabaseAdapterFromEnv } from "./supabase";

export const CLI_USAGE = `sendo: diagnóstico y configuración de @quami/sendo

Uso:
  sendo doctor [--account <id>] [--url <url>] [--json] [--config <ruta>]
  sendo accounts add [--phone-number-id <id>] [--waba-id <id>] [--token-env <VAR>]
                     [--tenant-id <uuid>] [--display-phone <número>] [--timezone <IANA>] [--yes]
  sendo accounts list [--tenant-id <uuid>] [--json]
  sendo accounts set-default <id>
  sendo accounts disconnect <id>
  sendo rules sync --config <ruta> [--force] [--tenant <id>]
  sendo mcp [--config <ruta>]
  sendo --help | --version

Comandos:
  doctor         Revisa variables de entorno, token y estado del número en Meta, suscripción
                 de la WABA, URL del webhook, tablas, versión del esquema, bucket de
                 almacenamiento y sincronización de plantillas. Sale con código 1 si algo falla.
  accounts add   Registra un número de WhatsApp en sendo_accounts. Guarda solo el nombre de la
                 variable de entorno del token, nunca el token.
  accounts list  Lista los números (conectados y desconectados) con su tenant y cuál es el
                 número por defecto de cada tenant.
  accounts set-default <id>
                 Hace de ese número (id o phone_number_id) el número por defecto de su tenant.
  accounts disconnect <id>
                 Desconecta el número: deja de enviar y recibir, conserva conversaciones y
                 mensajes, y si en el tenant queda un solo número conectado, ese pasa a ser el
                 número por defecto.
  rules sync     Carga \`rules\` del módulo de --config (JS o TS) y guarda en sendo_rules las
                 reglas que falten (clave por tenant, origen "code"). Nunca sobrescribe reglas
                 existentes (editadas en la pantalla de reglas) salvo con --force.
  mcp            Servidor MCP por stdio para agentes de código (Claude Code, Cursor): docs,
                 referencia de la API, ítems del registro con su AGENTS.md y doctor en JSON
                 (solo lectura), todo de la versión instalada. Configúralo en el cliente con
                 el comando \`npx -y @quami/sendo mcp\`; no se ejecuta a mano.

Opciones de doctor:
  --account <id>          Revisa solo esta cuenta (id o phone_number_id)
  --url <url>             URL pública del webhook; prueba el challenge de verificación
  --json                  Imprime los resultados como JSON
  --config <ruta>         Módulo que exporta \`adapter\` (Drizzle, Prisma u otro) y, si tu
                          media no está en el adaptador, \`media\` (s3Storage u otro); sin él
                          se usa el adaptador de Supabase del entorno. También para mcp.

Opciones de accounts add:
  --phone-number-id <id>  Phone number ID de Meta (requerido)
  --token-env <VAR>       Variable de entorno que contiene el token (requerido)
  --waba-id <id>          WhatsApp Business Account ID (se intenta obtener con el token)
  --tenant-id <uuid>      Tenant de la cuenta (por defecto sin tenant)
  --display-phone <num>   Número visible (por defecto se obtiene de Meta)
  --timezone <IANA>       Zona horaria (por defecto America/Guatemala)
  --yes, -y               No hacer preguntas; falla si falta un dato requerido

Opciones de accounts list:
  --tenant-id <uuid>      Solo los números de ese tenant
  --json                  Imprime las cuentas como JSON

Opciones de rules sync:
  --config <ruta>         Módulo que exporta \`rules: RuleDefinition[]\` (p. ej. lib/sendo-rules.ts)
  --force                 Sobrescribe tipo, parámetros y cuenta de las reglas que ya existen
  --tenant <id>           Tenant de las reglas que no declaran uno; omite las de otros tenants

Generales:
  --help, -h              Muestra esta ayuda
  --version, -v           Muestra la versión

Entorno: carga .env.development.local, .env.local y .env del directorio actual sin
sobrescribir variables ya definidas. Supabase: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL),
SUPABASE_SERVICE_ROLE_KEY y SENDO_STORAGE_BUCKET (por defecto sendo-media).
Opcional: SENDO_META_APP_ID para verificar que tu app esté suscrita a la WABA.
`;

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface CliPromptSession {
  prompt: AccountPrompt;
  close(): void;
}

export interface CliDeps {
  /** Mutated: `.env*` files are loaded into it without overriding. */
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Default: Supabase adapter built from env. */
  createAdapter?: (env: Record<string, string | undefined>) => Promise<SendoAdapter>;
  graph?: GraphClient;
  fetch?: typeof fetch;
  /** Interactive prompt factory for `accounts add`; omitted = non-interactive. */
  createPrompt?: () => CliPromptSession;
  /** Read a file or return null (for `.env*`). Default: fs. */
  readFile?: (path: string) => string | null;
  version?: string;
  /** Raw stdio for `sendo mcp` (the protocol owns stdout). */
  stdio?: { stdin: Readable; stdout: Writable };
}

const SECRET_NAME_RE = /(TOKEN|SECRET|KEY|PASSWORD)/i;
const MIN_REDACT_LENGTH = 8;

/** Values of every env var whose name looks secret, used to scrub all CLI output. */
export function envSecrets(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([key, value]) => SECRET_NAME_RE.test(key) && (value?.length ?? 0) >= MIN_REDACT_LENGTH)
    .map(([, value]) => value as string);
}

const OPTIONS = {
  account: { type: "string" },
  url: { type: "string" },
  json: { type: "boolean" },
  "phone-number-id": { type: "string" },
  "waba-id": { type: "string" },
  "token-env": { type: "string" },
  "tenant-id": { type: "string" },
  "display-phone": { type: "string" },
  timezone: { type: "string" },
  yes: { type: "boolean", short: "y" },
  config: { type: "string" },
  force: { type: "boolean" },
  tenant: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

function readPackageVersion(): string {
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@quami/sendo" && typeof pkg.version === "string") return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return "desconocida";
}

function errorMessage(error: unknown): string {
  if (isSendoError(error) || error instanceof Error) return error.message;
  return String(error);
}

function ofTenant(account: Account): string {
  return account.tenantId === null ? "de las cuentas sin tenant" : `del tenant ${account.tenantId}`;
}

function tenantLeftWithoutDefault(account: Account): string {
  return account.tenantId === null
    ? "Las cuentas sin tenant quedan sin número por defecto."
    : `El tenant ${account.tenantId} queda sin número por defecto.`;
}

function describe(account: Account): string {
  const label = account.label === null ? "" : ` "${account.label}"`;
  return `${account.displayPhone}${label} (${account.id})`;
}

/** Spanish text for `parseArgs` errors (unknown option, missing or unexpected value). */
function parseArgsMessage(error: unknown): string {
  const message = errorMessage(error);
  const option = /'(-[^' ,]+)/.exec(message)?.[1] ?? "";
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    return `Opción desconocida: ${option}. Usa una de las opciones de la ayuda (abajo).`;
  }
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    return message.includes("does not take an argument")
      ? `${option} no lleva valor; escribe solo ${option}.`
      : `Falta el valor de ${option}: escribe ${option} <valor>.`;
  }
  return message;
}

function cliErrorMessage(error: unknown): string {
  if (error instanceof AccountNotFoundError) {
    return `No existe una cuenta con id o phone_number_id ${error.account ?? ""}. Revisa los números con \`sendo accounts list\`.`;
  }
  if (error instanceof AccountStateError) {
    return error.state === "inactive"
      ? `La cuenta ${error.accountId} está desconectada; reconéctala con \`sendo accounts add --phone-number-id <phone_number_id>\` (mismo tenant) antes de hacerla la de por defecto.`
      : `La cuenta ${error.accountId} está conectada; desconéctala primero.`;
  }
  if (error instanceof MetaApiError) {
    const fix = metaErrorFix(error);
    return fix === null
      ? `Meta rechazó la consulta: ${error.message}. Revisa el phone number ID y que el token tenga acceso a ese número; \`sendo doctor\` diagnostica el token.`
      : `Meta rechazó la consulta: ${error.message}.\n-> Solución: ${fix.detail}\n   Docs: ${fix.docsUrl ?? ""}`;
  }
  return errorMessage(error);
}

/** Spanish text for `accounts add` on a number that is connected, or disconnected in another tenant. */
function duplicateAccountMessage(phoneNumberId: string, existing: Account | null): string {
  if (existing === null || existing.active) {
    return [
      `El número ${phoneNumberId} ya está registrado y conectado${existing === null ? "" : `: ${describe(existing)}`}.`,
      "Revísalo con `sendo accounts list`. Para cambiar su token u otros datos, desconéctalo con",
      `\`sendo accounts disconnect ${phoneNumberId}\` y vuelve a agregarlo: se reconecta con el mismo id.`,
    ].join("\n");
  }
  const flag =
    existing.tenantId === null ? "sin --tenant-id" : `con --tenant-id ${existing.tenantId}`;
  return [
    `El número ${phoneNumberId} está desconectado y es ${ofTenant(existing)}.`,
    `Para reconectarlo, vuelve a ejecutar \`sendo accounts add\` ${flag}. Un número no cambia de tenant;`,
    "para usarlo en otro, bórralo antes con sendo.accounts.purge(id) (borra también sus conversaciones).",
  ].join("\n");
}

/** Runs the CLI with injected dependencies and resolves with the exit code. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const out = (text: string) => {
    deps.stdout(redactText(text, envSecrets(deps.env)));
  };
  const err = (text: string) => {
    deps.stderr(redactText(text, envSecrets(deps.env)));
  };

  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    err(`${parseArgsMessage(error)}\n\n${CLI_USAGE}`);
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed;

  if (values.version === true) {
    out(`${deps.version ?? readPackageVersion()}\n`);
    return EXIT_OK;
  }
  const [command, subcommand, ...rest] = positionals;
  if (values.help === true || command === undefined || command === "help") {
    out(CLI_USAGE);
    return EXIT_OK;
  }

  const isDoctor = command === "doctor" && subcommand === undefined;
  const accountsCommand = command === "accounts" ? subcommand : undefined;
  const isAccountsAdd = accountsCommand === "add" && rest.length === 0;
  const isAccountsList = accountsCommand === "list" && rest.length === 0;
  const isAccountsMutation =
    (accountsCommand === "set-default" || accountsCommand === "disconnect") && rest.length === 1;
  const isRulesSync = command === "rules" && subcommand === "sync" && rest.length === 0;
  const isMcp = command === "mcp" && subcommand === undefined;
  if (
    (accountsCommand === "set-default" || accountsCommand === "disconnect") &&
    rest.length === 0
  ) {
    err(
      `Falta <id>: sendo accounts ${accountsCommand} <id> (id o phone_number_id; míralos con \`sendo accounts list\`).\n\n${CLI_USAGE}`,
    );
    return EXIT_USAGE;
  }
  if (
    !isDoctor &&
    !isAccountsAdd &&
    !isAccountsList &&
    !isAccountsMutation &&
    !isRulesSync &&
    !isMcp
  ) {
    err(`Comando desconocido: ${positionals.join(" ")}\n\n${CLI_USAGE}`);
    return EXIT_USAGE;
  }

  loadDotenvFiles(deps.cwd, deps.env, deps.readFile);
  const graph = deps.graph ?? createGraphClient({ fetch: deps.fetch });
  const createAdapter = deps.createAdapter ?? createSupabaseAdapterFromEnv;

  const configPath = values.config?.trim() === "" ? undefined : values.config?.trim();
  let configStorage: Promise<ConfigStorage> | null = null;
  /**
   * `--config` adapter and `media` (errors propagate) or the env-built adapter (`null` + warning
   * when missing) with its default media store.
   */
  const doctorStorage = async (
    warn: (text: string) => void,
  ): Promise<{ adapter: SendoAdapter | null; media?: ConfigStorage["media"] }> => {
    if (configPath !== undefined && !isRulesSync) {
      configStorage ??= loadStorageFromConfig(configPath, deps.cwd);
      return configStorage;
    }
    try {
      return { adapter: await createAdapter(deps.env) };
    } catch (error) {
      warn(errorMessage(error));
      return { adapter: null };
    }
  };

  if (isMcp) {
    if (deps.stdio === undefined) {
      err("sendo mcp necesita stdin/stdout del proceso; ejecútalo desde un cliente MCP.\n");
      return EXIT_USAGE;
    }
    await runMcpServer({
      ...deps.stdio,
      version: deps.version ?? readPackageVersion(),
      data: loadAgentData(),
      runDoctor: async ({ account, url }) =>
        runDoctor({
          env: deps.env,
          ...(await doctorStorage(() => undefined)),
          graph,
          fetch: deps.fetch,
          accountId: account,
          url,
        }),
      redact: (text) => redactText(text, envSecrets(deps.env)),
    });
    return EXIT_OK;
  }

  if (isDoctor) {
    let storage: Awaited<ReturnType<typeof doctorStorage>>;
    try {
      storage = await doctorStorage((text) => {
        if (values.json !== true) err(`Aviso: ${text}\n`);
      });
    } catch (error) {
      err(`Error: ${cliErrorMessage(error)}\n`);
      return EXIT_FAILURE;
    }
    const results = await runDoctor({
      env: deps.env,
      ...storage,
      graph,
      fetch: deps.fetch,
      accountId: values.account,
      url: values.url,
    });
    out(
      values.json === true
        ? `${JSON.stringify(results, null, 2)}\n`
        : `${formatDoctorReport(results, envSecrets(deps.env))}\n`,
    );
    return doctorExitCode(results);
  }

  if (isRulesSync) {
    if (configPath === undefined) {
      err(`Falta --config <ruta>.\n\n${CLI_USAGE}`);
      return EXIT_USAGE;
    }
    const tenant = values.tenant?.trim();
    if (tenant !== undefined && tenant !== "" && !isUuid(tenant)) {
      err(
        `Error: El tenant debe ser un UUID: ${tenant}. Usa el tenant_id de tus cuentas (\`sendo accounts list\`), o quita --tenant para guardar las reglas sin tenant.\n`,
      );
      return EXIT_FAILURE;
    }
    try {
      const adapter = await createAdapter(deps.env);
      const result = await runRulesSync({
        adapter,
        configPath,
        cwd: deps.cwd,
        force: values.force === true,
        ...(tenant === undefined || tenant === "" ? {} : { tenant }),
      });
      if (!result.ok) {
        err(`${result.text}\n`);
        return EXIT_FAILURE;
      }
      out(`${result.text}\n`);
      return EXIT_OK;
    } catch (error) {
      err(`Error: ${cliErrorMessage(error)}\n`);
      return EXIT_FAILURE;
    }
  }

  if (isAccountsList || isAccountsMutation) {
    try {
      const adapter = await createAdapter(deps.env);
      if (isAccountsList) {
        const tenantId = values["tenant-id"]?.trim();
        const accounts = await adapter.accounts.list(
          tenantId === undefined || tenantId === "" ? {} : { tenantId },
        );
        out(
          values.json === true
            ? `${JSON.stringify(accounts, null, 2)}\n`
            : `${formatAccountsTable(accounts)}\n`,
        );
        return EXIT_OK;
      }
      const ref = rest[0] ?? "";
      const ops = cliAccountOps({
        adapter,
        graph,
        env: deps.env,
        warn: (text) => {
          err(`Aviso: ${text}\n`);
        },
      });
      if (accountsCommand === "set-default") {
        const before = ops.events.length;
        const account = await setDefaultAccount(ops.deps, ref);
        const changed = ops.events.slice(before).find((e) => e.name === "account.default");
        const previous = changed?.name === "account.default" ? changed.payload.previous : null;
        out(
          [
            `Número por defecto ${ofTenant(account)}: ${describe(account)}`,
            ...(changed === undefined ? ["(ya era el número por defecto)"] : []),
            ...(previous ? [`Antes: ${describe(previous)}`] : []),
          ].join("\n") + "\n",
        );
        return EXIT_OK;
      }
      const target = await requireAccount(adapter, ref);
      if (!target.active) {
        out(`${describe(target)} ya estaba desconectado.\n`);
        return EXIT_OK;
      }
      const account = await disconnectAccount(ops.deps, ref, { by: "cli" });
      const lines = [
        `Número desconectado: ${describe(account)}`,
        "Sus contactos, conversaciones y mensajes se conservan (solo lectura).",
      ];
      for (const event of ops.events) {
        if (event.name !== "account.default") continue;
        lines.push(
          event.payload.account
            ? `Nuevo número por defecto ${ofTenant(account)}: ${describe(event.payload.account)}`
            : tenantLeftWithoutDefault(account),
        );
      }
      lines.push(
        `El token (token_ref ${account.tokenRef}) no se borró: la CLI no usa deleteToken. Bórralo de tu gestor de secretos si ya no lo usas.`,
      );
      out(`${lines.join("\n")}\n`);
      return EXIT_OK;
    } catch (error) {
      err(`Error: ${cliErrorMessage(error)}\n`);
      return EXIT_FAILURE;
    }
  }

  const input = {
    phoneNumberId: values["phone-number-id"],
    wabaId: values["waba-id"],
    tokenEnv: values["token-env"],
    tenantId: values["tenant-id"],
    displayPhone: values["display-phone"],
    timezone: values.timezone,
  };
  const missing = (
    [
      ["--phone-number-id", input.phoneNumberId],
      ["--token-env", input.tokenEnv],
    ] as const
  )
    .filter(([, value]) => (value?.trim() ?? "") === "")
    .map(([flag]) => flag);
  const session =
    values.yes !== true && missing.length > 0 && deps.createPrompt !== undefined
      ? deps.createPrompt()
      : undefined;
  if (session === undefined && missing.length > 0) {
    err(`Falta ${missing.join(" y ")}.\n\n${CLI_USAGE}`);
    return EXIT_USAGE;
  }
  let adapter: SendoAdapter | undefined;
  try {
    adapter = await createAdapter(deps.env);
    const { account, reconnected } = await connectAccountFromCli({
      adapter,
      graph,
      env: deps.env,
      input,
      prompt: session?.prompt,
      fetch: deps.fetch,
    });
    out(`${formatAccount(account, reconnected)}\n`);
    return EXIT_OK;
  } catch (error) {
    const message =
      error instanceof DuplicateAccountError
        ? duplicateAccountMessage(
            error.phoneNumberId,
            (await adapter?.accounts.getByPhoneNumberId(error.phoneNumberId).catch(() => null)) ??
              null,
          )
        : cliErrorMessage(error);
    err(`Error: ${message}\n`);
    return EXIT_FAILURE;
  } finally {
    session?.close();
  }
}
