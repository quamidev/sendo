import type {
  Account,
  Contact,
  Conversation,
  JsonObject,
  Media,
  Message,
  MessageError,
  MessageWithMedia,
  Page,
  Template,
  TenantId,
  SendoEvent,
} from "../types/entities";
import type {
  ConversationStatus,
  DeliveryStatus,
  DownloadStatus,
  EventStatus,
  MessageType,
  OutboundSender,
  TemplateCategory,
  TemplateStatus,
} from "../types/enums";

// ---------- accounts ----------

export interface AccountListFilter {
  /** `null` matches accounts without a tenant; omitted matches every tenant. */
  tenantId?: TenantId;
  active?: boolean;
}

export interface AccountInsertInput {
  tenantId?: TenantId;
  phoneNumberId: string;
  wabaId: string;
  displayPhone: string;
  tokenRef: string;
  /** Default `America/Guatemala`. */
  timezone?: string;
  /** Default `true`. */
  active?: boolean;
}

// ---------- contacts ----------

export interface ContactUpsertInput {
  accountId: string;
  tenantId: TenantId;
  /** E.164 (already normalized). Unique per account. */
  phone: string;
  /** `undefined`/`null` keeps the stored value. */
  waId?: string | null;
  /** `undefined`/`null` keeps the stored value. */
  profileName?: string | null;
}

export interface ContactUpsertResult {
  contact: Contact;
  created: boolean;
  /** `true` when an existing contact got a different non-null `profileName`. `false` on create. */
  profileChanged: boolean;
}

// ---------- conversations ----------

export interface GetOpenOrCreateInput {
  contactId: string;
  accountId: string;
  tenantId: TenantId;
}

export interface GetOpenOrCreateResult {
  conversation: Conversation;
  /** A new row was created (the contact had no conversation on this account). */
  created: boolean;
  /**
   * The most recent `closed` conversation was reopened: status `agent`,
   * `assignedTo` and `handoffReason` cleared.
   */
  reopened: boolean;
}

export type ConversationPatch = Partial<
  Pick<
    Conversation,
    | "status"
    | "assignedTo"
    | "handoffReason"
    | "lastInboundAt"
    | "lastActivityAt"
    | "windowExpiresAt"
    | "unreadCount"
  >
> & {
  /** Atomically adds to `unreadCount` (applied after `unreadCount` if both are given). */
  incrementUnread?: number;
};

export interface ConversationListQuery {
  /** `null` matches conversations without a tenant; omitted matches every tenant. */
  tenantId?: TenantId;
  accountId?: string;
  status?: ConversationStatus | ConversationStatus[];
  /** `null` matches unassigned conversations. */
  assignedTo?: string | null;
  cursor?: string | null;
  limit: number;
}

export type ConversationListItem = Conversation & {
  contact: Contact;
  /** Newest non-placeholder message, or `null`. */
  lastMessage: Message | null;
};

// ---------- messages ----------

interface MessageInsertBase {
  tenantId: TenantId;
  conversationId: string;
  type: Exclude<MessageType, "status_placeholder">;
  content: JsonObject;
  text?: string | null;
  replyToMetaId?: string | null;
  metadata?: JsonObject;
}

/** Stored with `direction "in"`, `status "received"`, `sender "contact"`. */
export interface InsertInboundMessageInput extends MessageInsertBase {
  metaMessageId: string;
  /** Meta's message timestamp; stored as `sentAt`. */
  sentAt: Date;
}

/** Stored with `direction "out"`, `status "pending"`, `metaMessageId null`. */
export interface InsertOutboundMessageInput extends MessageInsertBase {
  sender: OutboundSender;
  /** Agent name or user id. */
  senderRef?: string | null;
}

export interface UpdateStatusOptions {
  /** Recorded when the status is `failed`. */
  error?: MessageError;
  /** Meta's status timestamp. Sets `sentAt` on `sent` when it is still null. */
  at?: Date;
}

/**
 * - `updated`: the message existed and the status moved forward.
 * - `ignored`: the message existed but `canTransition` rejected the change.
 * - `placeholder`: no message had that Meta id; a placeholder now holds the highest status.
 */
export type StatusUpdateResult = "updated" | "ignored" | "placeholder";

export interface ThreadQuery {
  cursor?: string | null;
  limit: number;
}

// ---------- media ----------

export interface MediaInsertInput {
  tenantId: TenantId;
  messageId: string;
  metaMediaId?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  storagePath?: string | null;
  /** Default `pending`. */
  downloadStatus?: DownloadStatus;
}

export type MediaPatch = Partial<
  Pick<Media, "mimeType" | "sizeBytes" | "sha256" | "storagePath" | "downloadStatus">
>;

// ---------- templates ----------

export interface TemplateUpsertInput {
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: JsonObject[];
  variableCount: number;
  /** Default: now. */
  syncedAt?: Date;
}

export interface TemplateKey {
  name: string;
  language: string;
}

export interface TemplateListQuery {
  accountId?: string;
  status?: TemplateStatus;
  /** Omitted returns active and inactive templates. */
  active?: boolean;
}

// ---------- events, storage, health ----------

export interface EventInsertInput {
  payload: unknown;
}

export interface HealthCheckResult {
  tablesOk: boolean;
  /** Missing table names, e.g. `["sendo_locks"]`. */
  missing: string[];
}

