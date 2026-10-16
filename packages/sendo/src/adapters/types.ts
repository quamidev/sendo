import type { MediaStore } from "../media/types";
import type { Channel } from "../channels/types";
import type { RuleType } from "../rules/schemas";
import type {
  Account,
  Broadcast,
  BroadcastRecipient,
  Contact,
  Conversation,
  JsonObject,
  JsonValue,
  Media,
  Message,
  MessageError,
  MessageWithMedia,
  Page,
  Snippet,
  StoredRule,
  Tag,
  Template,
  TenantId,
  SendoEvent,
} from "../types/entities";
import type {
  AgentMode,
  BroadcastRecipientStatus,
  BroadcastStatus,
  ConversationStatus,
  DeliveryStatus,
  DownloadStatus,
  EventStatus,
  MessageType,
  OnboardedVia,
  OutboundSender,
  RuleOrigin,
  SnippetVisibility,
  TagColor,
  TemplateCategory,
  TemplateStatus,
} from "../types/enums";

// ---------- accounts ----------

export interface AccountListFilter {
  /** `null` matches accounts without a tenant; omitted matches every tenant. */
  tenantId?: TenantId;
  active?: boolean;
}

/**
 * Constraints (`ConstraintViolationError`): a `whatsapp` account needs `phoneNumberId` and
 * `wabaId` (`sendo_accounts_whatsapp_ids`); at most one `isDefault` account per tenant, `null`
 * tenant included (`sendo_accounts_default_per_tenant`).
 */
export interface AccountInsertInput {
  tenantId?: TenantId;
  /** Default `whatsapp`. */
  channel?: Channel;
  label?: string | null;
  phoneNumberId?: string | null;
  wabaId?: string | null;
  displayPhone: string;
  tokenRef: string;
  /** Default `America/Guatemala`. */
  timezone?: string;
  /** Default `true`. */
  active?: boolean;
  /** Default `false`. */
  isDefault?: boolean;
  /** Default `false`. */
  coexistence?: boolean;
  /** Default `manual`. */
  onboardedVia?: OnboardedVia;
  /** Default `false`. */
  agentPaused?: boolean;
  /** Default `null` (the agent's own mode). */
  agentMode?: AgentMode | null;
  /** Default `null` (unknown). */
  billingReady?: boolean | null;
  billingCheckedAt?: Date | null;
}

/**
 * Fields `accounts.update` may change. `isDefault` can only be cleared here; making an account
 * the default goes through `accounts.setDefault` (atomic swap).
 */
export type AccountPatch = Partial<
  Pick<
    Account,
    | "label"
    | "active"
    | "agentPaused"
    | "agentMode"
    | "billingReady"
    | "billingCheckedAt"
    | "coexistence"
    | "tokenRef"
  >
> & { isDefault?: false };

export interface AccountPurgeResult {
  /** `storagePath` of every media row that was deleted with the account (to delete from storage). */
  storagePaths: string[];
}

// ---------- contacts ----------

/**
 * Identity: keyed on `(accountId, phone)` when `phone` is set, else on
 * `(accountId, channelUserId)`. Neither → `ConstraintViolationError`
 * (`sendo_contacts_identity`); a `channelUserId` already used by another contact of the
 * account → `ConstraintViolationError` (`sendo_contacts_account_id_channel_user_id_key`).
 */
export interface ContactUpsertInput {
  accountId: string;
  tenantId: TenantId;
  /** Default `whatsapp`; only used on create. */
  channel?: Channel;
  /** E.164 (already normalized). Unique per account. */
  phone?: string | null;
  /** The channel's user id. Unique per account. `undefined`/`null` keeps the stored value. */
  channelUserId?: string | null;
  /** `undefined`/`null` keeps the stored value. */
  waId?: string | null;
  /** `undefined`/`null` keeps the stored value. */
  profileName?: string | null;
}

export interface ContactOptInInput {
  marketingOptIn: boolean;
  /** When the contact opted in or out (`null` = never decided). */
  optInAt: Date | null;
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
  /** Default `whatsapp`; only used on create. */
  channel?: Channel;
}

export interface GetOpenOrCreateResult {
  conversation: Conversation;
  /** A new row was created (the contact had no conversation on this account). */
  created: boolean;
  /**
   * The most recent `closed` conversation was reopened: status `agent`,
   * `assignedTo`, `assignedAt` and `handoffReason` cleared.
   */
  reopened: boolean;
}

