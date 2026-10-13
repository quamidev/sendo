import { randomInt } from "node:crypto";
import type { AccountInsertInput } from "../../adapters/types";
import { ConnectRequestError, createConnectClient } from "../../connect/client";
import type { ResolvedConnectConfig } from "../../connect/config";
import { EmbeddedSignupError, type EmbeddedSignupStep } from "../../errors/embedded-signup-error";
import { ConfigError, DuplicateAccountError, PayloadValidationError } from "../../errors/errors";
import { MetaApiError } from "../../errors/meta-api-error";
import type { MetaDirectTransport } from "../../transport/meta-direct";
import type { Account, TenantId } from "../../types/entities";
import { redactText } from "../../utils/redact";
import type { SendoContext } from "../context";
import { checkAccountBilling } from "./billing";
import type { StoreToken } from "./config";
import { connectAccount, type AccountOpsDeps } from "./operations";

/** What the `sendo-numbers` connect button captures from Embedded Signup. */
export interface CompleteEmbeddedSignupInput {
  /** The `code` from `FB.login` (single use, short-lived). */
  code: string;
  tenantId: TenantId;
  wabaId: string;
  phoneNumberId: string;
  /** Number shared with the WhatsApp Business app (skips `register`). */
  coexistence?: boolean;
  /** The number's existing two-step PIN, if it has one. Never stored. */
  pin?: string;
  label?: string;
}

export type CompleteEmbeddedSignup = (input: CompleteEmbeddedSignupInput) => Promise<Account>;

const PIN_RE = /^\d{6}$/;

function requireText(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PayloadValidationError({ field, message: "must be a non-empty string" });
  }
  return value.trim();
}

function validate(input: CompleteEmbeddedSignupInput): CompleteEmbeddedSignupInput {
  const raw: unknown = input;
  if (typeof raw !== "object" || raw === null) {
    throw new PayloadValidationError({ field: "input", message: "must be an object" });
  }
  if (input.pin !== undefined && !PIN_RE.test(input.pin)) {
    throw new PayloadValidationError({ field: "pin", message: "must be exactly 6 digits" });
  }
  const label = input.label?.trim();
  return {
    code: requireText("code", input.code),
    tenantId: input.tenantId,
    wabaId: requireText("wabaId", input.wabaId),
    phoneNumberId: requireText("phoneNumberId", input.phoneNumberId),
    coexistence: input.coexistence === true,
    ...(input.pin !== undefined && { pin: input.pin }),
    ...(label !== undefined && label !== "" && { label }),
  };
}

/** A random two-step PIN for numbers without one; never stored or logged. */
function randomPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * `sendo.accounts.completeEmbeddedSignup` (tech spec "Embedded Signup sequence"):
 * 1. exchange the code for the business token, 2. subscribe the app to the WABA,
 * 3. register the number with the PIN (skipped for coexistence), 4. read the display phone,
 * 5. `storeToken`, 6. insert or reactivate the account (`onboardedVia: "embedded_signup"`),
 * 7. make it the tenant's default if it is its first number, 8. check billing.
 *
 * With `connect`, steps 1–4 are one call to Sendo Connect (`POST {baseUrl}/v1/signup/complete`,
 * Bearer `connect.apiKey`), which returns the token and display phone; `meta.appId` and the app
 * secret are not needed, the account gets `onboardedVia: "connect"`, and the rest is identical.
 *
 * A failure in steps 1–5 leaves storage untouched. A failure after step 5 calls
 * `deleteToken(tokenRef)`, unsubscribes the app (best effort) and leaves no account row.
 * Errors: `ConfigError` (missing `storeToken`, `meta.appId` or app secret; Connect rejected the
 * API key),
 * `PayloadValidationError`, `DuplicateAccountError` (`ACCOUNT_EXISTS`) and
 * `EmbeddedSignupError` (`SIGNUP_CODE_EXPIRED`, `META_PERMISSION_MISSING`, `PIN_CONFLICT`,
 * `SIGNUP_FAILED`). The token never reaches logs, errors, rows or events.
 */
