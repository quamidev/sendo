import type { SendoAdapter } from "../adapters/types";
import type { GraphClient } from "../client/graph-client";
import { connectAccount, type AccountOpsDeps } from "../core/accounts/operations";
import type { AccountsEventMap } from "../core/accounts/events";
import { ConfigError, DuplicateAccountError } from "../errors/errors";
import { MetaApiError } from "../errors/meta-api-error";
import type { Account } from "../types/entities";
import { requireWabaId } from "../utils/channel-ids";
import { createRedactingLogger } from "../utils/logger";

export interface AddAccountInput {
  phoneNumberId?: string;
  wabaId?: string;
  /** Name of the env var holding the token (stored as `tokenRef`). */
  tokenEnv?: string;
  /** `null`/empty = no tenant. */
  tenantId?: string | null;
  displayPhone?: string;
  /** IANA timezone. Default `America/Guatemala`. */
  timezone?: string;
}

/** Asks one question and resolves with the answer (empty string = no answer). */
export type AccountPrompt = (question: string) => Promise<string>;

export interface AddAccountOptions {
  adapter: SendoAdapter;
  graph: GraphClient;
  env: Record<string, string | undefined>;
  input: AddAccountInput;
  /** Interactive mode: asks for missing values. Without it, missing required values throw `ConfigError`. */
  prompt?: AccountPrompt;
  /** Used for the WABA lookup (`debug_token`). Default `globalThis.fetch`. */
  fetch?: typeof fetch;
}

const DIGITS_RE = /^\d+$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WABA_SCOPE = "whatsapp_business_management";

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

async function required(
  value: string | undefined,
  prompt: AccountPrompt | undefined,
  question: string,
  flag: string,
): Promise<string> {
  const given = clean(value);
  if (given !== undefined) return given;
  const answer = prompt === undefined ? undefined : clean(await prompt(question));
  if (answer === undefined) throw new ConfigError(`Falta ${flag}.`);
  return answer;
}

/**
 * Best effort WABA lookup: Graph has no phone number → WABA edge, but a system
 * user token's `debug_token` lists the WABAs it can manage in `granular_scopes`.
 * Returns the candidate ids (possibly empty). Never throws.
 */
