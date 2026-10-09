import { SendoError, type SendoErrorOptions } from "./base";
import { MetaApiError } from "./meta-api-error";

/**
 * The Embedded Signup step that failed (tech spec sequence, steps 1–7). `connect`: the Sendo
 * Connect signup call failed without naming a Meta step (unreachable, bad answer).
 */
export type EmbeddedSignupStep =
  | "connect"
  | "exchange_code"
  | "subscribe_app"
  | "register_phone"
  | "read_phone"
  | "store_token"
  | "save_account";

/**
 * Stable codes the numbers screen translates:
 * - `SIGNUP_CODE_EXPIRED`: the Embedded Signup `code` expired or was already used; start again
 * - `META_PERMISSION_MISSING`: the Meta app lacks a permission (app review not done) or access
 *   to the WABA/number
 * - `PIN_CONFLICT`: the number already has a two-step PIN and it was missing or wrong (or too
 *   many attempts; see `metaCode` and `details`)
 * - `SIGNUP_FAILED`: anything else (see `step` and `cause`)
 */
export type EmbeddedSignupErrorCode =
  "SIGNUP_CODE_EXPIRED" | "META_PERMISSION_MISSING" | "PIN_CONFLICT" | "SIGNUP_FAILED";

/** Meta OAuth error on the code exchange (subcodes 36007 expired, 36009 already used). */
const META_INVALID_PARAMETER = 100;
/** `(#100) ... does not exist, cannot be loaded due to missing permissions` */
const META_MISSING_OBJECT_SUBCODE = 33;
/** Wrong PIN (133005), too many PIN guesses (133008), PIN guessed too fast (133009). */
const META_PIN_CODES: readonly number[] = [133005, 133008, 133009];

function isPermissionCode(code: number): boolean {
  return code === 3 || code === 10 || (code >= 200 && code <= 299);
}

function classify(step: EmbeddedSignupStep, cause: unknown): EmbeddedSignupErrorCode {
  if (!(cause instanceof MetaApiError) || cause.metaCode === null) return "SIGNUP_FAILED";
  const code = cause.metaCode;
  if (step === "exchange_code" && code === META_INVALID_PARAMETER) return "SIGNUP_CODE_EXPIRED";
  if (isPermissionCode(code)) return "META_PERMISSION_MISSING";
  if (code === META_INVALID_PARAMETER && cause.subcode === META_MISSING_OBJECT_SUBCODE) {
    return "META_PERMISSION_MISSING";
  }
  if (step === "register_phone" && META_PIN_CODES.includes(code)) return "PIN_CONFLICT";
  return "SIGNUP_FAILED";
}

/**
 * `sendo.accounts.completeEmbeddedSignup` failed. Branch on `code`; `step` says where. Meta
 * failures keep `metaCode`, `subcode`, `fbtraceId` and `details`. The message and `toJSON()`
 * never contain the business token, the app secret, the code or the PIN.
 */
export class EmbeddedSignupError extends SendoError {
  readonly code: EmbeddedSignupErrorCode;
  readonly step: EmbeddedSignupStep;
  readonly metaCode: number | null;
  readonly subcode: number | null;
  readonly fbtraceId: string | null;
  readonly details: string | null;

  constructor(
    params: { step: EmbeddedSignupStep; code: EmbeddedSignupErrorCode; reason: string },
    options?: SendoErrorOptions,
  ) {
    super(`Embedded Signup failed at ${params.step}: ${params.reason}`, options);
    this.code = params.code;
    this.step = params.step;
    const meta = options?.cause instanceof MetaApiError ? options.cause : null;
    this.metaCode = meta?.metaCode ?? null;
    this.subcode = meta?.subcode ?? null;
    this.fbtraceId = meta?.fbtraceId ?? null;
    this.details = meta?.details ?? null;
  }

  /**
   * Wraps a step failure. `reason` must already be redacted (a `MetaApiError` message is);
   * `cause` is kept for debugging but never serialized.
   */
  static fromStep(step: EmbeddedSignupStep, cause: unknown, reason: string): EmbeddedSignupError {
    return new EmbeddedSignupError({ step, code: classify(step, cause), reason }, { cause });
  }

  protected override toJSONFields(): Record<string, unknown> {
    return {
      step: this.step,
      metaCode: this.metaCode,
      subcode: this.subcode,
      fbtraceId: this.fbtraceId,
      details: this.details,
    };
  }
}
