import type { SourceCount } from "../adapters/types";
import type { SendoContext } from "../core/context";
import { InvalidPhoneError, PayloadValidationError } from "../errors/errors";
import { assertCan, type Actor } from "../team/permissions";
import type { Account, TenantId } from "../types/entities";

/** A source label: lowercase letters, digits and `-`, 1 to 32 characters (`garita`, `factura-2`). */
export const LINK_SOURCE_RE = /^[a-z0-9-]{1,32}$/;

export interface CreateLinkInput {
  /** Account id or Meta phone number id (resolved like `send.*`). */
  account?: string;
  /** The tenant's default number when `account` is omitted. */
  tenant?: TenantId;
  /** Prefilled message; ` [#source]` is appended. */
  text?: string;
  /** `^[a-z0-9-]{1,32}$`. */
  source: string;
}

export interface WhatsAppLink {
  /** `https://wa.me/<digits>?text=<encoded text + " [#source]">`. */
  url: string;
  /** The visible code at the end of the prefilled text, e.g. `[#garita]`. */
  code: string;
  /** The number the link opens, E.164 (`+50255551234`). */
  phone: string;
  /** The full prefilled text (`text` plus the code), as the contact will send it. */
  text: string;
}

export interface BuildWhatsAppLinkInput {
  /** Any format; everything but the digits is dropped (`+502 5555-1234` → `50255551234`). */
  phone: string;
  text?: string;
  source: string;
}

export interface LinkSourcesInput {
  /** Needs `numbers.manage` (admin). Scopes the counts to the actor's tenant. */
  actor: Actor;
  /** Only this number (account id or phone number id, must belong to the tenant). */
  account?: string;
  /** Conversations created at or after `from`. */
  from?: Date;
  /** Conversations created before `to`. */
  to?: Date;
}

/** `sendo.links` (SND-3.8). */
export interface LinksApi {
  /**
   * A click-to-chat link whose prefilled text ends with `[#source]`. Reads the account, writes
   * nothing. The pipeline turns the code of a new conversation's first message into
   * `conversation.source`.
   */
  create(input: CreateLinkInput): Promise<WhatsAppLink>;
  /**
   * Conversations per source in the actor's tenant (`source: null` = direct), most first.
   * Admin only (`numbers.manage`).
   */
  sources(input: LinkSourcesInput): Promise<SourceCount[]>;
}

function assertSource(source: unknown): asserts source is string {
  if (typeof source !== "string" || !LINK_SOURCE_RE.test(source)) {
    throw new PayloadValidationError({
      field: "source",
      message: "must be 1-32 lowercase letters, digits or '-' (^[a-z0-9-]{1,32}$)",
      limit: 32,
    });
  }
}

/** E.164 allows at most 15 digits; shorter than 7 is never a dialable WhatsApp number. */
function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new InvalidPhoneError({ input: phone, reason: "expected 7 to 15 digits" });
  }
  return digits;
}

/**
 * Pure `wa.me` link builder (no account lookup). `sendo.links.create` uses it after resolving
 * the account; use it directly when you already know the number.
 */
export function buildWhatsAppLink(input: BuildWhatsAppLinkInput): WhatsAppLink {
  assertSource(input.source);
  if (input.text !== undefined && typeof input.text !== "string") {
    throw new PayloadValidationError({ field: "text", message: "must be a string" });
  }
  const digits = phoneDigits(input.phone);
  const code = `[#${input.source}]`;
  const body = input.text?.trim() ?? "";
  const text = body === "" ? code : `${body} ${code}`;
  return {
    url: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
    code,
    phone: `+${digits}`,
    text,
  };
}

function linkForAccount(account: Account, input: CreateLinkInput): WhatsAppLink {
  return buildWhatsAppLink({ phone: account.displayPhone, text: input.text, source: input.source });
}

/** `SENDO_MODULES` entry. */
export function installLinks(ctx: SendoContext): void {
  ctx.slots.links = {
    async create(input) {
      assertSource(input.source);
      await ctx.ready();
      const account = await ctx.resolveAccount({
        ...(input.account !== undefined && { account: input.account }),
        ...(input.tenant !== undefined && { tenant: input.tenant }),
      });
      return linkForAccount(account, input);
    },

    async sources(input) {
      assertCan(input.actor, "numbers.manage");
      await ctx.ready();
      const tenantId = input.actor.tenantId;
      const accountId =
        input.account === undefined
          ? undefined
          : (await ctx.resolveAccount({ account: input.account, tenant: tenantId })).id;
      return ctx.adapter.conversations.countBySource({
        tenantId,
        ...(accountId !== undefined && { accountId }),
        ...(input.from !== undefined && { from: input.from }),
        ...(input.to !== undefined && { to: input.to }),
      });
    },
  };
}