export type ConversationPatch = Partial<
  Pick<
    Conversation,
    | "status"
    | "source"
    | "assignedTo"
    | "assignedAt"
    | "handoffReason"
    | "agentPaused"
    | "queue"
    | "everHuman"
    | "lastInboundAt"
    | "lastActivityAt"
    | "windowExpiresAt"
    | "awaitingReplySince"
    | "escalatedAt"
    | "afterHoursNotifiedAt"
    | "unreadCount"
  >
> & {
  /** Atomically adds to `unreadCount` (applied after `unreadCount` if both are given). */
  incrementUnread?: number;
};

/** An agent's view: mirrors `canSeeConversation` in `team/permissions.ts`. */
export interface ConversationVisibleTo {
  userId: string;
  queues: string[];
}

/** Filters shared by `conversations.list` and `conversations.count`; every filter is ANDed. */
export interface ConversationFilter {
  /** `null` matches conversations without a tenant; omitted matches every tenant. */
  tenantId?: TenantId;
  accountId?: string;
  /** Leaves out the conversations of these accounts. Empty or omitted: no filter. */
  excludeAccountIds?: string[];
  status?: ConversationStatus | ConversationStatus[];
  /** `null` matches unassigned conversations. */
  assignedTo?: string | null;
  /** Any-match: conversations carrying at least one of these tags. Empty or omitted: no filter. */
  tagIds?: string[];
  /** `null` matches conversations without a queue; omitted matches every queue. */
  queue?: string | null;
  /**
   * Assigned to `userId`, or unassigned with no queue or a queue in `queues`. Does not
   * scope the tenant: pass `tenantId` too.
   */
  visibleTo?: ConversationVisibleTo;
  /**
   * Case-insensitive substring of the contact's `profileName`, `appRef` or `phone` (for the
   * phone, spaces, dashes, dots and parentheses in the search are ignored). Blank: no filter.
   */
  search?: string;
}

export interface ConversationListQuery extends ConversationFilter {
  cursor?: string | null;
  limit: number;
}

export interface SourceCountQuery {
  tenantId: TenantId;
  accountId?: string;
  /** Conversations with `createdAt >= from`. */
  from?: Date;
  /** Conversations with `createdAt < to`. */
  to?: Date;
}

export interface SourceCount {
  /** `null`: conversations without attribution. */
  source: string | null;
  conversations: number;
}

export interface AssigneeCountQuery {
  tenantId: TenantId;
  assignees: string[];
  /** Default open conversations (`agent` and `human`). */
  status?: ConversationStatus | ConversationStatus[];
}

/**
 * `escalate` rule (one query per rule): `human` conversations of the tenant with
 * `awaitingReplySince < waitingSince` that were not escalated since they started waiting
 * (`escalatedAt` null or older than `awaitingReplySince`). Oldest wait first. Business hours
 * are the engine's job.
 */
export interface EscalationCandidatesQuery {
  type: "escalate";
  tenantId: TenantId;
  /** The rule's account; omitted = every account of the tenant. */
  accountId?: string;
  /** The rule's queue; omitted = any queue, `null` = conversations without a queue. */
  queue?: string | null;
  /** `now - afterMinutes`. */
  waitingSince: Date;
  limit: number;
}

/**
 * `auto_close` rule: open (`agent`/`human`) conversations of the tenant with
 * `lastActivityAt < inactiveSince`. Least recently active first.
 */
export interface AutoCloseCandidatesQuery {
  type: "auto_close";
  tenantId: TenantId;
  /** The rule's account; omitted = every account of the tenant. */
  accountId?: string;
  /** `now - afterDays`. */
  inactiveSince: Date;
  limit: number;
}

export type TickCandidatesQuery = EscalationCandidatesQuery | AutoCloseCandidatesQuery;

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

/**
 * Stored with `direction "out"`, `status "pending"` (or `"sent"`), `metaMessageId null`.
 * `internal` and `draft` together → `ConstraintViolationError` (`sendo_messages_internal_draft_check`).
 */
