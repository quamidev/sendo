import type {
  ConversationStatus,
  Direction,
  DownloadStatus,
  EventStatus,
  MessageStatus,
  MessageType,
  Sender,
  TemplateCategory,
  TemplateStatus,
} from "./enums";

/** `null` means a single-tenant app (no tenant). */
export type TenantId = string | null;

/** JSON-serializable object stored in a `jsonb` column. */
export type JsonObject = Record<string, unknown>;

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or `null` when there are no more items. */
  nextCursor: string | null;
}

export interface Account {
  id: string;
  tenantId: TenantId;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  /** Name of the env var or secret that holds the token. Never the token itself. */
  tokenRef: string;
  /** IANA timezone, default `America/Guatemala`. */
  timezone: string;
  active: boolean;
  createdAt: Date;
}

export interface Contact {
  id: string;
  tenantId: TenantId;
  accountId: string;
  /** E.164, e.g. `+50255551234`. */
  phone: string;
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
  status: ConversationStatus;
  assignedTo: string | null;
  handoffReason: string | null;
  lastInboundAt: Date | null;
  lastActivityAt: Date;
  windowExpiresAt: Date | null;
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
