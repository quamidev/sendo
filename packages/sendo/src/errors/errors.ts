import type { Capability, Role } from "../team/permissions";
import type { TenantId } from "../types/entities";
import type { MediaType } from "../types/enums";
import { SendoError, type SendoErrorOptions } from "./base";

function tenantLabel(tenantId: TenantId): string {
  return tenantId === null ? "(no tenant)" : `"${tenantId}"`;
}

export class WindowClosedError extends SendoError {
  readonly code = "WINDOW_CLOSED";
  readonly conversationId: string | null;
  readonly expiresAt: Date | null;

  constructor(
    params: { conversationId?: string | null; expiresAt?: Date | null } = {},
    options?: SendoErrorOptions,
  ) {
    super(
      "The 24-hour customer service window is closed; only template messages can be sent.",
      options,
    );
    this.conversationId = params.conversationId ?? null;
    this.expiresAt = params.expiresAt ?? null;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return {
      conversationId: this.conversationId,
      expiresAt: this.expiresAt?.toISOString() ?? null,
    };
  }
}

export type TemplateNotFoundReason = "missing" | "not_approved" | "inactive";

const TEMPLATE_REASON_TEXT: Record<TemplateNotFoundReason, string> = {
  missing: "was not found",
  not_approved: "is not approved",
  inactive: "is no longer available on Meta",
};

export class TemplateNotFoundError extends SendoError {
  readonly code = "TEMPLATE_NOT_FOUND";
  readonly templateName: string;
  readonly language: string;
  readonly accountId: string | null;
  readonly reason: TemplateNotFoundReason;

  constructor(
    params: {
      name: string;
      language: string;
      accountId?: string | null;
      reason?: TemplateNotFoundReason;
    },
    options?: SendoErrorOptions,
  ) {
    const reason = params.reason ?? "missing";
    super(
      `Template "${params.name}" (${params.language}) ${TEMPLATE_REASON_TEXT[reason]}.`,
      options,
    );
    this.templateName = params.name;
    this.language = params.language;
    this.accountId = params.accountId ?? null;
    this.reason = reason;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return {
      templateName: this.templateName,
      language: this.language,
      accountId: this.accountId,
      reason: this.reason,
    };
  }
}

export class TemplateVariablesError extends SendoError {
  readonly code = "TEMPLATE_VARIABLES";
  readonly templateName: string;
  readonly expected: number;
  readonly received: number;

  constructor(
    params: { name: string; expected: number; received: number },
    options?: SendoErrorOptions,
  ) {
    super(
      `Template "${params.name}" expects ${params.expected} variable(s) but received ${params.received}.`,
      options,
    );
    this.templateName = params.name;
    this.expected = params.expected;
    this.received = params.received;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { templateName: this.templateName, expected: this.expected, received: this.received };
  }
}

export class AccountNotFoundError extends SendoError {
  readonly code = "ACCOUNT_NOT_FOUND";
  /** The account id or phone number id that was looked up, when there was one. */
  readonly account: string | null;
  /** The tenant the lookup was scoped to; `undefined` when unscoped (`null` = no tenant). */
  readonly tenantId: TenantId | undefined;

  constructor(
    params: { account?: string | null; tenantId?: TenantId } = {},
    options?: SendoErrorOptions,
  ) {
    const account = params.account ?? null;
    const tenantId = params.tenantId;
    const scope = tenantId === undefined ? "" : ` for tenant ${tenantLabel(tenantId)}`;
    super(
      account === null
        ? tenantId === undefined
          ? "No WhatsApp account is configured."
          : `No active WhatsApp account${scope}.`
        : `WhatsApp account "${account}" was not found${scope}.`,
      options,
    );
    this.account = account;
    this.tenantId = tenantId;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return {
      account: this.account,
      ...(this.tenantId === undefined ? {} : { tenantId: this.tenantId }),
    };
  }
}

