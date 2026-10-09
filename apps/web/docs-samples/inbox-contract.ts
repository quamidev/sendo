// components/sendo/types.ts (excerpt): the contract between <Inbox> and your server actions.
import type {
  InboxAssignee,
  InboxConversation,
  InboxMessage,
  InboxTag,
  Template,
} from "@quami/sendo";

/** Dates become ISO strings when they cross the server-action boundary. */
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

type InboxConversationView = Serialized<Omit<InboxConversation, "conversation">> & {
  appHref: string | null;
};
type InboxMessageView = Serialized<InboxMessage>;
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
interface InboxSnippetView {
  id: string;
  shortcut: string;
  body: string;
  visibility: "tenant" | "personal";
  accountId: string | null;
  own: boolean;
}

// #region actions
export type InboxActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code:
        | "WINDOW_CLOSED"
        | "NOT_FOUND"
        | "INVALID"
        | "FORBIDDEN"
        | "ACCOUNT_INACTIVE" // the number was disconnected: "Número desconectado"
        | "CONFLICT" // duplicate snippet shortcut or tag name
        | "UNKNOWN";
      message: string;
    };

export type InboxTab = "open" | "mine" | "agent" | "human" | "closed";

export type InboxReplyInput =
  | { kind: "text"; body: string }
  | { kind: "media"; file: File; caption?: string }
  | { kind: "template"; name: string; language: string; variables: string[] };

type Result<T> = Promise<InboxActionResult<T>>;

export interface InboxActions {
  list(input: {
    tab: InboxTab;
    accountId?: string | null;
    tagIds?: string[]; // any-match
    search?: string; // name, app reference or phone
    cursor?: string | null;
  }): Result<InboxPage<InboxConversationView> & { counts: Record<InboxTab, number> | null }>;
  /** Newest first, notes, system lines and drafts included, plus display names. */
  thread(
    conversationId: string,
    cursor?: string | null,
  ): Result<InboxPage<InboxMessageView> & { names: Record<string, string> }>;
  reply(conversationId: string, input: InboxReplyInput): Result<InboxMessageView>;
  markSeen(conversationId: string): Result<null>;
  take(conversationId: string): Result<InboxConversationView>;
  assign(conversationId: string, userId: string | null): Result<InboxConversationView>;
  returnToAgent(conversationId: string): Result<InboxConversationView>;
  close(conversationId: string): Result<InboxConversationView>;
  pauseAgent(conversationId: string, paused: boolean): Result<InboxConversationView>;
  approveDraft(messageId: string, text?: string): Result<InboxMessageView>;
  discardDraft(messageId: string): Result<null>;
  addTag(conversationId: string, tagId: string): Result<InboxTag[]>;
  removeTag(conversationId: string, tagId: string): Result<InboxTag[]>;
  listAssignees(conversationId: string): Result<InboxAssignee[]>;
  listTags(): Result<InboxTag[]>;
  listTemplates(conversationId: string): Result<InboxTemplateView[]>;
  // Optional: the UI hides note mode, the snippet picker and the admin sheets without them.
  note?(conversationId: string, text: string): Result<InboxMessageView>;
  listSnippets?(conversationId: string | null): Result<InboxSnippetView[]>;
  renderSnippet?(
    snippetId: string,
    conversationId: string,
  ): Result<{ text: string; unresolved: string[] }>;
}
// #endregion actions

// #region strings
// <Inbox strings={{ ... }} /> — override any key; the rest keep the Spanish defaults.
export const inboxStrings = {
  tabHuman: "Con persona",
  take: "Asignarme",
  templateExplanation: "La ventana de 24 horas cerró. Envía una plantilla aprobada.",
  unreadCount: (count: number) => (count === 1 ? "1 nuevo" : `${String(count)} nuevos`),
};
// #endregion strings
