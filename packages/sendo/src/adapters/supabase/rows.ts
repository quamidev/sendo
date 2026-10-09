import type { Channel } from "../../channels/types";
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
  SendoEvent,
} from "../../types/entities";
import type {
  AgentMode,
  ConversationStatus,
  Direction,
  DownloadStatus,
  EventStatus,
  MessageStatus,
  MessageType,
  OnboardedVia,
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
  channel: Channel;
  label: string | null;
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone: string;
  token_ref: string;
  timezone: string;
  active: boolean;
  is_default: boolean;
  coexistence: boolean;
  onboarded_via: OnboardedVia;
  agent_paused: boolean;
  agent_mode: AgentMode | null;
  billing_ready: boolean | null;
  billing_checked_at: Timestamp | null;
  created_at: Timestamp;
}

export interface ContactRow {
  id: string;
  tenant_id: TenantId;
  account_id: string;
  channel: Channel;
  phone: string | null;
  channel_user_id: string | null;
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
  channel: Channel;
  status: ConversationStatus;
  source: string | null;
  assigned_to: string | null;
  assigned_at: Timestamp | null;
  handoff_reason: string | null;
  agent_paused: boolean;
  queue: string | null;
  ever_human: boolean;
  last_inbound_at: Timestamp | null;
  last_activity_at: Timestamp;
  window_expires_at: Timestamp | null;
  awaiting_reply_since: Timestamp | null;
  escalated_at: Timestamp | null;
  after_hours_notified_at: Timestamp | null;
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
  internal: boolean;
  draft: boolean;
  tokens_in: number | null;
  tokens_out: number | null;
  /** `numeric(12,4)`: PostgREST may return it as a string. */
  cost_cents: number | string | null;
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

/** `sendo_messages` row with the embedded `sendo_media` relation (newest first, limit 1). */
export type MessageWithMediaRow = MessageRow & { sendo_media?: MediaRow[] | MediaRow | null };

/** `sendo_conversations` row with the embedded contact and newest message (limit 1). */
export type ConversationListRow = ConversationRow & {
  sendo_contacts: ContactRow | ContactRow[] | null;
  sendo_messages?: MessageRow[] | MessageRow | null;
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
    channel: row.channel,
    label: row.label,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    displayPhone: row.display_phone,
    tokenRef: row.token_ref,
    timezone: row.timezone,
    active: row.active,
    isDefault: row.is_default,
    coexistence: row.coexistence,
    onboardedVia: row.onboarded_via,
    agentPaused: row.agent_paused,
    agentMode: row.agent_mode,
    billingReady: row.billing_ready,
    billingCheckedAt: toDateOrNull(row.billing_checked_at),
    createdAt: toDate(row.created_at),
  };
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    channel: row.channel,
    phone: row.phone,
    channelUserId: row.channel_user_id,
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
    channel: row.channel,
    status: row.status,
    source: row.source,
    assignedTo: row.assigned_to,
    assignedAt: toDateOrNull(row.assigned_at),
    handoffReason: row.handoff_reason,
    agentPaused: row.agent_paused,
    queue: row.queue,
    everHuman: row.ever_human,
    lastInboundAt: toDateOrNull(row.last_inbound_at),
    lastActivityAt: toDate(row.last_activity_at),
    windowExpiresAt: toDateOrNull(row.window_expires_at),
    awaitingReplySince: toDateOrNull(row.awaiting_reply_since),
    escalatedAt: toDateOrNull(row.escalated_at),
    afterHoursNotifiedAt: toDateOrNull(row.after_hours_notified_at),
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
    internal: row.internal,
    draft: row.draft,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costCents: row.cost_cents === null ? null : Number(row.cost_cents),
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
  const { sendo_media: media, ...message } = row;
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

export function toEvent(row: EventRow): SendoEvent {
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
  const { sendo_contacts: contact, sendo_messages: lastMessage, ...conversation } = row;
  const contactRow = firstOf(contact);
  if (!contactRow) throw new Error(`sendo_conversations ${row.id} has no contact`);
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
  if (patch.source !== undefined) row.source = patch.source;
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo;
  if (patch.assignedAt !== undefined) row.assigned_at = iso(patch.assignedAt);
  if (patch.handoffReason !== undefined) row.handoff_reason = patch.handoffReason;
  if (patch.agentPaused !== undefined) row.agent_paused = patch.agentPaused;
  if (patch.queue !== undefined) row.queue = patch.queue;
  if (patch.everHuman !== undefined) row.ever_human = patch.everHuman;
  if (patch.lastInboundAt !== undefined) row.last_inbound_at = iso(patch.lastInboundAt);
  if (patch.lastActivityAt !== undefined) row.last_activity_at = iso(patch.lastActivityAt);
  if (patch.windowExpiresAt !== undefined) row.window_expires_at = iso(patch.windowExpiresAt);
  if (patch.awaitingReplySince !== undefined) {
    row.awaiting_reply_since = iso(patch.awaitingReplySince);
  }
  if (patch.escalatedAt !== undefined) row.escalated_at = iso(patch.escalatedAt);
  if (patch.afterHoursNotifiedAt !== undefined) {
    row.after_hours_notified_at = iso(patch.afterHoursNotifiedAt);
  }
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