export class AmbiguousAccountError extends SendoError {
  readonly code = "AMBIGUOUS_ACCOUNT";
  /** Ids of the accounts that could have been meant (only the given tenant's when scoped). */
  readonly candidates: string[];
  /** The tenant the lookup was scoped to; `undefined` when unscoped (`null` = no tenant). */
  readonly tenantId: TenantId | undefined;

  constructor(params: { candidates: string[]; tenantId?: TenantId }, options?: SendoErrorOptions) {
    const n = params.candidates.length;
    super(
      params.tenantId === undefined
        ? `${n} WhatsApp accounts are active; pass \`{ tenant }\` (or \`{ account }\`) to choose one.`
        : `Tenant ${tenantLabel(params.tenantId)} has ${n} active WhatsApp accounts and no default; pass \`{ account }\` or set one with \`sendo.accounts.setDefault(id)\`.`,
      options,
    );
    this.candidates = params.candidates;
    this.tenantId = params.tenantId;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return {
      candidates: this.candidates,
      ...(this.tenantId === undefined ? {} : { tenantId: this.tenantId }),
    };
  }
}

export class DuplicateAccountError extends SendoError {
  readonly code = "ACCOUNT_EXISTS";
  readonly phoneNumberId: string;

  constructor(params: { phoneNumberId: string }, options?: SendoErrorOptions) {
    super(
      `A WhatsApp account with phone number id "${params.phoneNumberId}" already exists.`,
      options,
    );
    this.phoneNumberId = params.phoneNumberId;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { phoneNumberId: this.phoneNumberId };
  }
}

/**
 * The account is in the wrong state for the operation: `purge` on an active account
 * (`state: "active"`, disconnect it first) or `setDefault` on a disconnected one
 * (`state: "inactive"`).
 */
export class AccountStateError extends SendoError {
  readonly code = "ACCOUNT_STATE";
  readonly accountId: string;
  /** The state that blocked the operation. */
  readonly state: "active" | "inactive";

  constructor(
    params: { accountId: string; state: "active" | "inactive" },
    options?: SendoErrorOptions,
  ) {
    super(
      params.state === "active"
        ? `WhatsApp account "${params.accountId}" is active; disconnect it before purging.`
        : `WhatsApp account "${params.accountId}" is disconnected; reconnect it (Embedded Signup or \`sendo.accounts.add\`) before sending from it or making it the default.`,
      options,
    );
    this.accountId = params.accountId;
    this.state = params.state;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { accountId: this.accountId, state: this.state };
  }
}

export class MediaTooLargeError extends SendoError {
  readonly code = "MEDIA_TOO_LARGE";
  readonly mediaType: MediaType;
  readonly sizeBytes: number;
  readonly limitBytes: number;

  constructor(
    params: { mediaType: MediaType; sizeBytes: number; limitBytes: number },
    options?: SendoErrorOptions,
  ) {
    super(
      `The ${params.mediaType} is ${params.sizeBytes} bytes; Meta's limit is ${params.limitBytes} bytes.`,
      options,
    );
    this.mediaType = params.mediaType;
    this.sizeBytes = params.sizeBytes;
    this.limitBytes = params.limitBytes;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { mediaType: this.mediaType, sizeBytes: this.sizeBytes, limitBytes: this.limitBytes };
  }
}

export class UnsupportedMediaTypeError extends SendoError {
  readonly code = "UNSUPPORTED_MEDIA_TYPE";
  readonly mediaType: MediaType;
  readonly mimeType: string;

  constructor(params: { mediaType: MediaType; mimeType: string }, options?: SendoErrorOptions) {
    super(`Meta does not accept "${params.mimeType}" as ${params.mediaType}.`, options);
    this.mediaType = params.mediaType;
    this.mimeType = params.mimeType;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { mediaType: this.mediaType, mimeType: this.mimeType };
  }
}

export class SignatureError extends SendoError {
  readonly code = "INVALID_SIGNATURE";

  constructor(message = "Invalid or missing X-Hub-Signature-256.", options?: SendoErrorOptions) {
    super(message, options);
  }
}

export class InvalidPhoneError extends SendoError {
  readonly code = "INVALID_PHONE";
  readonly input: string;