export async function findWabaIdsForToken(
  graph: Pick<GraphClient, "baseUrl" | "version">,
  token: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string[]> {
  try {
    const url = new URL(`${graph.baseUrl}/${graph.version}/debug_token`);
    url.searchParams.set("input_token", token);
    const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const scopes = (body as { data?: { granular_scopes?: unknown } } | null)?.data?.granular_scopes;
    if (!Array.isArray(scopes)) return [];
    const ids = new Set<string>();
    for (const scope of scopes as { scope?: unknown; target_ids?: unknown }[]) {
      if (scope.scope !== WABA_SCOPE || !Array.isArray(scope.target_ids)) continue;
      for (const id of scope.target_ids) if (typeof id === "string") ids.add(id);
    }
    return [...ids];
  } catch {
    return [];
  }
}

/**
 * Registers a WhatsApp number in `sendo_accounts` with the same rules as `sendo.accounts.add`:
 * the tenant's only active number becomes its default, and a number disconnected in the same
 * tenant is reconnected (same id and history). Only the env var *name* is stored (`tokenRef`);
 * the token itself is read to call Meta and never stored. The display phone is fetched from
 * Meta when not given. The WABA id is looked up through the token's `debug_token` scopes when
 * not given; when that returns no single candidate it must be provided (flag or prompt).
 */
export async function addAccount(options: AddAccountOptions): Promise<Account> {
  return (await connectAccountFromCli(options)).account;
}

/** `addAccount` plus whether it reconnected a disconnected number. */
export async function connectAccountFromCli(
  options: AddAccountOptions,
): Promise<{ account: Account; reconnected: boolean }> {
  const { adapter, graph, env, input, prompt } = options;

  const phoneNumberId = await required(
    input.phoneNumberId,
    prompt,
    "Phone number ID (panel de Meta → WhatsApp → API Setup)",
    "--phone-number-id",
  );
  if (!DIGITS_RE.test(phoneNumberId)) {
    throw new ConfigError(`El phone number ID debe ser numérico: ${phoneNumberId}.`);
  }
  const existing = await adapter.accounts.getByPhoneNumberId(phoneNumberId);
  if (existing?.active === true) throw new DuplicateAccountError({ phoneNumberId });

  const tokenEnv = await required(
    input.tokenEnv,
    prompt,
    "Nombre de la variable de entorno con el token (ej. SENDO_TOKEN_PRINCIPAL)",
    "--token-env",
  );
  if (!ENV_NAME_RE.test(tokenEnv)) {
    throw new ConfigError(`Nombre de variable de entorno inválido: ${tokenEnv}.`);
  }
  const token = clean(env[tokenEnv]);
  if (token === undefined) {
    throw new ConfigError(
      `La variable de entorno ${tokenEnv} está vacía. Defínela con el token de Meta antes de registrar la cuenta.`,
    );
  }

  let displayPhone = clean(input.displayPhone);
  if (displayPhone === undefined) {
    try {
      const phone = await graph.getPhoneNumber(token, phoneNumberId);
      displayPhone = clean(phone.displayPhoneNumber);
    } catch (error) {
      if (error instanceof MetaApiError && error.isInvalidToken) throw error;
      if (prompt === undefined) throw error;
    }
    displayPhone ??= await required(
      undefined,
      prompt,
      "Número visible (ej. +502 5555 0000)",
      "--display-phone",
    );
  }

  let wabaId = clean(input.wabaId);
  if (wabaId === undefined) {
    const candidates = await findWabaIdsForToken(graph, token, options.fetch);
    if (candidates.length === 1) {
      wabaId = candidates[0];
    } else if (prompt !== undefined) {
      wabaId = await required(
        undefined,
        prompt,
        "WABA ID (WhatsApp Business Account ID)",
        "--waba-id",
      );
    } else {
      throw new ConfigError(
        candidates.length === 0
          ? "No se pudo obtener el WABA ID automáticamente; pásalo con --waba-id."
          : `El token tiene acceso a varias WABA (${candidates.join(", ")}); elige una con --waba-id.`,
      );
    }
  }
  if (wabaId === undefined || !DIGITS_RE.test(wabaId)) {
    throw new ConfigError(`El WABA ID debe ser numérico: ${wabaId ?? ""}.`);
  }

  let tenantId: string | null =
    input.tenantId === undefined ? null : (clean(input.tenantId) ?? null);
  if (input.tenantId === undefined && prompt !== undefined) {
    tenantId = clean(await prompt("Tenant ID (UUID; vacío = sin tenant)")) ?? null;
  }
  if (tenantId !== null && !UUID_RE.test(tenantId)) {
    throw new ConfigError(`El tenant ID debe ser un UUID: ${tenantId}.`);
  }

  const timezone = clean(input.timezone);
  const { deps } = cliAccountOps({ adapter, graph, env, warn: () => undefined });
  const account = await connectAccount(deps, {
    phoneNumberId,
    wabaId,
    displayPhone,
    tokenRef: tokenEnv,
    tenantId,
    ...(timezone === undefined ? {} : { timezone }),
  });
  return { account, reconnected: existing !== null };
}

export interface CliAccountOpsOptions {
  adapter: SendoAdapter;
  graph: GraphClient;
  env: Record<string, string | undefined>;
  /** Receives warnings (already redacted). */
  warn: (text: string) => void;
}

export interface CliAccountOps {
  deps: AccountOpsDeps;
  /** Events the operations emitted, in order. */
  events: {
    [E in keyof AccountsEventMap]: { name: E; payload: AccountsEventMap[E] };
  }[keyof AccountsEventMap][];
}

/**
 * Account operations for the CLI: no `deleteToken` hook, and the Embedded Signup app
 * unsubscribe uses the token from the env var named by `tokenRef` when there is one.
 */
export function cliAccountOps(options: CliAccountOpsOptions): CliAccountOps {
  const { adapter, graph, env, warn } = options;
  const events: CliAccountOps["events"] = [];
  const logger = createRedactingLogger(
    {
      warn: (...args: unknown[]) => {
        warn(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
      },
    },
    () => Object.values(env).filter((v): v is string => typeof v === "string" && v.length >= 8),
  );
  const deps: AccountOpsDeps = {
    adapter,
    media: adapter.storage ?? null,
    logger,
    emit(name, payload) {
      events.push({ name, payload } as CliAccountOps["events"][number]);
      return Promise.resolve();
    },
    deleteToken: null,
    async unsubscribeApp(account) {
      const token = clean(env[account.tokenRef]);
      if (token === undefined) {
        throw new ConfigError(
          `no hay token en el entorno para token_ref ${account.tokenRef}; desuscribe la app en Meta Business Settings`,
        );
      }
      await graph.unsubscribeApp(token, requireWabaId(account));
    },
  };
  return { deps, events };
}

const ONBOARDED_LABEL: Record<Account["onboardedVia"], string> = {
  manual: "manual",
  embedded_signup: "embedded signup",
  connect: "Sendo Connect",
};

function cell(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

/** Spanish table for `sendo accounts list`. */
export function formatAccountsTable(accounts: readonly Account[]): string {
  if (accounts.length === 0) {
    return "No hay números registrados. Agrega uno con `sendo accounts add`.";
  }
  const header = ["ID", "Número", "Etiqueta", "Tenant", "Estado", "Defecto", "Alta"];
  const rows = accounts.map((a) => [
    a.id,
    a.displayPhone,
    a.label ?? "—",
    a.tenantId ?? "(sin tenant)",
    a.active ? "conectado" : "desconectado",
    a.isDefault ? "sí" : "",
    ONBOARDED_LABEL[a.onboardedVia],
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => cell(c, widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}
