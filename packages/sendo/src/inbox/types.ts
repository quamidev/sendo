import type { Channel } from "../channels/types";
import type { TranscriptionError } from "../core/pipeline/transcribe";
import type { Actor } from "../team/permissions";
import type {
  Conversation,
  JsonObject,
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
  TagColor,
} from "../types/enums";

/** Every inbox method takes the acting user (`sendo.actor(userId, tenantId)`). */
export interface InboxActorOption {
  actor: Actor;
}

/**
 * Conversations of the actor's tenant. Agents only get what they may see (assigned to them,
 * or unassigned with no queue or one of their queues); every filter is ANDed.
 */
export interface InboxListQuery extends InboxActorOption {
  status?: ConversationStatus | ConversationStatus[];
  /** `null` lists unassigned conversations. */
  assignedTo?: string | null;
  /** "Asignadas a mí": `assignedTo = actor.userId`. */
  mine?: boolean;
  /** Restricts the list to one account (sendo account id). */
  accountId?: string;
  /** `null`: conversations without a queue. */
  queue?: string | null;
  /** Any-match. */
  tagIds?: string[];
  /** Contact name, app reference or phone (case-insensitive substring). */
  search?: string;
  cursor?: string | null;
  /** Default 30, max 100. */
  limit?: number;
}

/** `list` filters without paging (tab counts). */
export type InboxCountQuery = Omit<InboxListQuery, "cursor" | "limit">;

