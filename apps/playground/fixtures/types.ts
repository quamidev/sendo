import type {
  ConversationStatus,
  DownloadStatus,
  JsonObject,
  MessageError,
  MessageType,
  OutboundSender,
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
}

export type FixtureMessage = FixtureInboundMessage | FixtureOutboundMessage;

export interface FixtureConversation {
  /** Stable key, also used in fixture Meta ids (`wamid.FIX.<key>.<n>`). */
  key: string;
  contact: {
    /** E.164. */
    phone: string;
    profileName: string | null;
  };
  status: ConversationStatus;
  assignedTo?: string | null;
  handoffReason?: string | null;
  /** Default: inbound messages after the last outbound one. */
  unreadCount?: number;
  /** Used when there are no messages. Default 60. */
  createdMinutesAgo?: number;
  messages: FixtureMessage[];
}