export function createCompleteEmbeddedSignup(
  ctx: SendoContext,
  deps: AccountOpsDeps,
): CompleteEmbeddedSignup {
  const { adapter, logger } = ctx;

  type SignupConfig =
    | {
        via: "direct";
        transport: MetaDirectTransport;
        appId: string;
        appSecret: string;
        storeToken: StoreToken;
      }
    | {
        via: "connect";
        transport: MetaDirectTransport;
        connect: ResolvedConnectConfig;
        storeToken: StoreToken;
      };

  function config(): SignupConfig {
    const { storeToken, meta } = ctx.accountsConfig;
    if (storeToken === null) {
      throw new ConfigError(
        "completeEmbeddedSignup needs the `storeToken` config hook to keep the business token.",
      );
    }
    const { connect } = ctx.config;
    if (connect !== null) {
      // validateConfig guarantees the meta-direct transport when `connect` is set.
      return {
        via: "connect",
        transport: ctx.transport as MetaDirectTransport,
        connect,
        storeToken,
      };
    }
    if (meta.appId === null) {
      throw new ConfigError("completeEmbeddedSignup needs `meta.appId` (your Meta app id).");
    }
    if (ctx.transport.kind !== "meta-direct") {
      throw new ConfigError(
        `completeEmbeddedSignup needs the meta-direct transport (with \`appSecret\`); the "${ctx.transport.kind}" transport cannot exchange the code.`,
      );
    }
    const transport = ctx.transport as MetaDirectTransport;
    if (typeof transport.appSecret !== "string" || transport.appSecret.trim() === "") {
      throw new ConfigError("completeEmbeddedSignup needs `appSecret` (your Meta app secret).");
    }
    return {
      via: "direct",
      transport,
      appId: meta.appId,
      appSecret: transport.appSecret,
      storeToken,
    };
  }

  /** Steps 1–4 on Meta with your own app. */
  async function acquireDirect(
    input: CompleteEmbeddedSignupInput,
    cfg: Extract<SignupConfig, { via: "direct" }>,
  ): Promise<{ token: string; displayPhone: string | null }> {
    const { graph } = cfg.transport;
    const token = await step("exchange_code", [cfg.appSecret, input.code], () =>
      graph.exchangeCode({ appId: cfg.appId, appSecret: cfg.appSecret, code: input.code }),
    );
    ctx.addSecret(token);

    await step("subscribe_app", [], () => graph.subscribeApp(token, input.wabaId));
    if (input.coexistence !== true) {
      const pin = input.pin ?? randomPin();
      await step("register_phone", [pin], () =>
        graph.registerPhone(token, input.phoneNumberId, pin),
      );
    }
    const phone = await step("read_phone", [], () =>
      graph.getPhoneNumber(token, input.phoneNumberId),
    );
    return { token, displayPhone: phone.displayPhoneNumber };
  }

  /** Steps 1–4 done by Sendo Connect with Quami's Meta app; Connect never stores the token. */
  async function acquireViaConnect(
    input: CompleteEmbeddedSignupInput,
    connect: ResolvedConnectConfig,
  ): Promise<{ token: string; displayPhone: string | null }> {
    const pin = input.coexistence === true ? null : (input.pin ?? randomPin());
    const secrets = [input.code, ...(pin === null ? [] : [pin])];
    const client = createConnectClient({ config: connect, secrets });
    try {
      const result = await client.completeSignup({
        code: input.code,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        coexistence: input.coexistence === true,
        pin,
      });
      ctx.addSecret(result.token);
      return result;
    } catch (error) {
      if (!(error instanceof ConnectRequestError)) throw signupError("connect", error, secrets);
      if (error.isUnauthorized) {
        throw new ConfigError(
          `Sendo Connect rejected the API key (HTTP ${String(error.status)}). Check \`connect.apiKey\` (SENDO_CONNECT_API_KEY) against the Connect panel.`,
        );
      }
      const cause =
        error.metaCode === null
          ? error
          : new MetaApiError({
              status: error.status,
              metaCode: error.metaCode,
              subcode: error.subcode,
              fbtraceId: error.fbtraceId,
              message: error.message,
              secrets: [...ctx.secrets(), ...secrets],
            });
      throw signupError(error.step ?? "connect", cause, secrets);
    }
  }

  /** Runs a step; failures become `EmbeddedSignupError` with redacted text. */
  async function step<T>(
    name: EmbeddedSignupStep,
    secrets: readonly string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw signupError(name, error, secrets);
    }
  }

  function signupError(
    name: EmbeddedSignupStep,
    error: unknown,
    secrets: readonly string[],
  ): EmbeddedSignupError {
    const all = [...ctx.secrets(), ...secrets];
    const reason =
      error instanceof MetaApiError
        ? error.message
        : redactText(error instanceof Error ? error.message : String(error), all);
    return EmbeddedSignupError.fromStep(name, error, reason);
  }

  async function assertConnectable(input: CompleteEmbeddedSignupInput): Promise<Account | null> {
    const existing = await adapter.accounts.getByPhoneNumberId(input.phoneNumberId);
    if (existing && (existing.active || existing.tenantId !== input.tenantId)) {
      throw new DuplicateAccountError({ phoneNumberId: input.phoneNumberId });
    }
    return existing;
  }

  /** Puts the account table back as it was before step 6 (no new row, reactivation undone). */
  async function undoSave(
    previous: Account | null,
    phoneNumberId: string,
    tokenRef: string,
  ): Promise<void> {
    const current = await adapter.accounts.getByPhoneNumberId(phoneNumberId);
    if (current?.tokenRef !== tokenRef) return;
    if (previous === null) {
      await adapter.accounts.update(current.id, { active: false, isDefault: false });
      await adapter.accounts.purge(current.id);
      return;
    }
    await adapter.accounts.update(current.id, {
      active: false,
      isDefault: false,
      tokenRef: previous.tokenRef,
      label: previous.label,
      coexistence: previous.coexistence,
      billingReady: previous.billingReady,
      billingCheckedAt: previous.billingCheckedAt,
    });
  }

  /** Compensation for a failure after `storeToken`; logs (never throws) its own failures. */
  async function compensate(
    transport: MetaDirectTransport,
    input: CompleteEmbeddedSignupInput,
    previous: Account | null,
    token: string,
    tokenRef: string,
  ): Promise<void> {
    try {
      await undoSave(previous, input.phoneNumberId, tokenRef);
    } catch (error) {
      logger.error(
        `[sendo] Embedded Signup: could not remove the account row for phone number id ${input.phoneNumberId}`,
        error,
      );
    }
    if (deps.deleteToken !== null) {
      try {
        await deps.deleteToken(tokenRef);
      } catch (error) {
        logger.error(
          `[sendo] Embedded Signup: deleteToken failed for tokenRef "${tokenRef}"; delete that secret manually`,
          error,
        );
      }
    }
    try {
      const sharing = await adapter.accounts.list({ active: true });
      if (sharing.some((a) => a.wabaId === input.wabaId)) {
        logger.warn(
          `[sendo] Embedded Signup: WABA ${input.wabaId} has other connected numbers; the app stays subscribed`,
        );
        return;
      }
      await transport.graph.unsubscribeApp(token, input.wabaId);
    } catch (error) {
      logger.warn(
        `[sendo] Embedded Signup: could not unsubscribe the app from WABA ${input.wabaId}`,
        error,
      );
    }
  }

  return async (rawInput) => {
    const input = validate(rawInput);
    const cfg = config();
    const { transport, storeToken } = cfg;

    // Read-only: a number connected elsewhere fails before the single-use code is spent.
    await assertConnectable(input);

    const { token, displayPhone } =
      cfg.via === "connect"
        ? await acquireViaConnect(input, cfg.connect)
        : await acquireDirect(input, cfg);

    const tokenRef = await step("store_token", [token], async () => {
      const ref = await storeToken({
        account: {
          tenantId: input.tenantId,
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
        },
        token,
      });
      if (typeof ref !== "string" || ref.trim() === "") {
        throw new TypeError("storeToken must return a non-empty tokenRef");
      }
      if (ref.includes(token)) throw new TypeError("storeToken returned the token as tokenRef");
      return ref;
    });

    let previous: Account | null = null;
    let account: Account;
    try {
      previous = await assertConnectable(input);
      const insert: AccountInsertInput = {
        tenantId: input.tenantId,
        channel: "whatsapp",
        ...(input.label !== undefined && { label: input.label }),
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        displayPhone: displayPhone ?? input.phoneNumberId,
        tokenRef,
        active: true,
        coexistence: input.coexistence === true,
        onboardedVia: cfg.via === "connect" ? "connect" : "embedded_signup",
        billingReady: null,
        billingCheckedAt: null,
      };
      account = await connectAccount(deps, insert);
    } catch (error) {
      await compensate(transport, input, previous, token, tokenRef);
      if (error instanceof DuplicateAccountError) throw error;
      throw signupError("save_account", error, [token]);
    }

    logger.info(
      `[sendo] Embedded Signup${cfg.via === "connect" ? " (Sendo Connect)" : ""} connected ${account.displayPhone} (account ${account.id}, tenant ${account.tenantId ?? "none"})`,
    );

    try {
      return await checkAccountBilling(ctx, account, token);
    } catch (error) {
      logger.warn(`[sendo] Embedded Signup: billing check failed for account ${account.id}`, error);
      return account;
    }
  };
}
