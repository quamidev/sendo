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

export const CLI_USAGE = `sendo: diagnostics and setup for @quami/sendo

Usage:
  sendo doctor [--account <id>] [--url <url>] [--json] [--config <path>]
  sendo accounts add [--phone-number-id <id>] [--waba-id <id>] [--token-env <VAR>]
                     [--tenant-id <uuid>] [--display-phone <number>] [--timezone <IANA>] [--yes]
  sendo accounts list [--tenant-id <uuid>] [--json]
  sendo accounts set-default <id>
  sendo accounts disconnect <id>
  sendo rules sync --config <path> [--force] [--tenant <id>]
  sendo mcp [--config <path>]
  sendo --help | --version

Commands:
  doctor         Checks env vars, the token and number status in Meta, the WABA
                 subscription, the webhook URL, tables, schema version, the storage bucket
                 and template sync. Exits with code 1 if anything fails.
  accounts add   Registers a WhatsApp number in sendo_accounts. Stores only the name of the
                 token's env var, never the token.
  accounts list  Lists the numbers (connected and disconnected) with their tenant and which
                 one is each tenant's default number.
  accounts set-default <id>
                 Makes that number (id or phone_number_id) its tenant's default number.
  accounts disconnect <id>
                 Disconnects the number: it stops sending and receiving, keeps conversations
                 and messages, and if only one connected number is left in the tenant, that
                 one becomes the default.
  rules sync     Loads \`rules\` from the --config module (JS or TS) and saves the missing
                 rules to sendo_rules (key per tenant, source "code"). Never overwrites
                 existing rules (edited on the rules screen) unless you pass --force.
  mcp            Stdio MCP server for coding agents (Claude Code, Cursor): docs, API
                 reference, registry items with their AGENTS.md and doctor as JSON
                 (read-only), all from the installed version. Configure it in your client
                 with the command \`npx -y @quami/sendo mcp\`; you do not run it by hand.

doctor options:
  --account <id>          Check only this account (id or phone_number_id)
  --url <url>             Public webhook URL; tests the verification challenge
  --json                  Print the results as JSON
  --config <path>         Module that exports \`adapter\` (Drizzle, Prisma or another) and, if
                          your media is not in the adapter, \`media\` (s3Storage or another);
                          without it the Supabase adapter from env is used. Also for mcp.

accounts add options:
  --phone-number-id <id>  Meta phone number ID (required)
  --token-env <VAR>       Env var that holds the token (required)
  --waba-id <id>          WhatsApp Business Account ID (looked up with the token if omitted)
  --tenant-id <uuid>      The account's tenant (default: no tenant)
  --display-phone <num>   Display number (default: fetched from Meta)
  --timezone <IANA>       Time zone (default America/Guatemala)
  --yes, -y               Ask no questions; fail if a required value is missing

accounts list options:
  --tenant-id <uuid>      Only that tenant's numbers
  --json                  Print the accounts as JSON

rules sync options:
  --config <path>         Module that exports \`rules: RuleDefinition[]\` (e.g. lib/sendo-rules.ts)
  --force                 Overwrite type, params and account of rules that already exist
  --tenant <id>           Tenant for rules that do not declare one; skips other tenants' rules

General:
  --help, -h              Show this help
  --version, -v           Show the version

Environment: loads .env.development.local, .env.local and .env from the current directory
without overriding variables that are already set. Supabase: SUPABASE_URL (or
NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY and SENDO_STORAGE_BUCKET (default
sendo-media). Optional: SENDO_META_APP_ID to check that your app is subscribed to the WABA.
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
  return "unknown";
}

function errorMessage(error: unknown): string {
  if (isSendoError(error) || error instanceof Error) return error.message;
  return String(error);
}

function ofTenant(account: Account): string {
  return account.tenantId === null
    ? "for accounts without a tenant"
    : `for tenant ${account.tenantId}`;
}

function tenantLeftWithoutDefault(account: Account): string {
  return account.tenantId === null
    ? "Accounts without a tenant are left without a default number."
    : `Tenant ${account.tenantId} is left without a default number.`;
}

function describe(account: Account): string {
  const label = account.label === null ? "" : ` "${account.label}"`;
  return `${account.displayPhone}${label} (${account.id})`;
}

/** Readable text for `parseArgs` errors (unknown option, missing or unexpected value). */
function parseArgsMessage(error: unknown): string {
  const message = errorMessage(error);
  const option = /'(-[^' ,]+)/.exec(message)?.[1] ?? "";
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    return `Unknown option: ${option}. Use one of the options in the help below.`;
  }
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    return message.includes("does not take an argument")
      ? `${option} takes no value; write just ${option}.`
      : `Missing value for ${option}: write ${option} <value>.`;
  }
  return message;
}

function cliErrorMessage(error: unknown): string {
  if (error instanceof AccountNotFoundError) {
    return `There is no account with id or phone_number_id ${error.account ?? ""}. List the numbers with \`sendo accounts list\`.`;
  }
  if (error instanceof AccountStateError) {
    return error.state === "inactive"
      ? `Account ${error.accountId} is disconnected; reconnect it with \`sendo accounts add --phone-number-id <phone_number_id>\` (same tenant) before making it the default.`
      : `Account ${error.accountId} is connected; disconnect it first.`;
  }
  if (error instanceof MetaApiError) {
    const fix = metaErrorFix(error);
    return fix === null
      ? `Meta rejected the request: ${error.message}. Check the phone number ID and that the token has access to that number; \`sendo doctor\` diagnoses the token.`
      : `Meta rejected the request: ${error.message}.\n-> Fix: ${fix.detail}\n   Docs: ${fix.docsUrl ?? ""}`;
  }
  return errorMessage(error);
}