export interface InsertOutboundMessageInput extends MessageInsertBase {
  /**
   * Default `pending` (a send in flight). `sent` (with `sentAt` = now) is for rows that never
   * go through the transport: internal notes and system lines.
   */
  status?: "pending" | "sent";
  sender: OutboundSender;
  /** Agent name or user id. */
  senderRef?: string | null;
  /** Team note, never sent. Default `false`. */
  internal?: boolean;
  /** Reply waiting for approval. Default `false`. */
  draft?: boolean;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costCents?: number | null;
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

/** Fields `messages.update` may change (approving a draft). */
export interface MessagePatch {
  text?: string | null;
  content?: JsonObject;
  /** `true` on an internal note → `ConstraintViolationError` (`sendo_messages_internal_draft_check`). */
  draft?: boolean;
  /** Shallow-merged into `metadata` (like `updateMetadata`). */
  metadata?: JsonObject;
}

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

// ---------- snippets ----------

export interface SnippetListQuery {
  tenantId: TenantId;
  /** Also returns this user's personal snippets; omitted returns tenant snippets only. */
  userId?: string;
  /** Snippets for every account plus this account's; omitted returns all. */
  accountId?: string;
}

/**
 * Insert (no `id`) or update by `id`. Constraints (`ConstraintViolationError`):
 * `sendo_snippets_shortcut_key` (shortcut taken for the same tenant and owner),
 * `sendo_snippets_shortcut_check` (`^[a-z0-9_-]{1,32}$`), `sendo_snippets_owner_check`
 * (`ownerUserId` set exactly when `personal`).
 */
export interface SnippetUpsertInput {
  /** Updates this snippet; unknown, or of another tenant → `RecordNotFoundError`. */
  id?: string;
  tenantId: TenantId;
  /** Omitted: `null` on insert, unchanged on update. */
  accountId?: string | null;
  shortcut: string;
  body: string;
  /** Omitted: `tenant` on insert, unchanged on update. */
  visibility?: SnippetVisibility;
  /** Omitted: `null` on insert, unchanged on update. */
  ownerUserId?: string | null;
  /** The user making the change: `createdBy` on insert, `updatedBy` always. */
  by?: string | null;
}

// ---------- tags ----------

/**
 * Insert (no `id`) or update by `id`. Constraints: `sendo_tags_name_key` (name taken in the
 * tenant, ignoring case), `sendo_tags_name_check` (1–64 non-blank characters),
 * `sendo_tags_color_check`.
 */
export interface TagUpsertInput {
  /** Updates this tag; unknown, or of another tenant → `RecordNotFoundError`. */
  id?: string;
  tenantId: TenantId;
  name: string;
  color: TagColor;
}

// ---------- rules ----------

export interface RuleListQuery {
  /** `null` matches rules without a tenant; omitted matches every tenant (the tick). */
  tenantId?: TenantId;
  /** Tenant-wide rules plus this account's (the effective rules); omitted returns all. */
  accountId?: string;
  active?: boolean;
}

/**
 * Upsert by `(tenantId, key)`. `params` is stored as given (validate first). Constraints:
 * `sendo_rules_type_check`, `sendo_rules_origin_check`.
 */
export interface RuleUpsertInput {
  tenantId: TenantId;
  /** Omitted: `null` on insert, unchanged on update. */
  accountId?: string | null;
  key: string;
  type: RuleType;
  params: JsonObject;
  /** Omitted: after the tenant's last rule on insert, unchanged on update. */
  position?: number;
  /** Omitted: `true` on insert, unchanged on update. */
  active?: boolean;
  /** Omitted: `screen` on insert, unchanged on update. */
  origin?: RuleOrigin;
  updatedBy?: string | null;
}

export interface RuleUpsertOptions {
  /** Return an existing rule (same tenant and key) unchanged instead of overwriting it. */
  ifMissing?: boolean;
}

export interface RuleUpsertResult {
  rule: StoredRule;
  /** `false` when the rule existed (updated, or returned unchanged with `ifMissing`). */
  created: boolean;
}

/** Fields `rules.update` may change; `updatedAt` is always set. */
export type RulePatch = Partial<
  Pick<StoredRule, "accountId" | "params" | "position" | "active" | "updatedBy">
>;

// ---------- broadcasts ----------

export interface BroadcastInsertInput {
  tenantId: TenantId;
  accountId: string;
  templateName: string;
  language: string;
  category: TemplateCategory;
  variables?: JsonValue | null;
  /** Default 60. */
  ratePerMinute?: number;
  /** Default `queued`. */
  status?: BroadcastStatus;
  createdBy?: string | null;
}

export interface BroadcastListQuery {
  /** `null` matches broadcasts without a tenant. */
  tenantId: TenantId;
  accountId?: string;
  status?: BroadcastStatus | BroadcastStatus[];
  cursor?: string | null;
  limit: number;
}

/** Fields `broadcasts.update` may change. */
export type BroadcastPatch = Partial<
  Pick<
    Broadcast,
    "status" | "pauseReason" | "ratePerMinute" | "variables" | "startedAt" | "finishedAt"
  >
>;

export interface BroadcastRecipientInsertInput {
  contactId: string;
  variables?: JsonValue | null;
  /** Default `pending`; ineligible recipients are inserted `skipped` with a `skipReason`. */
  status?: "pending" | "skipped";
  skipReason?: string | null;
}

export interface BroadcastRecipientListQuery {
  broadcastId: string;
  status?: BroadcastRecipientStatus | BroadcastRecipientStatus[];
  /** `nextCursor` of the previous page. */
  cursor?: string | null;
  limit: number;
}

/** Fields `broadcasts.updateRecipient` may change; `updatedAt` is always set. */
export type BroadcastRecipientPatch = Partial<
  Pick<BroadcastRecipient, "status" | "messageId" | "skipReason" | "error">
>;

/** Recipients per status; every status is present (`0` when none). */
export type BroadcastRecipientCounts = Record<BroadcastRecipientStatus, number>;

// ---------- metrics ----------

/**
 * Filters every `metrics.*` method takes. Days are calendar days in the account's timezone:
 * a daily row is included when the start of its day (local midnight) is in `[from, to)`, so
 * pass local midnights. Per-conversation rows are included when their own timestamp
 * (`firstInboundAt`, `closedAt`) is in `[from, to)`.
 */
export interface MetricsAdapterQuery {
  /** `null` matches rows without a tenant. */
  tenantId: TenantId;
  from: Date;
  to: Date;
  accountId?: string;
  /** Any-match on the conversation's tags. Empty or omitted: no filter. */
  tagIds?: string[];
}

/** Messages and conversations per day and account (`sendo_metrics_daily`). */
export interface MetricsDailyRow {
  /** `YYYY-MM-DD` in the account's timezone. */
  day: string;
  accountId: string;
  channel: Channel;
  /** Inbound messages (history imports excluded). */
  inbound: number;
  /** Outbound messages sent to the contact (notes, system lines, drafts and imports excluded). */
  outbound: number;
  conversationsStarted: number;
  /** Conversations currently closed whose last close happened that day. */
  conversationsClosed: number;
  /** Model cost of every message that day, drafts included. */
  costCents: number;
  tokensIn: number;
  tokensOut: number;
}

/** A team member's activity per day (`sendo_metrics_by_assignee`, `sender = 'human'`). */
export interface MetricsAssigneeRow {
  day: string;
  /** The user id that sent the messages (`senderRef`); `business_app` for phone replies. */
  assignee: string | null;
  /** Conversations they sent at least one message in that day. */
  conversations: number;
  messagesSent: number;
  /** Conversations whose first response was theirs, that day. */
  firstResponses: number;
  /** Seconds of each of those first responses, ascending (to merge days exactly). */
  firstResponseSeconds: number[];
  /** Median of `firstResponseSeconds` (mean of the two middle values); `null` when empty. */
  medianFirstResponseSeconds: number | null;
}

/** First response per conversation (`sendo_metrics_first_response`). */
export interface MetricsFirstResponseRow {
  conversationId: string;
  accountId: string;
  channel: Channel;
  contactId: string;
  assignedTo: string | null;
  source: string | null;
  tagIds: string[];
  /** Local day of `firstInboundAt`. */
  day: string;
  firstInboundAt: Date;
  /** First reply by the agent or a human after `firstInboundAt` (notes and drafts excluded). */
  firstResponseAt: Date | null;
  responder: "agent" | "human" | null;
  responderRef: string | null;
  seconds: number | null;
}

/** Closed conversations and whether the AI resolved them (`sendo_metrics_ai_resolution`). */
export interface MetricsAiResolutionRow {
  conversationId: string;
  accountId: string;
  channel: Channel;
  source: string | null;
  tagIds: string[];
  /** Local day of `closedAt`. */
  day: string;
  createdAt: Date;
  /** The last close (its system line), else the last activity. */
  closedAt: Date;
  everHuman: boolean;
  /** Messages a human sent to the contact (notes excluded). */
  humanMessages: number;
  agentMessages: number;
  /** Never handed off (`everHuman = false`) and no human message. */
  aiResolved: boolean;
}

/** New conversations per source and day (`sendo_metrics_by_source`). */
export interface MetricsSourceRow {
  day: string;
  /** `null`: no attribution. */
  source: string | null;
  conversations: number;
}

/** Model usage per AI agent and day (`sendo_metrics_by_assignee`, `sender = 'agent'`). */
export interface MetricsCostRow {
  day: string;
  /** The agent's name (`senderRef`). */
  agent: string | null;
  costCents: number;
  tokensIn: number;
  tokensOut: number;
  /** Agent messages with usage (drafts included). */
  turns: number;
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
    /**
     * Atomically clears the default of the account's tenant (`null` tenant included) and makes
     * this account the default. Does not check `active`. Unknown id → `RecordNotFoundError`.
     */
    setDefault(id: string): Promise<Account>;
    /** Applies the defined fields of `patch`. Unknown id → `RecordNotFoundError`. */
    update(id: string, patch: AccountPatch): Promise<Account>;
    /**
     * Reconnects the inactive account with this phone number id, keeping its id (and so its
     * contacts, conversations and messages): sets `active: true` and applies the defined fields
     * of `input` (`phoneNumberId`, `tenantId`, `channel` and `isDefault` are not changed).
     * No account with that number → `RecordNotFoundError`; the account is active or belongs to
     * another tenant than `input.tenantId` → `DuplicateAccountError`.
     */
    reactivate(phoneNumberId: string, input: AccountInsertInput): Promise<Account>;
    /**
     * Deletes an inactive account and everything under it (contacts, conversations, messages,
     * media rows, templates). Returns the media storage paths so the caller deletes the objects.
     * Active account → `AccountStateError` (nothing deleted); unknown id → `RecordNotFoundError`.
     */
    purge(id: string): Promise<AccountPurgeResult>;
  };

