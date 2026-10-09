import type { RuleType } from "../rules/schemas";

export const CONVERSATION_STATUSES = ["agent", "human", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "received",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Statuses Meta reports for outbound messages through status webhooks. */
export const DELIVERY_STATUSES = ["sent", "delivered", "read", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const SENDERS = ["contact", "agent", "human", "system"] as const;
export type Sender = (typeof SENDERS)[number];
export type OutboundSender = Exclude<Sender, "contact">;

export const DIRECTIONS = ["in", "out"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const EVENT_STATUSES = ["received", "processed", "failed", "unrouted"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const DOWNLOAD_STATUSES = ["pending", "done", "failed"] as const;
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number];

export const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * Every message type stored in `sendo_messages.type`.
 * - `interactive`: button and list replies (inbound) and buttons/list messages (outbound).
 * - `button`: template quick-reply button press (inbound).
 * - `unsupported`: an unknown inbound type, with the raw payload kept in `content`.
 * - `status_placeholder`: adapter-internal row for a status that arrived before its send row.
 */
export const MESSAGE_TYPES = [
  "text",
  ...MEDIA_TYPES,
  "location",
  "contacts",
  "reaction",
  "interactive",
  "button",
  "template",
  "unsupported",
  "status_placeholder",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
/** Meta template category; known values are typed, unknown future values are kept as strings. */
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number] | (string & {});

export const TEMPLATE_STATUSES = [
  "APPROVED",
  "PENDING",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "PENDING_DELETION",
  "DELETED",
  "LIMIT_EXCEEDED",
  "ARCHIVED",
] as const;
/** Meta template status; known values are typed, unknown future values are kept as strings. */
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number] | (string & {});

/** How an account was connected. */
export const ONBOARDED_VIA = ["manual", "embedded_signup", "connect"] as const;
export type OnboardedVia = (typeof ONBOARDED_VIA)[number];

/** Per-account override of the agent's mode (`draft`: replies wait for approval). */
export const AGENT_MODES = ["auto", "draft"] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** Who sees a snippet: the whole team (`tenant`) or only its owner (`personal`). */
export const SNIPPET_VISIBILITIES = ["tenant", "personal"] as const;
export type SnippetVisibility = (typeof SNIPPET_VISIBILITIES)[number];

/** The fixed tag palette (`sendo_tags_color_check`). */
export const TAG_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** Stored rule types (`sendo_rules_type_check`); the same values as `RuleType`. */
export const RULE_TYPES = [
  "business_hours",
  "route",
  "auto_assign",
  "escalate",
  "auto_close",
] as const satisfies readonly RuleType[];

/** Where a stored rule came from: `sendo rules sync` (`code`) or the rules screen. */
export const RULE_ORIGINS = ["code", "screen"] as const;
export type RuleOrigin = (typeof RULE_ORIGINS)[number];

/** Broadcast lifecycle (`sendo_broadcasts.status`). */
export const BROADCAST_STATUSES = [
  "queued",
  "sending",
  "paused",
  "done",
  "cancelled",
  "failed",
] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

/** One recipient's result (`sendo_broadcast_recipients.status`). */
export const BROADCAST_RECIPIENT_STATUSES = [
  "pending",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type BroadcastRecipientStatus = (typeof BROADCAST_RECIPIENT_STATUSES)[number];