/** Text for `accounts add` on a number that is connected, or disconnected in another tenant. */
function duplicateAccountMessage(phoneNumberId: string, existing: Account | null): string {
  if (existing === null || existing.active) {
    return [
      `Number ${phoneNumberId} is already registered and connected${existing === null ? "" : `: ${describe(existing)}`}.`,
      "Check it with `sendo accounts list`. To change its token or other data, disconnect it with",
      `\`sendo accounts disconnect ${phoneNumberId}\` and add it again: it reconnects with the same id.`,
    ].join("\n");
  }
  const flag =
    existing.tenantId === null ? "without --tenant-id" : `with --tenant-id ${existing.tenantId}`;
  return [
    `Number ${phoneNumberId} is disconnected and belongs to ${existing.tenantId === null ? "the accounts without a tenant" : `tenant ${existing.tenantId}`}.`,
    `To reconnect it, run \`sendo accounts add\` again ${flag}. A number cannot change tenants;`,
    "to use it in another tenant, first delete it with sendo.accounts.purge(id) (this also deletes its conversations).",
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
      `Missing <id>: sendo accounts ${accountsCommand} <id> (id or phone_number_id; list them with \`sendo accounts list\`).\n\n${CLI_USAGE}`,
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
    err(`Unknown command: ${positionals.join(" ")}\n\n${CLI_USAGE}`);
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
      err("sendo mcp needs the process's stdin/stdout; run it from an MCP client.\n");
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
        if (values.json !== true) err(`Warning: ${text}\n`);
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
      err(`Missing --config <path>.\n\n${CLI_USAGE}`);
      return EXIT_USAGE;
    }
    const tenant = values.tenant?.trim();
    if (tenant !== undefined && tenant !== "" && !isUuid(tenant)) {
      err(
        `Error: The tenant must be a UUID: ${tenant}. Use the tenant_id of your accounts (\`sendo accounts list\`), or drop --tenant to save the rules without a tenant.\n`,
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
          err(`Warning: ${text}\n`);
        },
      });
      if (accountsCommand === "set-default") {
        const before = ops.events.length;
        const account = await setDefaultAccount(ops.deps, ref);
        const changed = ops.events.slice(before).find((e) => e.name === "account.default");
        const previous = changed?.name === "account.default" ? changed.payload.previous : null;
        out(
          [
            `Default number ${ofTenant(account)}: ${describe(account)}`,
            ...(changed === undefined ? ["(it was already the default number)"] : []),
            ...(previous ? [`Previous: ${describe(previous)}`] : []),
          ].join("\n") + "\n",
        );
        return EXIT_OK;
      }
      const target = await requireAccount(adapter, ref);
      if (!target.active) {
        out(`${describe(target)} was already disconnected.\n`);
        return EXIT_OK;
      }
      const account = await disconnectAccount(ops.deps, ref, { by: "cli" });
      const lines = [
        `Number disconnected: ${describe(account)}`,
        "Its contacts, conversations and messages are kept (read-only).",
      ];
      for (const event of ops.events) {
        if (event.name !== "account.default") continue;
        lines.push(
          event.payload.account
            ? `New default number ${ofTenant(account)}: ${describe(event.payload.account)}`
            : tenantLeftWithoutDefault(account),
        );
      }
      lines.push(
        `The token (token_ref ${account.tokenRef}) was not deleted: the CLI does not use deleteToken. Delete it from your secret manager if you no longer use it.`,
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
    err(`Missing ${missing.join(" and ")}.\n\n${CLI_USAGE}`);
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
