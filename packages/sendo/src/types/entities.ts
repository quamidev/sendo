import type { Channel } from "../channels/types";
import type { RuleType } from "../rules/schemas";
import type {
  AgentMode,
  BroadcastRecipientStatus,
  BroadcastStatus,
  ConversationStatus,
  Direction,
  DownloadStatus,
  EventStatus,
  MessageStatus,
  MessageType,
  OnboardedVia,
  RuleOrigin,
  Sender,
  SnippetVisibility,
  TagColor,
  TemplateCategory,
  TemplateStatus,
} from "./enums";

/** `null` means a single-tenant app (no tenant). */
export type TenantId = string | null;

/** JSON-serializable object stored in a `jsonb` column. */
export type JsonObject = Record<string, unknown>;

/** Any JSON value stored in a `jsonb` column (object, array, string, number, boolean). */
export type JsonValue = JsonObject | unknown[] | string | number | boolean;

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or `null` when there are no more items. */
  nextCursor: string | null;
}

export interface Account {
  id: string;
  tenantId: TenantId;
  channel: Channel;
  /** Human label shown in the UI (e.g. "Recepción"). */
  label: string | null;
  /** Meta phone number id. Always set for `whatsapp` accounts. */
  phoneNumberId: string | null;
  /** WhatsApp Business Account id. Always set for `whatsapp` accounts. */
  wabaId: string | null;
  displayPhone: string;
  /** Name of the env var or secret that holds the token. Never the token itself. */
  tokenRef: string;
  /** IANA timezone, default `America/Guatemala`. */
  timezone: string;
  active: boolean;
  /** At most one default account per tenant (accounts without a tenant share one). */
  isDefault: boolean;
  /** The number is also used from the WhatsApp Business app. */
  coexistence: boolean;
  onboardedVia: OnboardedVia;
  /** The agent never replies on this account while `true`. */
  agentPaused: boolean;
  /** Overrides the agent's own mode; `null` keeps it. */
  agentMode: AgentMode | null;
  /** `null` until a billing check ran. */
  billingReady: boolean | null;
  billingCheckedAt: Date | null;
  createdAt: Date;
}

export interface Contact {
  id: string;
  tenantId: TenantId;
  accountId: string;
  channel: Channel;
  /** E.164, e.g. `+50255551234`. Unique per account; `null` only when `channelUserId` is set. */
  phone: string | null;
  /** The channel's own user id (channels without phone numbers). Unique per account. */
  channelUserId: string | null;
  waId: string | null;
  profileName: string | null;
  /** The app's own entity ID (user, patient, resident). */
  appRef: string | null;
  marketingOptIn: boolean;
  optInAt: Date | null;
}

export interface Conversation {
  id: string;
  tenantId: TenantId;
  accountId: string;
  contactId: string;
  channel: Channel;
  status: ConversationStatus;
  /** Attribution (link code, referral...), set once on the first message. */
  source: string | null;
  assignedTo: string | null;
  /** When `assignedTo` last changed to a user. */
  assignedAt: Date | null;
  handoffReason: string | null;
  /** The agent never replies in this conversation while `true`. */
  agentPaused: boolean;
  queue: string | null;
  /** `true` once the conversation was ever in `human`. */
  everHuman: boolean;
  lastInboundAt: Date | null;
  lastActivityAt: Date;
  windowExpiresAt: Date | null;
  /** First unanswered inbound; cleared by a non-internal reply from a human or the agent. */
  awaitingReplySince: Date | null;
  escalatedAt: Date | null;
  afterHoursNotifiedAt: Date | null;
  unreadCount: number;
  createdAt: Date;
}

/** Error recorded on a failed message (from a Meta status webhook or a failed send). */
export interface MessageError {
  /** Meta error code (e.g. 131047), when known. */
  code?: number;
  subcode?: number;
  title?: string;
  message: string;
  details?: string;
  fbtraceId?: string;
}

