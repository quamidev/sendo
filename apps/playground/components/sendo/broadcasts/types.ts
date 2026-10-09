import type {
  Account,
  BroadcastPreview,
  BroadcastRecipientView,
  BroadcastSkipReason,
  BroadcastView,
  Template,
} from "@quami/sendo";

// Type-only imports from the package: this file is shared by the server actions and the client
// screen, so the constants below are local copies of the package's enums.

/** `sendo_broadcasts.status`. */
export const BROADCAST_STATUS_ORDER = [
  "queued",
  "sending",
  "paused",
  "done",
  "cancelled",
  "failed",
] as const;
export type BroadcastStatusValue = (typeof BROADCAST_STATUS_ORDER)[number];

/** `sendo_broadcast_recipients.status`, in the order the progress view shows them. */
export const RECIPIENT_STATUS_ORDER = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUS_ORDER)[number];

export const SKIP_REASONS = ["no_opt_in", "opted_out", "invalid_phone"] as const;
export type SkipReason = BroadcastSkipReason;

/** `pauseReason` of a broadcast paused by Meta 131042 (no payment method). */
export const BILLING_PAUSE = "billing";

/** Broadcasts the tick still works on: the progress view polls them and offers "Cancelar". */
export function isActiveBroadcast(status: BroadcastStatusValue): boolean {
  return status === "queued" || status === "sending" || status === "paused";
}

/** A WhatsApp number of the tenant (no token reference or other server-only fields). */
export interface BroadcastNumberView {
  id: string;
  label: string | null;
  displayPhone: string;
  isDefault: boolean;
  active: boolean;
  /** `false` = Meta has no payment method for the number: a broadcast would pause right away. */
  billingReady: boolean | null;
}

export function serializeNumber(account: Account): BroadcastNumberView {
  return {
    id: account.id,
    label: account.label,
    displayPhone: account.displayPhone,
    isDefault: account.isDefault,
    active: account.active,
    billingReady: account.billingReady,
  };
}

export interface BroadcastTemplateView {
  id: string;
  name: string;
  language: string;
  category: Template["category"];
  variableCount: number;
  /** BODY text with `{{n}}` placeholders, for the preview. */
  body: string | null;
}

export function serializeTemplate(template: Template): BroadcastTemplateView {
  let body: string | null = null;
  for (const component of template.components) {
    if (component.type === "BODY" && typeof component.text === "string") {
      body = component.text;
      break;
    }
  }
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    variableCount: template.variableCount,
    body,
  };
}

/** A contact list or filter the app offers (`broadcastAudiences.list` in broadcasts-config.ts). */
export interface BroadcastAudienceView {
  id: string;
  label: string;
  description: string | null;
  /** Approximate number of contacts, when the app knows it cheaply. */
  size: number | null;
}

/** What the composer sends to `previewBroadcast` / `createBroadcast`. */
export interface BroadcastDraft {
  /** Account id (`BroadcastNumberView.id`). */
  account: string;
  template: string;
  language: string;
  /** `BroadcastAudienceView.id`; the server resolves it to recipients. */
  audience: string;
  /** Positional `{{1}}…{{n}}` values for everyone; `null` when the audience sets them per contact. */
  variables: string[] | null;
  ratePerMinute: number;
}

export interface BroadcastPreviewView {
  total: number;
  eligible: number;
  skipped: Record<SkipReason, number>;
  category: string;
  ratePerMinute: number;
  estimatedMinutes: number;
}

export function serializePreview(preview: BroadcastPreview): BroadcastPreviewView {
  return {
    total: preview.total,
    eligible: preview.eligible,
    skipped: { ...preview.skipped },
    category: preview.category,
    ratePerMinute: preview.ratePerMinute,
    estimatedMinutes: preview.estimatedMinutes,
  };
}

export type RecipientCounts = Record<RecipientStatus, number>;

export interface BroadcastSummaryView {
  id: string;
  accountId: string;
  templateName: string;
  language: string;
  category: string;
  status: BroadcastStatusValue;
  /** `billing` while paused for a missing payment method. */
  pauseReason: string | null;
  ratePerMinute: number;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: RecipientCounts;
}

