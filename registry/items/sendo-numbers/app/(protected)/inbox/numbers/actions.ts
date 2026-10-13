"use server";

import {
  AccountNotFoundError,
  assertCan,
  can,
  DuplicateAccountError,
  isSendoError,
  type Account,
  type Actor,
  type AgentMode,
} from "@quami/sendo";
import {
  lastDigits,
  serializeNumber,
  type ConnectNumberInput,
  type NumbersActionResult,
  type NumbersErrorCode,
  type NumbersMutation,
  type NumbersPage,
  type NumberView,
} from "@/components/sendo/numbers/types";
import { sendo } from "@/lib/sendo";
import { numbersConfig, requireUser, type NumbersUser } from "./numbers-config";

class ActionError extends Error {
  constructor(
    readonly code: NumbersErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function errorCode(error: unknown): NumbersErrorCode {
  if (error instanceof ActionError) return error.code;
  if (!isSendoError(error)) return "UNKNOWN";
  switch (error.code) {
    case "FORBIDDEN":
    case "SIGNUP_CODE_EXPIRED":
    case "META_PERMISSION_MISSING":
    case "PIN_CONFLICT":
    case "SIGNUP_FAILED":
    case "ACCOUNT_EXISTS":
    case "ACCOUNT_STATE":
      return error.code;
    case "CONFIG_ERROR":
      return "CONFIG_ERROR";
    case "ACCOUNT_NOT_FOUND":
    case "RECORD_NOT_FOUND":
      return "NOT_FOUND";
    case "INVALID_PAYLOAD":
      return "INVALID";
    default:
      return "UNKNOWN";
  }
}

/** Runs `fn` and turns errors into `{ ok: false }`. Library errors carry redacted, user-safe messages. */
async function attempt<T>(fn: () => Promise<T>): Promise<NumbersActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const code = errorCode(error);
    if (code === "UNKNOWN" && !isSendoError(error)) console.error("[sendo numbers]", error);
    if (code === "CONFIG_ERROR") console.error("[sendo numbers]", error);
    const message =
      error instanceof ActionError || isSendoError(error) ? error.message : "Unexpected error";
    return { ok: false, code, message };
  }
}

/** The user's actor; mutations also require `numbers.manage` (admins). */
async function requireAdmin(user: NumbersUser): Promise<Actor> {
  const actor = await sendo.actor(user.userId, user.tenantId);
  assertCan(actor, "numbers.manage");
  return actor;
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.length > 200) {
    throw new ActionError("INVALID", "Invalid number id");
  }
  return value;
}

/** The number, only when it belongs to the user's tenant (others look unknown). */
async function requireNumber(user: NumbersUser, id: unknown): Promise<Account> {
  const accountId = requireId(id);
  const account = await sendo.accounts.get(accountId);
  if (account.tenantId !== user.tenantId) {
    throw new AccountNotFoundError({ account: accountId, tenantId: user.tenantId });
  }
  return account;
}