  contacts: {
    /** Upsert by `(accountId, phone)`, or `(accountId, channelUserId)` without a phone. */
    upsert(input: ContactUpsertInput): Promise<ContactUpsertResult>;
    get(id: string): Promise<Contact | null>;
    /** The account's contact with this E.164 phone, or null (never creates). */
    getByPhone(accountId: string, phone: string): Promise<Contact | null>;
    setAppRef(id: string, appRef: string | null): Promise<Contact>;
    /** Sets `marketingOptIn` and `optInAt`. Unknown id → `RecordNotFoundError` (`contact`). */
    setOptIn(id: string, input: ContactOptInInput): Promise<Contact>;
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
    /** Conversations matching `filter` (tab counts). */
    count(filter: ConversationFilter): Promise<number>;
    /** Conversations per `source` (by `createdAt`), most conversations first, then by source. */
    countBySource(query: SourceCountQuery): Promise<SourceCount[]>;
    /** Conversations per assignee (every requested id is present, `0` when none). */
    countByAssignee(query: AssigneeCountQuery): Promise<Record<string, number>>;
    /** Candidates for one tick rule (`escalate` or `auto_close`), at most `limit`. */
    findForTick(query: TickCandidatesQuery): Promise<Conversation[]>;
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
    /** Applies the defined fields of `patch` (`metadata` is merged). */
    update(id: string, patch: MessagePatch): Promise<Message>;
    /** Deletes the conversation's pending drafts; returns how many. */
    deleteDrafts(conversationId: string): Promise<number>;
    /** The ids among `conversationIds` that have a pending draft (each once, any order). */
    pendingDraftConversations(conversationIds: string[]): Promise<string[]>;
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

  snippets: {
    /** Sorted by `shortcut`, tenant snippets before personal ones on a tie. */
    list(query: SnippetListQuery): Promise<Snippet[]>;
    get(id: string): Promise<Snippet | null>;
    upsert(input: SnippetUpsertInput): Promise<Snippet>;
    delete(id: string): Promise<void>;
  };

  tags: {
    /** Sorted by name (case-insensitive), ties by `id`. */
    list(query: { tenantId: TenantId }): Promise<Tag[]>;
    get(id: string): Promise<Tag | null>;
    upsert(input: TagUpsertInput): Promise<Tag>;
    /** Also removes the tag from every conversation. */
    delete(id: string): Promise<void>;
    /** Conversations carrying the tag. */
    usage(id: string): Promise<number>;
    /**
     * Idempotent; returns `false` when the conversation already had the tag. Unknown
     * conversation → `RecordNotFoundError` (`conversation`); unknown tag, or a tag of another
     * tenant → `RecordNotFoundError` (`tag`).
     */
    addToConversation(
      conversationId: string,
      tagId: string,
      opts?: { by?: string | null },
    ): Promise<boolean>;
    /** Idempotent; returns `false` when the conversation did not have the tag. */
    removeFromConversation(conversationId: string, tagId: string): Promise<boolean>;
    /** Tags per conversation (sorted like `list`); every requested id is present. */
    forConversations(conversationIds: string[]): Promise<Record<string, Tag[]>>;
  };

  rules: {
    /** Sorted by `position`, then `key`. */
    list(query?: RuleListQuery): Promise<StoredRule[]>;
    get(id: string): Promise<StoredRule | null>;
    upsert(input: RuleUpsertInput, opts?: RuleUpsertOptions): Promise<RuleUpsertResult>;
    update(id: string, patch: RulePatch): Promise<StoredRule>;
    delete(id: string): Promise<void>;
    /**
     * Sets `position` to each id's index. Every id must be a rule of the tenant, else
     * `RecordNotFoundError` and nothing changes. Rules not listed keep their position.
     */
    reorder(tenantId: TenantId, ids: string[]): Promise<void>;
    /** Shallow-merges `patch` into `state` atomically; does not touch `updatedAt`. */
    patchState(id: string, patch: JsonObject): Promise<StoredRule>;
  };

  broadcasts: {
    /** Unknown account → `RecordNotFoundError` (`account`). */
    insert(input: BroadcastInsertInput): Promise<Broadcast>;
    get(id: string): Promise<Broadcast | null>;
    /** Newest first (`createdAt` descending, ties by `id`). */
    list(query: BroadcastListQuery): Promise<Page<Broadcast>>;
    /** Applies the defined fields. Unknown id → `RecordNotFoundError` (`broadcast`). */
    update(id: string, patch: BroadcastPatch): Promise<Broadcast>;
    /**
     * Adds recipients (tenant of the broadcast). A contact already in the broadcast is skipped
     * (unique per broadcast and contact). Returns how many were inserted. Unknown broadcast →
     * `RecordNotFoundError` (`broadcast`).
     */
    insertRecipients(
      broadcastId: string,
      recipients: BroadcastRecipientInsertInput[],
    ): Promise<number>;
    /** Up to `limit` `pending` recipients, least recently updated first. */
    nextPending(broadcastId: string, limit: number): Promise<BroadcastRecipient[]>;
    /** Unknown id → `RecordNotFoundError` (`broadcast_recipient`). */
    updateRecipient(id: string, patch: BroadcastRecipientPatch): Promise<BroadcastRecipient>;
    recipientByMessageId(messageId: string): Promise<BroadcastRecipient | null>;
    /** A page of the broadcast's recipients in a stable order (by `id`). */
    listRecipients(query: BroadcastRecipientListQuery): Promise<Page<BroadcastRecipient>>;
    /** Sets every `pending` recipient to `cancelled`; returns how many. */
    cancelPending(broadcastId: string): Promise<number>;
    counts(broadcastId: string): Promise<BroadcastRecipientCounts>;
  };

  /**
   * Read-only metrics (the `sendo_metrics_*` views). Every method filters by
   * `MetricsAdapterQuery`; orderings are documented on each method.
   */
  metrics: {
    /** Sorted by day, then account id. */
    daily(query: MetricsAdapterQuery): Promise<MetricsDailyRow[]>;
    /** Team members only. Sorted by day, then assignee (`null` last). */
    byAssignee(query: MetricsAdapterQuery): Promise<MetricsAssigneeRow[]>;
    /** Conversations with an inbound message. Sorted by `firstInboundAt`, then id. */
    firstResponse(query: MetricsAdapterQuery): Promise<MetricsFirstResponseRow[]>;
    /** Closed conversations. Sorted by `closedAt`, then id. */
    aiResolution(query: MetricsAdapterQuery): Promise<MetricsAiResolutionRow[]>;
    /** Sorted by day, most conversations first, then source (`null` last). */
    bySource(query: MetricsAdapterQuery): Promise<MetricsSourceRow[]>;
    /** AI agents only. Sorted by day, then agent (`null` last). */
    cost(query: MetricsAdapterQuery): Promise<MetricsCostRow[]>;
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

  /**
   * The adapter's default media store (Supabase: `supabaseStorage()` on its bucket; memory: an
   * in-memory map). Optional: SQL adapters without one need `createSendo({ media })`, which
   * always wins over this default.
   */
  storage?: MediaStore;

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
  "sendo_snippets",
  "sendo_tags",
  "sendo_conversation_tags",
  "sendo_rules",
  "sendo_broadcasts",
  "sendo_broadcast_recipients",
] as const;
export type SendoTable = (typeof SENDO_TABLES)[number];
