import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  Message,
  Template,
} from "@quami/sendo";

/** `T` as it crosses the server action boundary: every `Date` becomes an ISO string. */
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

export type InboxConversationView = Serialized<Omit<InboxConversation, "conversation">>;
export type InboxMessageView = Serialized<InboxMessage>;

export interface InboxTemplateView {
  id: string;
  name: string;
  language: string;
  category: Template["category"];
  variableCount: number;
  /** BODY text with `{{n}}` placeholders, for the preview. */
  body: string | null;
}

/** Fields of a conversation the take / return / close actions change. */
export type InboxConversationPatch = Pick<
  InboxConversationView,
  "id" | "status" | "assignedTo" | "handoffReason" | "unreadCount" | "lastActivityAt"
>;

export interface InboxPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type InboxErrorCode = "WINDOW_CLOSED" | "NOT_FOUND" | "INVALID" | "UNKNOWN";

export type InboxActionResult<T> =
  { ok: true; data: T } | { ok: false; code: InboxErrorCode; message: string };

export type InboxFilter = ConversationStatus | "all";

export interface InboxListInput {
  filter: InboxFilter;
  assignedToMe: boolean;
  cursor?: string | null;
}

export type InboxReplyInput =
  | { kind: "text"; body: string }
  | { kind: "media"; file: File; caption?: string }
  | { kind: "template"; name: string; language: string; variables: string[] };

/**
 * The server actions the inbox calls. `app/(protected)/inbox/actions.ts` implements
 * them with `sendo.inbox.*`; apps can pass their own implementation.
 */
export interface InboxActions {
  list(input: InboxListInput): Promise<InboxActionResult<InboxPage<InboxConversationView>>>;
  /** Newest first; `nextCursor` loads older messages. */
  thread(
    conversationId: string,
    cursor?: string | null,
  ): Promise<InboxActionResult<InboxPage<InboxMessageView>>>;
  reply(
    conversationId: string,
    input: InboxReplyInput,
  ): Promise<InboxActionResult<InboxMessageView>>;
  markSeen(conversationId: string): Promise<InboxActionResult<InboxConversationPatch>>;
  take(conversationId: string): Promise<InboxActionResult<InboxConversationPatch>>;
  returnToAgent(conversationId: string): Promise<InboxActionResult<InboxConversationPatch>>;
  close(conversationId: string): Promise<InboxActionResult<InboxConversationPatch>>;
  listTemplates(conversationId: string): Promise<InboxActionResult<InboxTemplateView[]>>;
}

function iso(date: Date): string;
function iso(date: Date | null): string | null;
function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

export function serializeConversation(item: InboxConversation): InboxConversationView {
  return {
    id: item.id,
    accountId: item.accountId,
    tenantId: item.tenantId,
    status: item.status,
    assignedTo: item.assignedTo,
    handoffReason: item.handoffReason,
    unreadCount: item.unreadCount,
    lastActivityAt: iso(item.lastActivityAt),
    lastInboundAt: iso(item.lastInboundAt),
    window: { open: item.window.open, expiresAt: iso(item.window.expiresAt) },
    contact: item.contact,
    lastMessagePreview:
      item.lastMessagePreview === null
        ? null
        : { ...item.lastMessagePreview, at: iso(item.lastMessagePreview.at) },
  };
}

export function serializeMessage(message: InboxMessage | Message): InboxMessageView {
  const view: InboxMessageView = {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    type: message.type,
    text: message.text,
    content: message.content,
    sender: message.sender,
    senderRef: message.senderRef,
    status: message.status,
    error: message.error,
    sentAt: iso(message.sentAt),
    createdAt: iso(message.createdAt),
    replyToMetaId: message.replyToMetaId,
    metaMessageId: message.metaMessageId,
  };
  if ("media" in message && message.media !== undefined) view.media = message.media;
  return view;
}

export function serializeConversationPatch(conversation: {
  id: string;
  status: ConversationStatus;
  assignedTo: string | null;
  handoffReason: string | null;
  unreadCount: number;
  lastActivityAt: Date;
}): InboxConversationPatch {
  return {
    id: conversation.id,
    status: conversation.status,
    assignedTo: conversation.assignedTo,
    handoffReason: conversation.handoffReason,
    unreadCount: conversation.unreadCount,
    lastActivityAt: iso(conversation.lastActivityAt),
  };
}

function templateBody(components: Template["components"]): string | null {
  for (const component of components) {
    if (component.type === "BODY" && typeof component.text === "string") return component.text;
  }
  return null;
}

export function serializeTemplate(template: Template): InboxTemplateView {
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    variableCount: template.variableCount,
    body: templateBody(template.components),
  };
}

/** Meta media type for an uploaded file (anything that is not image/audio/video is a document). */
export function mediaTypeForFile(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