/** Active numbers first, then disconnected ones; oldest first within each group. */
function sortNumbers(accounts: Account[]): Account[] {
  return [...accounts].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

async function tenantNumbers(user: NumbersUser, tokenInvalid = new Set<string>()) {
  const accounts = await sendo.accounts.list({ tenant: user.tenantId, includeInactive: true });
  return sortNumbers(accounts).map((account) =>
    serializeNumber(account, tokenInvalid.has(account.id)),
  );
}

async function mutation(user: NumbersUser, id: string, tokenInvalid?: Set<string>) {
  const numbers: NumberView[] = await tenantNumbers(user, tokenInvalid);
  return { numbers, id } satisfies NumbersMutation;
}

/**
 * Re-reads each number on Meta through `refreshBilling` (stores the payment state) and
 * collects the numbers whose token Meta rejected: `sendo` emits `account.error` (code 190)
 * during that call. Nothing extra is stored; the next load checks again.
 */
async function checkNumbers(accounts: Account[]): Promise<Set<string>> {
  const ids = new Set(accounts.map((account) => account.id));
  const invalid = new Set<string>();
  if (ids.size === 0) return invalid;
  const off = sendo.on("account.error", ({ account, error }) => {
    if (error.isInvalidToken && ids.has(account.id)) invalid.add(account.id);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(accounts.map((account) => sendo.accounts.refreshBilling(account.id))),
      new Promise((resolve) => {
        timer = setTimeout(resolve, numbersConfig.tokenCheckTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    off();
  }
  return invalid;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ActionError("INVALID", "Expected true or false");
  return value;
}

function requireAgentMode(value: unknown): AgentMode | null {
  if (value === null || value === "auto" || value === "draft") return value;
  throw new ActionError("INVALID", "Invalid agent mode");
}

function toConnectInput(input: unknown): ConnectNumberInput {
  if (typeof input !== "object" || input === null) {
    throw new ActionError("INVALID", "Invalid Embedded Signup result");
  }
  const raw = input as Partial<Record<keyof ConnectNumberInput, unknown>>;
  const field = (name: "code" | "wabaId" | "phoneNumberId"): string => {
    const value = raw[name];
    if (typeof value !== "string" || value.trim() === "" || value.length > 2000) {
      throw new ActionError("INVALID", `Invalid Embedded Signup ${name}`);
    }
    return value.trim();
  };
  if (raw.pin !== undefined && (typeof raw.pin !== "string" || !/^\d{6}$/.test(raw.pin))) {
    throw new ActionError("INVALID", "The PIN must be 6 digits");
  }
  return {
    code: field("code"),
    wabaId: field("wabaId"),
    phoneNumberId: field("phoneNumberId"),
    coexistence: raw.coexistence === true,
    ...(typeof raw.pin === "string" && { pin: raw.pin }),
    ...(raw.reconnectId !== undefined && { reconnectId: requireId(raw.reconnectId) }),
  };
}

/** The tenant's numbers for the screen, with the access the user has. */
export async function list(): Promise<NumbersActionResult<NumbersPage>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await sendo.actor(user.userId, user.tenantId);
    const manage = can(actor, "numbers.manage");
    if (!manage && !numbersConfig.numbersVisibleToNonAdmins) {
      return { access: "hidden", numbers: [] } satisfies NumbersPage;
    }
    let invalid = new Set<string>();
    if (numbersConfig.checkTokensOnLoad) {
      const accounts = await sendo.accounts.list({ tenant: user.tenantId });
      invalid = await checkNumbers(accounts);
    }
    return {
      access: manage ? "manage" : "read",
      numbers: await tenantNumbers(user, invalid),
    } satisfies NumbersPage;
  });
}

/**
 * Finishes Embedded Signup for the user's tenant. With `reconnectId` (invalid token or a
 * disconnected number) the number chosen in Meta must be that one: an active one is
 * disconnected first (keeps its history), then reconnected with the same id and default.
 */
export async function connect(
  input: ConnectNumberInput,
): Promise<NumbersActionResult<NumbersMutation>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await requireAdmin(user);
    const signup = toConnectInput(input);
    let label: string | undefined;
    let wasDefault = false;
    if (signup.reconnectId !== undefined) {
      const current = await requireNumber(user, signup.reconnectId);
      if (current.phoneNumberId !== signup.phoneNumberId) {
        throw new ActionError("WRONG_NUMBER", "Meta returned a different number");
      }
      label = current.label ?? undefined;
      wasDefault = current.isDefault;
      if (current.active) await sendo.accounts.disconnect(current.id, { by: actor.userId });
    }
    let account: Account;
    try {
      account = await sendo.accounts.completeEmbeddedSignup({
        code: signup.code,
        tenantId: user.tenantId,
        wabaId: signup.wabaId,
        phoneNumberId: signup.phoneNumberId,
        coexistence: signup.coexistence,
        ...(signup.pin !== undefined && { pin: signup.pin }),
        ...(label !== undefined && { label }),
      });
    } catch (error) {
      if (error instanceof DuplicateAccountError) {
        const existing = await sendo.accounts.get(signup.phoneNumberId).catch(() => null);
        if (existing?.tenantId === user.tenantId) {
          throw new ActionError("ALREADY_CONNECTED", "This number is already connected");
        }
      }
      throw error;
    }
    if (wasDefault && !account.isDefault) account = await sendo.accounts.setDefault(account.id);
    return mutation(user, account.id);
  });
}

export async function setDefault(id: string): Promise<NumbersActionResult<NumbersMutation>> {
  const user = await requireUser();
  return attempt(async () => {
    await requireAdmin(user);
    const account = await requireNumber(user, id);
    await sendo.accounts.setDefault(account.id);
    return mutation(user, account.id);
  });
}

export async function setLabel(
  id: string,
  label: string,
): Promise<NumbersActionResult<NumbersMutation>> {
  const user = await requireUser();
  return attempt(async () => {
    await requireAdmin(user);
    if (typeof label !== "string" || label.length > 80) {
      throw new ActionError("INVALID", "The label has at most 80 characters");
    }
    const account = await requireNumber(user, id);
    await sendo.accounts.setLabel(account.id, label);
    return mutation(user, account.id);
  });
}

/** Pauses (or resumes) the AI agent on every conversation of the number. */
export async function pauseAgent(
  id: string,
  paused: boolean,
): Promise<NumbersActionResult<NumbersMutation>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await requireAdmin(user);
    const account = await requireNumber(user, id);
    await sendo.accounts.pauseAgent(account.id, requireBoolean(paused), { by: actor.userId });
    return mutation(user, account.id);
  });
}

export async function setAgentMode(
  id: string,
  mode: AgentMode | null,
): Promise<NumbersActionResult<NumbersMutation>> {
  const user = await requireUser();
  return attempt(async () => {
    await requireAdmin(user);
    const agentMode = requireAgentMode(mode);
    const account = await requireNumber(user, id);
    await sendo.accounts.setAgentMode(account.id, agentMode);
    return mutation(user, account.id);
  });
}

/** "Ya lo agregué, verificar": asks Meta again for the payment method (and the token). */
export async function refreshBilling(id: string): Promise<NumbersActionResult<NumbersMutation>> {
  const user = await requireUser();
  return attempt(async () => {
    await requireAdmin(user);
    const account = await requireNumber(user, id);
    if (!account.active) throw new ActionError("ACCOUNT_STATE", "The number is disconnected");
    const invalid = await checkNumbers([account]);
    return mutation(user, account.id, invalid);
  });
}

/** Disconnects after the admin typed the number's last 4 digits; history stays readable. */
export async function disconnect(
  id: string,
  confirmation: string,
): Promise<NumbersActionResult<NumbersMutation>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await requireAdmin(user);
    const account = await requireNumber(user, id);
    if (
      typeof confirmation !== "string" ||
      confirmation.trim() !== lastDigits(account.displayPhone)
    ) {
      throw new ActionError("CONFIRMATION_MISMATCH", "The last 4 digits do not match");
    }
    await sendo.accounts.disconnect(account.id, { by: actor.userId });
    return mutation(user, account.id);
  });
}
