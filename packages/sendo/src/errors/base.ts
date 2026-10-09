export const SENDO_ERROR_CODES = [
  "WINDOW_CLOSED",
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_VARIABLES",
  "META_API_ERROR",
  "ACCOUNT_NOT_FOUND",
  "AMBIGUOUS_ACCOUNT",
  "ACCOUNT_EXISTS",
  "MEDIA_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INVALID_SIGNATURE",
  "INVALID_PHONE",
  "INVALID_PAYLOAD",
  "RECORD_NOT_FOUND",
  "CONFIG_ERROR",
  "NOT_IMPLEMENTED",
] as const;
export type SendoErrorCode = (typeof SENDO_ERROR_CODES)[number];

export interface SendoErrorOptions {
  cause?: unknown;
}

export interface SendoErrorJSON {
  name: string;
  code: SendoErrorCode;
  message: string;
  [key: string]: unknown;
}

/**
 * Base class for every error the library throws. `code` is stable and safe to
 * branch on. `toJSON()` never includes `cause` or `stack`.
 */
export abstract class SendoError extends Error {
  abstract readonly code: SendoErrorCode;

  constructor(message: string, options?: SendoErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }

  /** Extra serializable fields merged into `toJSON()`. */
  protected toJSONFields(): Record<string, unknown> {
    return {};
  }

  toJSON(): SendoErrorJSON {
    return { ...this.toJSONFields(), name: this.name, code: this.code, message: this.message };
  }
}

export function isSendoError(value: unknown): value is SendoError {
  return value instanceof SendoError;
}
