/**
 * Drizzle schema for Sendo's `sendo_*` tables (schema v3), generated from and checked against
 * the `sendo-schema` SQL migrations. Use it for typed reads in your app (joins with your own
 * tables, reports). The SQL migrations remain the source of truth: they also create the
 * constraints, partial indexes, functions, RLS policies and metrics views Drizzle can't express.
 *
 * - Don't let drizzle-kit generate or push migrations from this file: keep it out of the
 *   `schema` of your `drizzle.config.ts` (or exclude `sendo_*` with `tablesFilter`).
 * - Write through `@quami/sendo` (`drizzleAdapter`), not with these tables directly: the package
 *   keeps status ordering, locks, unread counts and placeholders consistent.
 */
import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const sendoConversationStatus = pgEnum("sendo_conversation_status", [
  "agent",
  "human",
  "closed",
]);
export const sendoMessageStatus = pgEnum("sendo_message_status", [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
]);
export const sendoDirection = pgEnum("sendo_direction", ["in", "out"]);
export const sendoSender = pgEnum("sendo_sender", ["contact", "agent", "human", "system"]);
export const sendoEventStatus = pgEnum("sendo_event_status", [
  "received",
  "processed",
  "failed",
  "unrouted",
]);
export const sendoDownloadStatus = pgEnum("sendo_download_status", ["pending", "done", "failed"]);

// ---------- v1 ----------