/**
 * Storage port for sendo. Every method is async. Methods that update a record by
 * id throw `RecordNotFoundError` when it does not exist; `get`-style methods
 * return `null`. Placeholders (`type "status_placeholder"`) are adapter-internal
 * and never returned by `messages.*` reads or `conversations.list`.
 */
export interface SendoAdapter {
  accounts: {
    getByPhoneNumberId(phoneNumberId: string): Promise<Account | null>;
    getById(id: string): Promise<Account | null>;
    /** Ordered by `createdAt` ascending. */
    list(filter?: AccountListFilter): Promise<Account[]>;
    /** Throws `DuplicateAccountError` when `phoneNumberId` already exists. */
    insert(input: AccountInsertInput): Promise<Account>;
  };

  contacts: {
    /** Upsert by `(accountId, phone)`. */
    upsert(input: ContactUpsertInput): Promise<ContactUpsertResult>;
    get(id: string): Promise<Contact | null>;
    setAppRef(id: string, appRef: string | null): Promise<Contact>;
  };

  conversations: {
    /**
     * Returns the contact's open (`agent`/`human`) conversation on the account,
     * else reopens its most recent `closed` one, else creates one with status `agent`.
     */
    getOpenOrCreate(input: GetOpenOrCreateInput): Promise<GetOpenOrCreateResult>;
    get(id: string): Promise<Conversation | null>;
    update(id: string, patch: ConversationPatch): Promise<Conversation>;
    /** Sorted by `lastActivityAt` descending (ties by `id`). */
    list(query: ConversationListQuery): Promise<Page<ConversationListItem>>;
  };

  messages: {
    /** Returns `null` (and writes nothing) when `metaMessageId` already exists. */
    insertInbound(input: InsertInboundMessageInput): Promise<Message | null>;
    insertOutbound(input: InsertOutboundMessageInput): Promise<Message>;
    /**
     * Sets `metaMessageId`, status `sent` and `sentAt`. When a placeholder holds that
     * Meta id, applies its status/error with the forward-only rule and deletes it.
     */
    markSent(id: string, metaMessageId: string): Promise<Message>;
    /** Sets status `failed` and `error` (a failed send). */
    markFailed(id: string, error: MessageError): Promise<Message>;
    /** Forward-only (`canTransition`), atomic. */
    updateStatus(
      metaMessageId: string,
      status: DeliveryStatus,
      opts?: UpdateStatusOptions,
    ): Promise<StatusUpdateResult>;
    get(id: string): Promise<MessageWithMedia | null>;
    getByMetaId(metaMessageId: string): Promise<MessageWithMedia | null>;
    /** The last `limit` messages, returned oldest first. */
    history(conversationId: string, limit: number): Promise<MessageWithMedia[]>;
    /** Items newest first; `nextCursor` loads older messages. */
    thread(conversationId: string, query: ThreadQuery): Promise<Page<MessageWithMedia>>;
    /** Inbound messages of the contact (any conversation) with `createdAt >= since`. */
    countInboundSince(contactId: string, since: Date): Promise<number>;
    /** Shallow-merges `patch` into `metadata`. */
    updateMetadata(id: string, patch: JsonObject): Promise<Message>;
  };

  media: {
    insert(input: MediaInsertInput): Promise<Media>;
    update(id: string, patch: MediaPatch): Promise<Media>;
  };

  templates: {
    /** Upsert by `(accountId, name, language)`; sets `active: true`. */
    upsertMany(accountId: string, templates: TemplateUpsertInput[]): Promise<Template[]>;
    /** Sets `active: false` on the account's templates not in `keep`. Returns how many changed. */
    markInactiveExcept(accountId: string, keep: TemplateKey[]): Promise<number>;
    list(query?: TemplateListQuery): Promise<Template[]>;
    get(accountId: string, name: string, language: string): Promise<Template | null>;
  };

  events: {
    /** Stored with status `received`. */
    insert(input: EventInsertInput): Promise<SendoEvent>;
    /** Sets `processedAt` for any status other than `received`; `error` replaces the stored one. */
    setStatus(id: string, status: EventStatus, error?: string | null): Promise<SendoEvent>;
    get(id: string): Promise<SendoEvent | null>;
    /** Deletes events with `receivedAt < olderThan`; returns the count. */
    prune(olderThan: Date): Promise<number>;
  };

  locks: {
    /** Atomic. Succeeds when the key is free or its lock expired. */
    acquire(key: string, ttlMs: number): Promise<boolean>;
    release(key: string): Promise<void>;
  };

  storage: {
    put(path: string, bytes: Uint8Array, mime: string): Promise<void>;
    get(path: string): Promise<Uint8Array | null>;
    signedUrl(path: string, ttlSec: number): Promise<string>;
    bucketExists(): Promise<boolean>;
  };

  /** `sendo_schema_meta.version`, or `null` when the tables are missing. */
  schemaVersion(): Promise<number | null>;
  healthCheck(): Promise<HealthCheckResult>;
}

/** Tables `healthCheck` expects. */
export const SENDO_TABLES = [
  "sendo_accounts",
  "sendo_contacts",
  "sendo_conversations",
  "sendo_messages",
  "sendo_media",
  "sendo_templates",
  "sendo_events",
  "sendo_locks",
  "sendo_schema_meta",
] as const;
export type SendoTable = (typeof SENDO_TABLES)[number];