  constructor(params: { input: string; reason?: string }, options?: SendoErrorOptions) {
    super(
      `Invalid phone number "${params.input}"${params.reason ? `: ${params.reason}` : ""}.`,
      options,
    );
    this.input = params.input;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { input: this.input };
  }
}

/**
 * An outbound payload breaks one of Meta's limits (button count, title length,
 * list rows...). Thrown by the payload builders before any network call.
 */
export class PayloadValidationError extends SendoError {
  readonly code = "INVALID_PAYLOAD";
  /** Dotted path of the offending field, e.g. `buttons[3]` or `sections[0].rows[1].title`. */
  readonly field: string;
  /** The limit that was exceeded, when the problem is a limit. */
  readonly limit: number | null;

  constructor(
    params: { field: string; message: string; limit?: number | null },
    options?: SendoErrorOptions,
  ) {
    super(`Invalid ${params.field}: ${params.message}`, options);
    this.field = params.field;
    this.limit = params.limit ?? null;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { field: this.field, limit: this.limit };
  }
}

export type RecordEntity =
  | "account"
  | "contact"
  | "conversation"
  | "message"
  | "media"
  | "template"
  | "event"
  | "snippet"
  | "tag"
  | "rule"
  | "broadcast"
  | "broadcast_recipient";

/** An adapter `update`-style method was called with an id that does not exist. */
export class RecordNotFoundError extends SendoError {
  readonly code = "RECORD_NOT_FOUND";
  readonly entity: RecordEntity;
  readonly id: string;

  constructor(params: { entity: RecordEntity; id: string }, options?: SendoErrorOptions) {
    super(`${params.entity} "${params.id}" was not found.`, options);
    this.entity = params.entity;
    this.id = params.id;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { entity: this.entity, id: this.id };
  }
}

/**
 * A write broke a schema constraint the adapters enforce identically (e.g. a second
 * default account in a tenant, a contact without phone or channel user id).
 * `constraint` is the Postgres constraint or index name.
 */
export class ConstraintViolationError extends SendoError {
  readonly code = "CONSTRAINT_VIOLATION";
  readonly constraint: string;

  constructor(params: { constraint: string; message?: string }, options?: SendoErrorOptions) {
    super(params.message ?? `The write violates "${params.constraint}".`, options);
    this.constraint = params.constraint;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { constraint: this.constraint };
  }
}

/** Invalid or missing configuration (e.g. two agents match one account, missing `appSecret`). */
export class ConfigError extends SendoError {
  readonly code = "CONFIG_ERROR";
}

export class NotImplementedError extends SendoError {
  readonly code = "NOT_IMPLEMENTED";
  readonly feature: string;

  constructor(feature: string, options?: SendoErrorOptions) {
    super(`${feature} is not implemented yet.`, options);
    this.feature = feature;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { feature: this.feature };
  }
}

/**
 * The actor may not do this (product spec AC-RL-2), or no actor could be resolved
 * (`resolveRole` missing or returned `null`). `capability` is `null` for visibility and
 * actor-resolution failures; `role` is `null` when there is no role.
 */
export class ForbiddenError extends SendoError {
  readonly code = "FORBIDDEN";
  readonly capability: Capability | null;
  readonly role: Role | null;

  constructor(
    params: { capability?: Capability | null; role?: Role | null; message?: string } = {},
    options?: SendoErrorOptions,
  ) {
    const capability = params.capability ?? null;
    const role = params.role ?? null;
    super(
      params.message ??
        (capability === null
          ? "You do not have access to this resource: the conversation belongs to another tenant, queue or person. Check `canSeeConversation(actor, conversation)` before showing it."
          : `Role "${role ?? "none"}" does not have the "${capability}" capability. Check \`can(actor, "${capability}")\` before calling, or give the user a role that has it.`),
      options,
    );
    this.capability = capability;
    this.role = role;
  }

  protected override toJSONFields(): Record<string, unknown> {
    return { capability: this.capability, role: this.role };
  }
}
