import type { Account, SourceCount, WhatsAppLink } from "@quami/sendo";

/** A number the link builder offers (no token reference or other server-only fields). */
export interface WidgetNumberView {
  id: string;
  label: string | null;
  displayPhone: string;
  isDefault: boolean;
}

export function serializeNumber(account: Account): WidgetNumberView {
  return {
    id: account.id,
    label: account.label,
    displayPhone: account.displayPhone,
    isDefault: account.isDefault,
  };
}

export type WidgetLinkView = WhatsAppLink;
export type WidgetSourceView = SourceCount;

export type WidgetsErrorCode = "FORBIDDEN" | "INVALID" | "NOT_FOUND" | "UNKNOWN";

/** `message` is the server's English detail (for logs); the screen shows `errorMessages[code]`. */
export type WidgetsActionResult<T> =
  { ok: true; data: T } | { ok: false; code: WidgetsErrorCode; message: string };

export interface CreateLinkInput {
  /** Account id (from `WidgetNumberView.id`). */
  account: string;
  text: string;
  source: string;
}

/** The server actions the links screen calls (`app/(protected)/inbox/links/actions.ts`). */
export interface LinksActions {
  createLink(input: CreateLinkInput): Promise<WidgetsActionResult<WidgetLinkView>>;
  /** Conversations per source; `account` = one number, omitted = every number of the tenant. */
  listSources(account?: string | null): Promise<WidgetsActionResult<WidgetSourceView[]>>;
}

/** Longest prefilled message the builder accepts (keeps the QR scannable on a printed sign). */
export const LINK_TEXT_MAX = 200;

/** Same rule as `LINK_SOURCE_RE` in `@quami/sendo` (validated again on the server). */
export const SOURCE_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * Turns what an admin types into a valid source: lowercase, accents removed, spaces and other
 * characters become `-`, at most 32 characters. "Garita Norte" → "garita-norte".
 */
export function toSourceSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "")
    .slice(0, 32);
}
