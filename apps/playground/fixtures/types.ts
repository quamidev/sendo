import type {
  ConversationStatus,
  DownloadStatus,
  JsonObject,
  MessageError,
  MessageType,
  OutboundSender,
  TagColor,
} from "@quami/sendo";

export type FixtureOutboundStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export interface FixtureMedia {
  mimeType: string;
  downloadStatus: DownloadStatus;
  sizeBytes?: number;
  filename?: string;
}

interface FixtureMessageBase {
  /** Minutes before the seed time. Messages are stored in array order, so keep it decreasing. */
  minutesAgo: number;
  type?: Exclude<MessageType, "status_placeholder">;
  text?: string | null;
  /** Default `{ body: text }`. */
  content?: JsonObject;
  /** e.g. `{ source: "garita" }`, `{ origin: "business_app" }`, `{ imported: true }`. */
  metadata?: JsonObject;
  media?: FixtureMedia;
}

export interface FixtureInboundMessage extends FixtureMessageBase {
  direction: "in";
}

export interface FixtureOutboundMessage extends FixtureMessageBase {
  direction: "out";
  sender: OutboundSender;
  /** Agent name or user id. */
  senderRef?: string | null;
  /** Default `read`. */
  status?: FixtureOutboundStatus;
  /** Required when `status` is `failed`. */
  error?: MessageError;
  /** A team note (`sender "human"`) or a system line (`sender "system"`, `metadata.kind/event/by`). */
  internal?: boolean;
  /** An agent reply waiting for approval (stays `pending`). */
  draft?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
}

export type FixtureMessage = FixtureInboundMessage | FixtureOutboundMessage;

export interface FixtureConversation {
  /** Stable key, also used in fixture Meta ids (`wamid.FIX.<key>.<n>`). */
  key: string;
  contact: {
    /** E.164. */
    phone: string;
    profileName: string | null;
    /** Linked record in the app ("Apto 4B · Torre Vista"). */
    appRef?: string;
  };
  status: ConversationStatus;
  assignedTo?: string | null;
  handoffReason?: string | null;
  /** Default: inbound messages after the last outbound one. */
  unreadCount?: number;
  /** Used when there are no messages. Default 60. */
  createdMinutesAgo?: number;
  /** Agent paused on this conversation. */
  agentPaused?: boolean;
  queue?: string | null;
  /** Attribution code (`[#code]` of the first message). */
  source?: string | null;
  /** Tags of the tenant catalog (created on first use). */
  tags?: { name: string; color: TagColor }[];
  /** `disconnected`: on a second number of the tenant that was disconnected (AC-IB-8). */
  account?: "main" | "disconnected";
  messages: FixtureMessage[];
}