export interface InboxContact {
  id: string;
  /** `null` for contacts identified only by a channel user id. */
  phone: string | null;
  /** `profileName`, falling back to the phone (or the channel user id). */
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

export interface InboxTag {
  id: string;
  name: string;
  color: TagColor;
}

/** A user from `resolveUsers`; `name` is `null` when the app did not return the id. */
export interface InboxAssignee {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Why and when the conversation was handed to a person (AC-IB-6). */
export interface InboxHandoff {
  reason: string;
  /** A user id, `"system"`, `"agent:<name>"` or `"rule:<key>"`; `null` when not recorded. */
  by: string | null;
  at: Date | null;
}

export interface InboxConversation {
  id: string;
  accountId: string;
  tenantId: TenantId;
  channel: Channel;
  status: ConversationStatus;
  /** Attribution (`[#code]`, `ad:<id>`), or `null`. */
  source: string | null;
  queue: string | null;
  assignedTo: string | null;
  /** The assigned user from `resolveUsers` (`name: null` when unknown); `null` when unassigned. */
  assignee: InboxAssignee | null;
  handoffReason: string | null;
  /** Set while the status is `human` and a reason was given. */
  handoff: InboxHandoff | null;
  /** The agent runs no turns: paused on the conversation or on its number. */
  agentPaused: boolean;
  /** Where the pause is: `conversation` can be resumed from the inbox; `account` only by an admin. */
  agentPausedOn: "conversation" | "account" | null;
  /** An agent draft waits for approval. */
  hasPendingDraft: boolean;
  /** `false` once the number was disconnected: reads work, replies and notes throw `ACCOUNT_STATE`. */
  accountActive: boolean;
  tags: InboxTag[];
  unreadCount: number;
  lastActivityAt: Date;
  lastInboundAt: Date | null;
  /** The 24-hour customer service window (`windowStatus(lastInboundAt)`). */
  window: WindowStatus;
  contact: InboxContact;
  /** Newest message the contact could see (no notes, system lines or drafts), or `null`. */
  lastMessagePreview: InboxMessagePreview | null;
  conversation: Conversation;
}

export interface InboxThreadQuery extends InboxActorOption {
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

/** Messages that did not come from the API: sent from the WhatsApp Business app, or imported. */
export type InboxMessageOrigin = "business_app" | "imported";

/** A system line (`sender "system"`, `internal`): `rule` from the rules engine, else `system`. */
export interface InboxSystemLine {
  kind: "system" | "rule";
  /** e.g. `handoff`, `assigned`, `returned`, `closed`, `agent_paused`, `agent_resumed`. */
  event: string | null;
  by: string | null;
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
  /** A team note (`sender "human"`) or a system line (`sender "system"`); never sent. */
  internal: boolean;
  /** Set on system lines. */
  systemLine: InboxSystemLine | null;
  /** An agent reply waiting for approval (`approveDraft` / `discardDraft`). */
  draft: boolean;
  /** The draft was proposed before the conversation was handed to a person. */
  handoffAfterDraft: boolean;
  /** User who approved this agent reply. */
  approvedBy: string | null;
  /** The approver changed the text. */
  edited: boolean;
  origin: InboxMessageOrigin | null;
  /** Attribution code of the first inbound message (`[#code]`). */
  source: string | null;
  /** Model usage of agent replies and drafts; `null` unless the actor has `costs.view` (admins). */
  tokensIn: number | null;
  tokensOut: number | null;
  /** Cents; `null` unless the actor has `costs.view` (admins) and the cost is known. */
  costCents: number | null;
  /** Voice-note transcription of an inbound audio; `null` when none was attempted. */
  transcription: InboxTranscription | null;
  /** Present when the message has a stored media record. */
  media?: InboxMedia;
}

/**
 * `metadata.transcription` of a voice note (`createSendo({ transcribe })`). On success the
 * transcript is the message `text`; `error` says why there is none (`text` stays `null`).
 */
export interface InboxTranscription {
  model: string;
  /** Time spent, in ms. */
  ms: number | null;
  error: TranscriptionError | null;
}

/** Agent turns of a whole conversation and what they cost (`sendo.inbox.cost`, admins). */
export interface InboxConversationCost {
  /** Agent replies and pending drafts. */
  turns: number;
  tokensIn: number;
  tokensOut: number;
  /** Sum of the known costs in cents; `null` when no turn has a known cost. */
  costCents: number | null;
  /** Turns whose cost is unknown (no provider cost and no `pricing`). */
  unpricedTurns: number;
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

export interface InboxApproveDraftOptions extends InboxActorOption {
  /** Sends this text instead of the draft's (recorded as `metadata.edited`). */
  text?: string;
}

export interface InboxTagsApi {
  /** Adds a tag of the tenant's catalog; returns the conversation's tags. */
  add(conversationId: string, tagId: string, opts: InboxActorOption): Promise<InboxTag[]>;
  /** Returns the conversation's tags. */
  remove(conversationId: string, tagId: string, opts: InboxActorOption): Promise<InboxTag[]>;
}

/**
 * Server-side inbox operations (`sendo.inbox`). Every method checks the actor through
 * `team/permissions.ts`: a conversation of another tenant is `RECORD_NOT_FOUND`, one of the
 * tenant the actor may not see or act on is `FORBIDDEN`.
 */
export interface InboxApi {
  /** Most recent activity first. */
  list(query: InboxListQuery): Promise<Page<InboxConversation>>;
  /** Conversations matching the same filters as `list`. */
  count(query: InboxCountQuery): Promise<number>;
  /** One conversation (thread header). */
  get(conversationId: string, opts: InboxActorOption): Promise<InboxConversation>;
  /** Messages newest first, notes, system lines and drafts included; `nextCursor` loads older. */
  thread(conversationId: string, query: InboxThreadQuery): Promise<Page<InboxMessage>>;
  /**
   * Sends as `sender "human"` (`senderRef = actor.userId`) without changing status, assignment
   * or the agent (step-in), then discards the pending draft. Free-form replies outside the
   * window throw `WindowClosedError` before calling Meta; a disconnected number throws
   * `AccountStateError` (`ACCOUNT_STATE`, `state: "inactive"`).
   */
  reply(
    conversationId: string,
    payload: InboxReplyPayload,
    opts: InboxActorOption,
  ): Promise<InboxMessage>;
  /** Internal note: `internal`, sender `human`, status `sent`, never sent. Disconnected → `ACCOUNT_STATE`. */
  note(conversationId: string, text: string, opts: InboxActorOption): Promise<InboxMessage>;
  /** Assigns the actor and moves to `human`. Taking someone else's needs `conversations.reassign`. */
  take(conversationId: string, opts: InboxActorOption): Promise<InboxConversation>;
  /** Anyone other than the actor (or `null`) needs `conversations.reassign`. */
  assign(
    conversationId: string,
    userId: string | null,
    opts: InboxActorOption,
  ): Promise<InboxConversation>;
  returnToAgent(conversationId: string, opts: InboxActorOption): Promise<InboxConversation>;
  close(conversationId: string, opts: InboxActorOption): Promise<InboxConversation>;
  /** Needs `conversations.pause_agent`. */
  pauseAgent(
    conversationId: string,
    paused: boolean,
    opts: InboxActorOption,
  ): Promise<InboxConversation>;
  /**
   * Sends the pending draft (window check first: `WINDOW_CLOSED`), keeping sender `agent` and
   * recording `metadata.approvedBy` / `metadata.edited`. An unknown or replaced draft is
   * `RECORD_NOT_FOUND`; a disconnected number `ACCOUNT_STATE`.
   */
  approveDraft(messageId: string, opts: InboxApproveDraftOptions): Promise<InboxMessage>;
  /** Deletes the conversation's pending draft. */
  discardDraft(messageId: string, opts: InboxActorOption): Promise<void>;
  /** Resets `unreadCount` to 0. */
  markSeen(conversationId: string, opts: InboxActorOption): Promise<void>;
  /** People the conversation can be assigned to (`resolveAssignees` + `resolveUsers`). */
  assignees(conversationId: string, opts: InboxActorOption): Promise<InboxAssignee[]>;
  /**
   * Tokens and cost of every agent turn of the conversation (context panel "Costo del agente").
   * Needs `costs.view` (admins).
   */
  cost(conversationId: string, opts: InboxActorOption): Promise<InboxConversationCost>;
  tags: InboxTagsApi;
}