export interface Message {
  id: string;
  tenantId: TenantId;
  conversationId: string;
  direction: Direction;
  type: MessageType;
  /** Type-specific content (Meta-shaped, camelCase not required). */
  content: JsonObject;
  /** Denormalized body for search and previews (text body, caption, button title...). */
  text: string | null;
  metaMessageId: string | null;
  replyToMetaId: string | null;
  status: MessageStatus;
  error: MessageError | null;
  sender: Sender;
  /** Agent name or user ID. */
  senderRef: string | null;
  metadata: JsonObject;
  /** Team note: never sent to the contact. Mutually exclusive with `draft`. */
  internal: boolean;
  /** Agent reply waiting for human approval. Mutually exclusive with `internal`. */
  draft: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Model cost in cents (4 decimals). */
  costCents: number | null;
  /** Inbound: Meta timestamp. Outbound: when Meta accepted the send. */
  sentAt: Date | null;
  createdAt: Date;
}

export interface Media {
  id: string;
  tenantId: TenantId;
  messageId: string;
  metaMediaId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  storagePath: string | null;
  downloadStatus: DownloadStatus;
}

export type MessageWithMedia = Message & { media: Media | null };

export interface Template {
  id: string;
  accountId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  /** Raw Meta template components. */
  components: JsonObject[];
  variableCount: number;
  /** `false` once the template disappeared from Meta on a sync (`markInactiveExcept`). */
  active: boolean;
  syncedAt: Date;
}

export interface SendoEvent {
  id: string;
  receivedAt: Date;
  payload: unknown;
  status: EventStatus;
  error: string | null;
  processedAt: Date | null;
}

export interface WindowStatus {
  open: boolean;
  /** `null` when the contact never wrote (window never opened). */
  expiresAt: Date | null;
}

/** A quick reply (`sendo_snippets`). Body variables are `{{name}}`. */
export interface Snippet {
  id: string;
  tenantId: TenantId;
  /** Limits the snippet to one account; `null` = every account of the tenant. */
  accountId: string | null;
  /** `^[a-z0-9_-]{1,32}$`, typed after `/` in the composer. */
  shortcut: string;
  body: string;
  visibility: SnippetVisibility;
  /** The app user id owning a `personal` snippet; `null` for `tenant` snippets. */
  ownerUserId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A conversation label (`sendo_tags`). Names are unique per tenant, ignoring case. */
export interface Tag {
  id: string;
  tenantId: TenantId;
  name: string;
  color: TagColor;
  createdAt: Date;
}

/**
 * A workflow rule as stored (`sendo_rules`). `params` is raw JSON: validate it with the
 * zod schema of `type` (`rules/schemas.ts`) before use.
 */
export interface StoredRule {
  id: string;
  tenantId: TenantId;
  /** Limits the rule to one account; `null` = every account of the tenant. */
  accountId: string | null;
  /** Stable id from code or the rules screen; unique per tenant. */
  key: string;
  type: RuleType;
  params: JsonObject;
  /** Evaluation order, ascending. */
  position: number;
  active: boolean;
  origin: RuleOrigin;
  /** Engine bookkeeping (e.g. the round-robin cursor), see `rules.patchState`. */
  state: JsonObject;
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * A template sent to many contacts (`sendo_broadcasts`). The tick sends its pending
 * recipients at `ratePerMinute`.
 */
export interface Broadcast {
  id: string;
  tenantId: TenantId;
  accountId: string;
  templateName: string;
  language: string;
  /** The template's category when the broadcast was created (decides eligibility). */
  category: TemplateCategory;
  /** Variables shared by every recipient (a recipient's own `variables` win). */
  variables: JsonValue | null;
  ratePerMinute: number;
  status: BroadcastStatus;
  /** Why it is `paused` (e.g. `billing`); `null` otherwise. */
  pauseReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** One contact of a broadcast and its send result (`sendo_broadcast_recipients`). */
export interface BroadcastRecipient {
  id: string;
  tenantId: TenantId;
  broadcastId: string;
  contactId: string;
  /** This recipient's template variables; `null` uses the broadcast's. */
  variables: JsonValue | null;
  /** The sent template message (status webhooks find the recipient through it). */
  messageId: string | null;
  status: BroadcastRecipientStatus;
  /** Why it was `skipped` (e.g. `no_opt_in`, `opted_out`, `invalid_phone`). */
  skipReason: string | null;
  /** Meta's error when `failed`. */
  error: MessageError | null;
  updatedAt: Date;
}