export function serializeBroadcast(broadcast: BroadcastView): BroadcastSummaryView {
  return {
    id: broadcast.id,
    accountId: broadcast.accountId,
    templateName: broadcast.templateName,
    language: broadcast.language,
    category: broadcast.category,
    status: broadcast.status,
    pauseReason: broadcast.pauseReason,
    ratePerMinute: broadcast.ratePerMinute,
    createdBy: broadcast.createdBy,
    createdAt: broadcast.createdAt.toISOString(),
    startedAt: broadcast.startedAt?.toISOString() ?? null,
    finishedAt: broadcast.finishedAt?.toISOString() ?? null,
    counts: Object.fromEntries(
      RECIPIENT_STATUS_ORDER.map((status) => [status, broadcast.counts[status]]),
    ) as RecipientCounts,
  };
}

/** Meta's error on a failed recipient. */
export interface RecipientErrorView {
  code: number | null;
  title: string | null;
  message: string;
  details: string | null;
}

export interface BroadcastRecipientRowView {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  appRef: string | null;
  status: RecipientStatus;
  skipReason: string | null;
  error: RecipientErrorView | null;
  updatedAt: string;
}

export function serializeRecipient(recipient: BroadcastRecipientView): BroadcastRecipientRowView {
  const error = recipient.error;
  return {
    id: recipient.id,
    contactId: recipient.contactId,
    name: recipient.contact?.profileName ?? null,
    phone: recipient.contact?.phone ?? null,
    appRef: recipient.contact?.appRef ?? null,
    status: recipient.status,
    skipReason: recipient.skipReason,
    error:
      error === null
        ? null
        : {
            code: error.code ?? null,
            title: error.title ?? null,
            message: error.message,
            details: error.details ?? null,
          },
    updatedAt: recipient.updatedAt.toISOString(),
  };
}

export interface PageView<T> {
  items: T[];
  nextCursor: string | null;
}

export type BroadcastsErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "TEMPLATE"
  | "VARIABLES"
  | "INVALID"
  | "AUDIENCE"
  | "EMPTY_AUDIENCE"
  | "UNKNOWN";

export type BroadcastsActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: BroadcastsErrorCode;
      message: string;
      /** `VARIABLES`: how many variables the template needs. */
      expected?: number;
    };

export interface RecipientsQuery {
  status?: RecipientStatus | null;
  cursor?: string | null;
}

/** The server actions the screen calls (`app/(protected)/inbox/broadcasts/actions.ts`). */
export interface BroadcastsActions {
  /** Newest first, with counts. */
  listBroadcasts(
    cursor?: string | null,
  ): Promise<BroadcastsActionResult<PageView<BroadcastSummaryView>>>;
  getBroadcast(id: string): Promise<BroadcastsActionResult<BroadcastSummaryView>>;
  listRecipients(
    id: string,
    query?: RecipientsQuery,
  ): Promise<BroadcastsActionResult<PageView<BroadcastRecipientRowView>>>;
  /** APPROVED, active templates of one number. */
  listTemplates(accountId: string): Promise<BroadcastsActionResult<BroadcastTemplateView[]>>;
  /** The app's contact lists and filters for one number. */
  listAudiences(accountId: string): Promise<BroadcastsActionResult<BroadcastAudienceView[]>>;
  /** Counts only; writes nothing. */
  previewBroadcast(draft: BroadcastDraft): Promise<BroadcastsActionResult<BroadcastPreviewView>>;
  createBroadcast(draft: BroadcastDraft): Promise<BroadcastsActionResult<BroadcastSummaryView>>;
  cancelBroadcast(id: string): Promise<BroadcastsActionResult<BroadcastSummaryView>>;
}

/** Outside links the screen shows. Never copy Meta's rates: link to them. */
export interface BroadcastsLinks {
  /** Meta's official per-message pricing (rates by country and category). */
  metaPricing: string;
  /** Where the business adds a payment method (Meta Business Suite billing). */
  metaBilling: string;
}

export const DEFAULT_BROADCASTS_LINKS: BroadcastsLinks = {
  metaPricing: "https://developers.facebook.com/docs/whatsapp/pricing",
  metaBilling: "https://business.facebook.com/billing_hub/accounts",
};

/** Default send rate (the package's `DEFAULT_RATE_PER_MINUTE`). */
export const DEFAULT_RATE = 60;
/** Highest rate the form accepts; Meta's tier for the number may cap it lower. */
export const MAX_RATE = 1000;
/** Recipients per page in the progress view. */
export const RECIPIENTS_PAGE = 50;
