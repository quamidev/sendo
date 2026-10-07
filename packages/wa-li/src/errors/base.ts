export const WHATSAPP_ERROR_CODES = [
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
export type WhatsAppErrorCode = (typeof WHATSAPP_ERROR_CODES)[number];

export interface WhatsAppErrorOptions {
  cause?: unknown;
}

export interface WhatsAppErrorJSON {
  name: string;
  code: WhatsAppErrorCode;
  message: string;
  [key: string]: unknown;
}

/**
 * Base class for every error the library throws. `code` is stable and safe to
 * branch on. `toJSON()` never includes `cause` or `stack`.
 */
export abstract class WhatsAppError extends Error {
  abstract readonly code: WhatsAppErrorCode;

  constructor(message: string, options?: WhatsAppErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }

  /** Extra serializable fields merged into `toJSON()`. */
  protected toJSONFields(): Record<string, unknown> {
    return {};
  }

  toJSON(): WhatsAppErrorJSON {
    return { ...this.toJSONFields(), name: this.name, code: this.code, message: this.message };
  }
}

export function isWhatsAppError(value: unknown): value is WhatsAppError {
  return value instanceof WhatsAppError;
}
