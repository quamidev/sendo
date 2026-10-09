import type {
  Conversation,
  JsonObject,
  Message,
  MessageError,
  Page,
  TenantId,
  WindowStatus,
} from "../types/entities";
import type {
  ConversationStatus,
  Direction,
  DownloadStatus,
  MediaType,
  MessageStatus,
  MessageType,
  Sender,
} from "../types/enums";

export interface InboxListQuery {
  /** Required: `null` lists the conversations of a single-tenant app (no tenant). */
  tenantId: TenantId;
  status?: ConversationStatus | ConversationStatus[];
  /** `null` lists unassigned conversations. */
  assignedTo?: string | null;
  /** Restricts the list to one account (sendo account id). */
  accountId?: string;
  cursor?: string | null;
  /** Default 30, max 100. */
  limit?: number;
}

export interface InboxContact {
  id: string;
  phone: string;
  /** `profileName`, falling back to the phone. */
  displayName: string;
  appRef: string | null;
}

export interface InboxMessagePreview {
  text: string | null;
  direction: Direction;
  sender: Sender;
  type: MessageType;
  status: MessageStatus;
  at: Date;
}

export interface InboxConversation {
  id: string;
  accountId: string;
  tenantId: TenantId;
  status: ConversationStatus;
  assignedTo: string | null;
  handoffReason: string | null;
  unreadCount: number;
  lastActivityAt: Date;
  lastInboundAt: Date | null;
  /** The 24-hour customer service window (`windowStatus(lastInboundAt)`). */
  window: WindowStatus;
  contact: InboxContact;
  /** Newest message of the conversation, or `null` when it has none. */
  lastMessagePreview: InboxMessagePreview | null;
  conversation: Conversation;
}

/** Optional tenant guard: when given, a conversation of another tenant is "not found". */
export interface InboxTenantOption {
  tenantId?: TenantId;
}

export interface InboxThreadQuery extends InboxTenantOption {
  cursor?: string | null;
  /** Default 50, max 100. */
  limit?: number;
}

export interface InboxMedia {
  /** Signed storage URL (valid 300 s) when `downloadStatus` is `done`, else `null`. */
  url: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  downloadStatus: DownloadStatus;
  filename?: string;
}

export interface InboxMessage {
  id: string;
  conversationId: string;
  direction: Direction;
  type: MessageType;
  text: string | null;
  content: JsonObject;
  sender: Sender;
  senderRef: string | null;
  status: MessageStatus;
  error: MessageError | null;
  sentAt: Date | null;
  createdAt: Date;
  replyToMetaId: string | null;
  metaMessageId: string | null;
  /** Present when the message has a stored media record. */
  media?: InboxMedia;
}

export type InboxReplyPayload =
  | { kind: "text"; body: string }
  | {
      kind: "media";
      mediaType: MediaType;
      file?: Blob | Uint8Array;
      url?: string;
      caption?: string;
      filename?: string;
      /** Required for `Uint8Array` files; defaults to `Blob.type`. */
      mimeType?: string;
    }
  | {
      kind: "template";
      name: string;
      language: string;
      variables?: string[] | Record<string, string>;
    };

export interface InboxReplyOptions extends InboxTenantOption {
  /** The app user sending the reply; stored as `senderRef`. */
  userId: string;
}

/** Server-side inbox operations (`sendo.inbox`). Auth is the caller's job. */
export interface InboxApi {
  /** Conversations of one tenant, most recent activity first. */
  list(query: InboxListQuery): Promise<Page<InboxConversation>>;
  /** Messages newest first; `nextCursor` loads older ones. */
  thread(conversationId: string, query?: InboxThreadQuery): Promise<Page<InboxMessage>>;
  /**
   * Sends as `sender "human"`, `senderRef = userId`. Free-form replies outside the
   * 24-hour window throw `WindowClosedError` before calling Meta.
   */
  reply(
    conversationId: string,
    payload: InboxReplyPayload,
    opts: InboxReplyOptions,
  ): Promise<Message>;
  /** Resets `unreadCount` to 0. */
  markSeen(conversationId: string, opts?: InboxTenantOption): Promise<Conversation>;
}
