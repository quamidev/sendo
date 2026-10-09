// components/whatsapp/types.ts (excerpt): the contract between <Inbox> and your server actions.
import type { ConversationStatus, InboxConversation, InboxMessage, Template } from "@quami/wa-li";

/** Dates become ISO strings when they cross the server-action boundary. */
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

type InboxConversationView = Serialized<Omit<InboxConversation, "conversation">>;
type InboxMessageView = Serialized<InboxMessage>;
type InboxConversationPatch = Pick<
  InboxConversationView,
  "id" | "status" | "assignedTo" | "handoffReason" | "unreadCount" | "lastActivityAt"
>;
interface InboxPage<T> {
  items: T[];
  nextCursor: string | null;
}
interface InboxTemplateView {
  id: string;
  name: string;
  language: string;
  category: Template["category"];
  variableCount: number;
  body: string | null;
}

// #region actions
export type InboxActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "WINDOW_CLOSED" | "NOT_FOUND" | "INVALID" | "UNKNOWN"; message: string };

export type InboxFilter = ConversationStatus | "all";

export type InboxReplyInput =
  | { kind: "text"; body: string }
  | { kind: "media"; file: File; caption?: string }
  | { kind: "template"; name: string; language: string; variables: string[] };

export interface InboxActions {
  list(input: {
    filter: InboxFilter;
    assignedToMe: boolean;
    cursor?: string | null;
  }): Promise<InboxActionResult<InboxPage<InboxConversationView>>>;
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
// #endregion actions

// #region strings
// <Inbox strings={{ ... }} /> — override any key; the rest keep the Spanish defaults.
export const inboxStrings = {
  filterHuman: "Personas",
  take: "Asignarme",
  templateExplanation: "La ventana de 24 horas cerró. Envía una plantilla aprobada.",
  unreadCount: (count: number) => (count === 1 ? "1 nuevo" : `${String(count)} nuevos`),
};
// #endregion strings
