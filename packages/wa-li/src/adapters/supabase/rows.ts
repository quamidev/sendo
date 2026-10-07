import type {
  Account,
  Contact,
  Conversation,
  JsonObject,
  Media,
  Message,
  MessageError,
  MessageWithMedia,
  Template,
  TenantId,
  WaEvent,
} from "../../types/entities";
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
} from "../../types/enums";
import type { ConversationListItem, ConversationPatch, MediaPatch } from "../types";

/** PostgREST returns timestamptz as ISO strings. */
type Timestamp = string;

export interface AccountRow {
  id: string;
  tenant_id: TenantId;
  phone_number_id: string;
  waba_id: string;
  display_phone: string;
  token_ref: string;
  timezone: string;
  active: boolean;
  created_at: Timestamp;
}

export interface ContactRow {
  id: string;
  tenant_id: TenantId;
  account_id: string;
  phone: string;
  wa_id: string | null;
  profile_name: string | null;
  app_ref: string | null;
  marketing_opt_in: boolean;
  opt_in_at: Timestamp | null;
  created_at?: Timestamp;
}

export interface ConversationRow {
  id: string;
  tenant_id: TenantId;
  account_id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_to: string | null;
  handoff_reason: string | null;
  last_inbound_at: Timestamp | null;
  last_activity_at: Timestamp;
  window_expires_at: Timestamp | null;
  unread_count: number;
  created_at: Timestamp;
}

export interface MessageRow {
  id: string;
  tenant_id: TenantId;
  /** `null` only for adapter-internal placeholders. */
  conversation_id: string | null;
  direction: Direction;
  type: MessageType;
  content: JsonObject | null;
  text: string | null;
  meta_message_id: string | null;
  reply_to_meta_id: string | null;
  status: MessageStatus;
  error: MessageError | null;
  sender: Sender;
  sender_ref: string | null;
  metadata: JsonObject | null;
  sent_at: Timestamp | null;
  created_at: Timestamp;
}

export interface MediaRow {
  id: string;
  tenant_id: TenantId;
  message_id: string;
  meta_media_id: string | null;
  mime_type: string | null;
  size_bytes: number | string | null;
  sha256: string | null;
  storage_path: string | null;
  download_status: DownloadStatus;
  created_at?: Timestamp;
}

export interface TemplateRow {
  id: string;
  tenant_id?: TenantId;
  account_id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: JsonObject[] | null;
  variable_count: number;
  active: boolean;
  synced_at: Timestamp;
}

export interface EventRow {
  id: string;
  tenant_id?: TenantId;
  received_at: Timestamp;
  payload: unknown;
  status: EventStatus;
  error: string | null;
  processed_at: Timestamp | null;
}

/** `wa_messages` row with the embedded `wa_media` relation (newest first, limit 1). */
export type MessageWithMediaRow = MessageRow & { wa_media?: MediaRow[] | MediaRow | null };

/** `wa_conversations` row with the embedded contact and newest message (limit 1). */
export type ConversationListRow = ConversationRow & {
  wa_contacts: ContactRow | ContactRow[] | null;
  wa_messages?: MessageRow[] | MessageRow | null;
};

const toDate = (value: Timestamp): Date => new Date(value);
const toDateOrNull = (value: Timestamp | null): Date | null =>
  value === null ? null : new Date(value);

/** Embedded relations come back as arrays (to-many) or objects (to-one). */
export function firstOf<T>(value: T[] | T | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhone: row.display_phone,
    tokenRef: row.token_ref,
    timezone: row.timezone,
    active: row.active,
    createdAt: toDate(row.created_at),
  };
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    phone: row.phone,
    waId: row.wa_id,
    profileName: row.profile_name,
    appRef: row.app_ref,
    marketingOptIn: row.marketing_opt_in,
    optInAt: toDateOrNull(row.opt_in_at),
  };
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    contactId: row.contact_id,
    status: row.status,
    assignedTo: row.assigned_to,
    handoffReason: row.handoff_reason,
    lastInboundAt: toDateOrNull(row.last_inbound_at),
    lastActivityAt: toDate(row.last_activity_at),
    windowExpiresAt: toDateOrNull(row.window_expires_at),
    unreadCount: row.unread_count,
    createdAt: toDate(row.created_at),
  };
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id ?? "",
    direction: row.direction,
    type: row.type,
    content: row.content ?? {},
    text: row.text,
    metaMessageId: row.meta_message_id,
    replyToMetaId: row.reply_to_meta_id,
    status: row.status,
    error: row.error,
    sender: row.sender,
    senderRef: row.sender_ref,
    metadata: row.metadata ?? {},
    sentAt: toDateOrNull(row.sent_at),
    createdAt: toDate(row.created_at),
  };
}

export function toMedia(row: MediaRow): Media {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    messageId: row.message_id,
    metaMediaId: row.meta_media_id,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    sha256: row.sha256,
    storagePath: row.storage_path,
    downloadStatus: row.download_status,
  };
}

export function toMessageWithMedia(row: MessageWithMediaRow): MessageWithMedia {
  const { wa_media: media, ...message } = row;
  const first = firstOf(media);
  return { ...toMessage(message), media: first ? toMedia(first) : null };
}

export function toTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    components: row.components ?? [],
    variableCount: row.variable_count,
    active: row.active,
    syncedAt: toDate(row.synced_at),
  };
}

export function toEvent(row: EventRow): WaEvent {
  return {
    id: row.id,
    receivedAt: toDate(row.received_at),
    payload: row.payload,
    status: row.status,
    error: row.error,
    processedAt: toDateOrNull(row.processed_at),
  };
}

export function toConversationListItem(row: ConversationListRow): ConversationListItem {
  const { wa_contacts: contact, wa_messages: lastMessage, ...conversation } = row;
  const contactRow = firstOf(contact);
  if (!contactRow) throw new Error(`wa_conversations ${row.id} has no contact`);
  const messageRow = firstOf(lastMessage);
  return {
    ...toConversation(conversation),
    contact: toContact(contactRow),
    lastMessage: messageRow ? toMessage(messageRow) : null,
  };
}

/** Columns of the camelCase conversation patch mapped to snake_case (undefined skipped). */
export function conversationPatchToRow(
  patch: Omit<ConversationPatch, "incrementUnread">,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo;
  if (patch.handoffReason !== undefined) row.handoff_reason = patch.handoffReason;
  if (patch.lastInboundAt !== undefined) row.last_inbound_at = iso(patch.lastInboundAt);
  if (patch.lastActivityAt !== undefined) row.last_activity_at = iso(patch.lastActivityAt);
  if (patch.windowExpiresAt !== undefined) row.window_expires_at = iso(patch.windowExpiresAt);
  if (patch.unreadCount !== undefined) row.unread_count = patch.unreadCount;
  return row;
}

/** Media patch mapped to snake_case (undefined skipped). */
export function mediaPatchToRow(patch: MediaPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.mimeType !== undefined) row.mime_type = patch.mimeType;
  if (patch.sizeBytes !== undefined) row.size_bytes = patch.sizeBytes;
  if (patch.sha256 !== undefined) row.sha256 = patch.sha256;
  if (patch.storagePath !== undefined) row.storage_path = patch.storagePath;
  if (patch.downloadStatus !== undefined) row.download_status = patch.downloadStatus;
  return row;
}
