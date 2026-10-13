import { redactText } from "../utils/redact";
import { SendoError, type SendoErrorOptions } from "./base";

export const META_INVALID_TOKEN_CODE = 190;
/** Meta's payment-eligibility error: the WABA has no usable payment method. */
export const META_BILLING_ERROR_CODE = 131042;
/** More than 24 hours since the customer's last message. */
export const META_WINDOW_CLOSED_CODE = 131047;
/** Throttling codes: app (4), user (17), page (32), API (613), WABA (80007), throughput (130429), pair (131056). */
export const META_RATE_LIMIT_CODES: readonly number[] = [4, 17, 32, 613, 80007, 130429, 131056];

/**
 * What a `MetaApiError` means for the product, for UIs to translate:
 * - `billing_not_ready`: no payment method on the WABA (131042)
 * - `token_invalid`: expired or revoked token (190)
 * - `window_closed`: the 24-hour window is closed (131047); send a template
 * - `rate_limited`: throttled by Meta; retry later
 */
export type MetaApiErrorHint =
  "billing_not_ready" | "token_invalid" | "window_closed" | "rate_limited";

/** The hint for a Meta error code; `null` when the code has no product meaning. */
export function metaErrorHint(metaCode: number | null): MetaApiErrorHint | null {
  if (metaCode === null) return null;
  if (metaCode === META_BILLING_ERROR_CODE) return "billing_not_ready";
  if (metaCode === META_INVALID_TOKEN_CODE) return "token_invalid";
  if (metaCode === META_WINDOW_CLOSED_CODE) return "window_closed";
  if (META_RATE_LIMIT_CODES.includes(metaCode)) return "rate_limited";
  return null;
}

export interface MetaApiErrorParams {
  /** HTTP status of the Graph API response. */
  status: number;
  /** Meta `error.code` (e.g. 190 invalid token, 131047 window closed). */
  metaCode: number | null;
  subcode?: number | null;
  fbtraceId?: string | null;
  /** Meta `error.type` (e.g. `OAuthException`). */
  type?: string | null;
  message?: string | null;
  /** Meta `error.error_data.details`. */
  details?: string | null;
  /** Values (tokens, secrets) to strip from every string field. */
  secrets?: readonly string[];
  /** Overrides the hint derived from `metaCode`. */
  hint?: MetaApiErrorHint | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * A non-2xx Graph API response. The stable `code` is `"META_API_ERROR"`; Meta's
 * numeric error code is `metaCode`. Strings are redacted on construction and the
 * raw response body is never kept.
 */
export class MetaApiError extends SendoError {
  readonly code = "META_API_ERROR";
  readonly status: number;
  readonly metaCode: number | null;
  readonly subcode: number | null;
  readonly fbtraceId: string | null;
  readonly type: string | null;
  readonly details: string | null;
  /** Product meaning of `metaCode` (see `MetaApiErrorHint`); `null` when there is none. */
  readonly hint: MetaApiErrorHint | null;

  constructor(params: MetaApiErrorParams, options?: SendoErrorOptions) {
    const secrets = params.secrets ?? [];
    const metaMessage = redactText(params.message ?? "Unknown error", secrets);
    const subcode = params.subcode ?? null;
    const codePart =
      params.metaCode === null
        ? ""
        : ` (code ${params.metaCode}${subcode === null ? "" : `/${subcode}`})`;
    super(`Meta API error ${params.status}${codePart}: ${metaMessage}`, options);
    this.status = params.status;
    this.metaCode = params.metaCode;
    this.subcode = subcode;
    this.fbtraceId = params.fbtraceId ?? null;
    this.type = params.type ?? null;
    this.details = params.details == null ? null : redactText(params.details, secrets);
    this.hint = params.hint === undefined ? metaErrorHint(params.metaCode) : params.hint;
  }

  /** `true` for Meta error 190 (expired or invalid access token). */
  get isInvalidToken(): boolean {
    return this.metaCode === META_INVALID_TOKEN_CODE;
  }

  /**
   * Builds the error from a Graph API error body:
   * `{ error: { message, type, code, error_subcode, error_data: { details }, fbtrace_id } }`.
   */
  static fromResponse(
    status: number,
    body: unknown,
    opts: { secrets?: readonly string[] } = {},
  ): MetaApiError {
    const error = isRecord(body) && isRecord(body.error) ? body.error : {};
    const errorData = isRecord(error.error_data) ? error.error_data : {};
    return new MetaApiError({
      status,
      metaCode: asNumber(error.code),
      subcode: asNumber(error.error_subcode),
      fbtraceId: asString(error.fbtrace_id),
      type: asString(error.type),
      message: asString(error.message) ?? `HTTP ${status}`,
      details: asString(errorData.details),
      secrets: opts.secrets ?? [],
    });
  }

  protected override toJSONFields(): Record<string, unknown> {
    return {
      status: this.status,
      metaCode: this.metaCode,
      subcode: this.subcode,
      fbtraceId: this.fbtraceId,
      type: this.type,
      details: this.details,
      hint: this.hint,
    };
  }
}