export const sendoAccounts = pgTable("sendo_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  channel: text("channel").notNull().default("whatsapp"),
  label: text("label"),
  phoneNumberId: text("phone_number_id").unique("sendo_accounts_phone_number_id_key"),
  wabaId: text("waba_id"),
  displayPhone: text("display_phone").notNull(),
  /** The NAME of the env var or secret holding the access token, never the token. */
  tokenRef: text("token_ref").notNull(),
  timezone: text("timezone").notNull().default("America/Guatemala"),
  active: boolean("active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  coexistence: boolean("coexistence").notNull().default(false),
  onboardedVia: text("onboarded_via").notNull().default("manual"),
  agentPaused: boolean("agent_paused").notNull().default(false),
  agentMode: text("agent_mode"),
  billingReady: boolean("billing_ready"),
  billingCheckedAt: timestamptz("billing_checked_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const sendoContacts = pgTable("sendo_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  accountId: uuid("account_id")
    .notNull()
    .references(() => sendoAccounts.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("whatsapp"),
  phone: text("phone"),
  channelUserId: text("channel_user_id"),
  waId: text("wa_id"),
  profileName: text("profile_name"),
  /** Your app's own user / patient / customer id. */
  appRef: text("app_ref"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  optInAt: timestamptz("opt_in_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const sendoConversations = pgTable("sendo_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  accountId: uuid("account_id")
    .notNull()
    .references(() => sendoAccounts.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => sendoContacts.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("whatsapp"),
  status: sendoConversationStatus("status").notNull().default("agent"),
  source: text("source"),
  assignedTo: text("assigned_to"),
  assignedAt: timestamptz("assigned_at"),
  handoffReason: text("handoff_reason"),
  agentPaused: boolean("agent_paused").notNull().default(false),
  queue: text("queue"),
  everHuman: boolean("ever_human").notNull().default(false),
  lastInboundAt: timestamptz("last_inbound_at"),
  lastActivityAt: timestamptz("last_activity_at").notNull().defaultNow(),
  windowExpiresAt: timestamptz("window_expires_at"),
  awaitingReplySince: timestamptz("awaiting_reply_since"),
  escalatedAt: timestamptz("escalated_at"),
  afterHoursNotifiedAt: timestamptz("after_hours_notified_at"),
  unreadCount: integer("unread_count").notNull().default(0),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

/** `conversationId` is null only for internal `status_placeholder` rows (filter them out). */
export const sendoMessages = pgTable("sendo_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  conversationId: uuid("conversation_id").references(() => sendoConversations.id, {
    onDelete: "cascade",
  }),
  direction: sendoDirection("direction").notNull(),
  type: text("type").notNull(),
  content: jsonb("content").notNull().default({}),
  text: text("text"),
  metaMessageId: text("meta_message_id"),
  replyToMetaId: text("reply_to_meta_id"),
  status: sendoMessageStatus("status").notNull(),
  error: jsonb("error"),
  sender: sendoSender("sender").notNull(),
  senderRef: text("sender_ref"),
  metadata: jsonb("metadata").notNull().default({}),
  internal: boolean("internal").notNull().default(false),
  draft: boolean("draft").notNull().default(false),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costCents: numeric("cost_cents", { precision: 12, scale: 4 }),
  sentAt: timestamptz("sent_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const sendoMedia = pgTable("sendo_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  messageId: uuid("message_id")
    .notNull()
    .references(() => sendoMessages.id, { onDelete: "cascade" }),
  metaMediaId: text("meta_media_id"),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  sha256: text("sha256"),
  /** Path in your `MediaStore` (Supabase Storage, S3, ...). */
  storagePath: text("storage_path"),
  downloadStatus: sendoDownloadStatus("download_status").notNull().default("pending"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const sendoTemplates = pgTable("sendo_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  accountId: uuid("account_id")
    .notNull()
    .references(() => sendoAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  language: text("language").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull(),
  components: jsonb("components").notNull().default([]),
  variableCount: integer("variable_count").notNull().default(0),
  active: boolean("active").notNull().default(true),
  syncedAt: timestamptz("synced_at").notNull().defaultNow(),
});

export const sendoEvents = pgTable("sendo_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  receivedAt: timestamptz("received_at").notNull().defaultNow(),
  payload: jsonb("payload").notNull(),
  status: sendoEventStatus("status").notNull().default("received"),
  error: text("error"),
  processedAt: timestamptz("processed_at"),
});

export const sendoLocks = pgTable("sendo_locks", {
  key: text("key").primaryKey(),
  expiresAt: timestamptz("expires_at").notNull(),
});

export const sendoSchemaMeta = pgTable("sendo_schema_meta", {
  version: integer("version").primaryKey(),
  appliedAt: timestamptz("applied_at").notNull().defaultNow(),
});

// ---------- v2 ----------

export const sendoSnippets = pgTable("sendo_snippets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  accountId: uuid("account_id").references(() => sendoAccounts.id, { onDelete: "cascade" }),
  shortcut: text("shortcut").notNull(),
  body: text("body").notNull(),
  visibility: text("visibility").notNull().default("tenant"),
  ownerUserId: text("owner_user_id"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const sendoTags = pgTable("sendo_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  name: text("name").notNull(),
  color: text("color").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const sendoConversationTags = pgTable(
  "sendo_conversation_tags",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => sendoConversations.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => sendoTags.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id"),
    addedBy: text("added_by"),
    addedAt: timestamptz("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "sendo_conversation_tags_pkey", columns: [t.conversationId, t.tagId] }),
  ],
);

export const sendoRules = pgTable("sendo_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  accountId: uuid("account_id").references(() => sendoAccounts.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  type: text("type").notNull(),
  params: jsonb("params").notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  origin: text("origin").notNull().default("screen"),
  state: jsonb("state").notNull().default({}),
  updatedBy: text("updated_by"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

// ---------- v3 ----------

export const sendoBroadcasts = pgTable("sendo_broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  accountId: uuid("account_id")
    .notNull()
    .references(() => sendoAccounts.id, { onDelete: "cascade" }),
  templateName: text("template_name").notNull(),
  language: text("language").notNull(),
  category: text("category").notNull(),
  variables: jsonb("variables"),
  ratePerMinute: integer("rate_per_minute").notNull().default(60),
  status: text("status").notNull().default("queued"),
  pauseReason: text("pause_reason"),
  createdBy: text("created_by"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  startedAt: timestamptz("started_at"),
  finishedAt: timestamptz("finished_at"),
});

export const sendoBroadcastRecipients = pgTable("sendo_broadcast_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id"),
  broadcastId: uuid("broadcast_id")
    .notNull()
    .references(() => sendoBroadcasts.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => sendoContacts.id, { onDelete: "cascade" }),
  variables: jsonb("variables"),
  messageId: uuid("message_id").references(() => sendoMessages.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"),
  skipReason: text("skip_reason"),
  error: jsonb("error"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/** Every Sendo table, keyed by its SQL name. */
export const sendoTables = {
  sendo_accounts: sendoAccounts,
  sendo_contacts: sendoContacts,
  sendo_conversations: sendoConversations,
  sendo_messages: sendoMessages,
  sendo_media: sendoMedia,
  sendo_templates: sendoTemplates,
  sendo_events: sendoEvents,
  sendo_locks: sendoLocks,
  sendo_schema_meta: sendoSchemaMeta,
  sendo_snippets: sendoSnippets,
  sendo_tags: sendoTags,
  sendo_conversation_tags: sendoConversationTags,
  sendo_rules: sendoRules,
  sendo_broadcasts: sendoBroadcasts,
  sendo_broadcast_recipients: sendoBroadcastRecipients,
};
