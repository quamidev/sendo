import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { SendoAdapter } from "../adapters/types";
import { createGraphClient, type GraphClient } from "../client/graph-client";
import { isSendoError } from "../errors/base";
import { redactText } from "../utils/redact";
import { addAccount, type AccountPrompt } from "./accounts";
import { doctorExitCode, runDoctor } from "./doctor";
import { loadDotenvFiles } from "./dotenv";
import { formatAccount, formatDoctorReport } from "./report";
import { createSupabaseAdapterFromEnv } from "./supabase";

export const CLI_USAGE = `sendo: diagnóstico y configuración de @quami/sendo

Uso:
  sendo doctor [--account <id>] [--url <url>] [--json]
  sendo accounts add [--phone-number-id <id>] [--waba-id <id>] [--token-env <VAR>]
                     [--tenant-id <uuid>] [--display-phone <número>] [--timezone <IANA>] [--yes]
  sendo --help | --version

Comandos:
  doctor         Revisa variables de entorno, token y estado del número en Meta, suscripción
                 de la WABA, URL del webhook, tablas, versión del esquema, bucket de
                 almacenamiento y sincronización de plantillas. Sale con código 1 si algo falla.
  accounts add   Registra un número de WhatsApp en sendo_accounts. Guarda solo el nombre de la
                 variable de entorno del token, nunca el token.

Opciones de doctor:
  --account <id>          Revisa solo esta cuenta (id o phone_number_id)
  --url <url>             URL pública del webhook; prueba el challenge de verificación
  --json                  Imprime los resultados como JSON

Opciones de accounts add:
  --phone-number-id <id>  Phone number ID de Meta (requerido)
  --token-env <VAR>       Variable de entorno que contiene el token (requerido)
  --waba-id <id>          WhatsApp Business Account ID (se intenta obtener con el token)
  --tenant-id <uuid>      Tenant de la cuenta (por defecto sin tenant)
  --display-phone <num>   Número visible (por defecto se obtiene de Meta)
  --timezone <IANA>       Zona horaria (por defecto America/Guatemala)
  --yes, -y               No hacer preguntas; falla si falta un dato requerido

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
    err(`${errorMessage(error)}\n\n${CLI_USAGE}`);
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
  const isAccountsAdd = command === "accounts" && subcommand === "add" && rest.length === 0;
  if (!isDoctor && !isAccountsAdd) {
    err(`Comando desconocido: ${positionals.join(" ")}\n\n${CLI_USAGE}`);
    return EXIT_USAGE;
  }

  loadDotenvFiles(deps.cwd, deps.env, deps.readFile);
  const graph = deps.graph ?? createGraphClient({ fetch: deps.fetch });
  const createAdapter = deps.createAdapter ?? createSupabaseAdapterFromEnv;

  if (isDoctor) {
    let adapter: SendoAdapter | null = null;
    try {
      adapter = await createAdapter(deps.env);
    } catch (error) {
      if (values.json !== true) err(`Aviso: ${errorMessage(error)}\n`);
    }
    const results = await runDoctor({
      env: deps.env,
      adapter,
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

  const input = {
    phoneNumberId: values["phone-number-id"],
    wabaId: values["waba-id"],
    tokenEnv: values["token-env"],
    tenantId: values["tenant-id"],
    displayPhone: values["display-phone"],
    timezone: values.timezone,
  };
  const needsPrompt = input.phoneNumberId === undefined || input.tokenEnv === undefined;
  const session =
    values.yes !== true && needsPrompt && deps.createPrompt !== undefined
      ? deps.createPrompt()
      : undefined;
  try {
    const adapter = await createAdapter(deps.env);
    const account = await addAccount({
      adapter,
      graph,
      env: deps.env,
      input,
      prompt: session?.prompt,
      fetch: deps.fetch,
    });
    out(`${formatAccount(account)}\n`);
    return EXIT_OK;
  } catch (error) {
    err(`Error: ${errorMessage(error)}\n`);
    return EXIT_FAILURE;
  } finally {
    session?.close();
  }
}
