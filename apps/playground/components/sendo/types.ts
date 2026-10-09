import type {
  ConversationStatus,
  InboxAssignee,
  InboxConversation,
  InboxConversationCost,
  InboxMessage,
  InboxTag,
  Snippet,
  SnippetVisibility,
  TagColor,
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

export type InboxConversationView = Serialized<Omit<InboxConversation, "conversation">> & {
  /** Link to the contact in your app ("Ver … en la app"), from `contactAppHref()` in inbox-config. */
  appHref: string | null;
};
export type InboxMessageView = Serialized<InboxMessage>;
export type InboxTagView = InboxTag;
export type InboxAssigneeView = InboxAssignee;

export interface InboxTemplateView {
  id: string;
  name: string;
  language: string;
  category: Template["category"];
  variableCount: number;
  /** BODY text with `{{n}}` placeholders, for the preview. */
  body: string | null;
}

/** A WhatsApp number of the tenant (number selector, context panel). */
export interface InboxNumberView {
  id: string;
  /** `label`, else the display phone. */
  label: string;
  displayPhone: string;
  active: boolean;
}

/** A snippet as the composer picker and the manager see it (SND-3.6). */
export interface InboxSnippetView {
  id: string;
  shortcut: string;
  body: string;
  visibility: SnippetVisibility;
  accountId: string | null;
  /** The signed-in operator owns it (personal snippets). */
  own: boolean;
}

export interface InboxSnippetInput {
  id?: string;
  shortcut: string;
  body: string;
  visibility?: SnippetVisibility;
  accountId?: string | null;
}

export interface InboxTagInput {
  id?: string;
  name: string;
  color: TagColor;
}

/** A snippet body filled for one conversation; `unresolved` variables stay as `{{name}}`. */
export interface InboxRenderedSnippet {
  text: string;
  unresolved: string[];
}

/**
 * What the signed-in operator may do, decided on the server (`can(actor, …)` in page.tsx). The UI
 * only hides controls; every action is checked again by the package.
 */
export interface InboxPermissions {
  /** Supervisor/admin: assign to someone else (`conversations.reassign`). */
  reassign: boolean;
  /** Supervisor/admin: pause the agent on a conversation (`conversations.pause_agent`). */
  pauseAgent: boolean;
  /** Admin: model tokens and cost (`costs.view`). */
  viewCosts: boolean;
  /** Admin: tenant snippets (`snippets.manage_tenant`). */
  manageSnippets: boolean;
  /** Admin: tag catalog (`tags.manage`). */
  manageTags: boolean;
}

export const NO_PERMISSIONS: InboxPermissions = {
  reassign: false,
  pauseAgent: false,
  viewCosts: false,
  manageSnippets: false,
  manageTags: false,
};

/** Rail links to the other Sendo screens; `null` hides the entry (item not installed). */
export interface InboxNavLinks {
  numbers: string | null;
  rules: string | null;
  /** Envíos (`@sendo/sendo-broadcasts`). */
  broadcasts: string | null;
  metrics: string | null;
  links: string | null;
}

export const NO_NAV_LINKS: InboxNavLinks = {
  numbers: null,
  rules: null,
  broadcasts: null,
  metrics: null,
  links: null,
};

/** The signed-in operator. */
export interface InboxCurrentUser {
  id: string;
  /** From `resolveUserNames()`; `null` shows "Tú". */
  name: string | null;
}

export interface InboxPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** List tabs (mockup option A). `open` = agent + human; `mine` = open and assigned to me. */
export type InboxTab = "open" | "mine" | "agent" | "human" | "closed";

export const INBOX_TABS: readonly InboxTab[] = ["open", "mine", "agent", "human", "closed"];

export type InboxTabCounts = Record<InboxTab, number>;

export interface InboxListInput {
  tab: InboxTab;
  /** One number of the tenant, or every number. */
  accountId?: string | null;
  /** Any-match. */
  tagIds?: string[];
  /** Name, app reference or phone. */
  search?: string;
  cursor?: string | null;
}

export interface InboxListPage extends InboxPage<InboxConversationView> {
  /** Tab counts with the same number / tag / search filters; only on the first page. */
  counts: InboxTabCounts | null;
}

export interface InboxThreadPage extends InboxPage<InboxMessageView> {
  /** Display names of the people in this page (note authors, approvers, `by` of system lines). */
  names: Record<string, string>;
  /**
   * Agent turns of the whole conversation and their cost (`sendo.inbox.cost`), on the latest page
   * for actors with `costs.view`; otherwise `null` or omitted (the panel totals the loaded pages).
   */
  cost?: InboxConversationCost | null;
}

export type InboxErrorCode =
  | "WINDOW_CLOSED"
  | "NOT_FOUND"
  | "INVALID"
  | "FORBIDDEN"
  /** The conversation's number was disconnected ("Número desconectado"); reads still work. */
  | "ACCOUNT_INACTIVE"
  /** A duplicate snippet shortcut or tag name. */
  | "CONFLICT"
  | "UNKNOWN";

export type InboxActionResult<T> =
  { ok: true; data: T } | { ok: false; code: InboxErrorCode; message: string };

export type InboxReplyInput =
  | { kind: "text"; body: string }
  | { kind: "media"; file: File; caption?: string }
  | { kind: "template"; name: string; language: string; variables: string[] };

/**
 * The server actions the inbox calls. `app/(protected)/inbox/actions.ts` implements them with
 * `sendo.inbox.*`, `sendo.snippets.*` and `sendo.tags.*`; apps can pass their own implementation.
 *
 * The optional members belong to the composer and the admin sheets (SND-3.6): the UI hides the
 * feature (note mode, snippet picker, managers) when an action is missing.
 */
export interface InboxActions {
  list(input: InboxListInput): Promise<InboxActionResult<InboxListPage>>;
  /** Newest first; `nextCursor` loads older messages. Notes, system lines and drafts included. */
  thread(
    conversationId: string,
    cursor?: string | null,
  ): Promise<InboxActionResult<InboxThreadPage>>;
  /** Step-in reply: sends as a person without changing status or assignment. */
  reply(
    conversationId: string,
    input: InboxReplyInput,
  ): Promise<InboxActionResult<InboxMessageView>>;
  markSeen(conversationId: string): Promise<InboxActionResult<null>>;
  /** "Tomar conversación": assigns the operator and moves to `human`. */
  take(conversationId: string): Promise<InboxActionResult<InboxConversationView>>;
  /** `null` unassigns. Anyone but yourself needs `reassign`. */
  assign(
    conversationId: string,
    userId: string | null,
  ): Promise<InboxActionResult<InboxConversationView>>;
  returnToAgent(conversationId: string): Promise<InboxActionResult<InboxConversationView>>;
  close(conversationId: string): Promise<InboxActionResult<InboxConversationView>>;
  pauseAgent(
    conversationId: string,
    paused: boolean,
  ): Promise<InboxActionResult<InboxConversationView>>;
  /** Sends the pending draft; `text` sends an edited version. */
  approveDraft(messageId: string, text?: string): Promise<InboxActionResult<InboxMessageView>>;
  discardDraft(messageId: string): Promise<InboxActionResult<null>>;
  /** Returns the conversation's tags. */
  addTag(conversationId: string, tagId: string): Promise<InboxActionResult<InboxTagView[]>>;
  removeTag(conversationId: string, tagId: string): Promise<InboxActionResult<InboxTagView[]>>;
  /** People the conversation can be assigned to (assign menu). */
  listAssignees(conversationId: string): Promise<InboxActionResult<InboxAssigneeView[]>>;
  /** The tenant's tag catalog (filter chips, tag picker). */
  listTags(): Promise<InboxActionResult<InboxTagView[]>>;
  listTemplates(conversationId: string): Promise<InboxActionResult<InboxTemplateView[]>>;
  // SND-3.6: composer and admin sheets.
  /** Internal note: never sent, the agent never sees it. */
  note?(conversationId: string, text: string): Promise<InboxActionResult<InboxMessageView>>;
  /** Snippets usable on this conversation's number (tenant + own personal ones). */
  listSnippets?(conversationId: string | null): Promise<InboxActionResult<InboxSnippetView[]>>;
  renderSnippet?(
    snippetId: string,
    conversationId: string,
  ): Promise<InboxActionResult<InboxRenderedSnippet>>;
  upsertSnippet?(input: InboxSnippetInput): Promise<InboxActionResult<InboxSnippetView>>;
  deleteSnippet?(snippetId: string): Promise<InboxActionResult<null>>;
  upsertTag?(input: InboxTagInput): Promise<InboxActionResult<InboxTagView>>;
  deleteTag?(tagId: string): Promise<InboxActionResult<null>>;
  /** Conversations carrying the tag (delete confirmation). */
  tagUsage?(tagId: string): Promise<InboxActionResult<number>>;
}

function iso(date: Date): string;
function iso(date: Date | null): string | null;
function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

export function serializeConversation(
  item: InboxConversation,
  appHref: string | null = null,
): InboxConversationView {
  return {
    id: item.id,
    accountId: item.accountId,
    tenantId: item.tenantId,
    channel: item.channel,
    status: item.status,
    source: item.source,
    queue: item.queue,
    assignedTo: item.assignedTo,
    assignee: item.assignee,
    handoffReason: item.handoffReason,
    handoff:
      item.handoff === null
        ? null
        : { reason: item.handoff.reason, by: item.handoff.by, at: iso(item.handoff.at) },
    agentPaused: item.agentPaused,
    agentPausedOn: item.agentPausedOn,
    hasPendingDraft: item.hasPendingDraft,
    accountActive: item.accountActive,
    tags: item.tags,
    unreadCount: item.unreadCount,
    lastActivityAt: iso(item.lastActivityAt),
    lastInboundAt: iso(item.lastInboundAt),
    window: { open: item.window.open, expiresAt: iso(item.window.expiresAt) },
    contact: item.contact,
    lastMessagePreview:
      item.lastMessagePreview === null
        ? null
        : { ...item.lastMessagePreview, at: iso(item.lastMessagePreview.at) },
    appHref,
  };
}

export function serializeMessage(message: InboxMessage): InboxMessageView {
  const { media, sentAt, createdAt, ...rest } = message;
  const view: InboxMessageView = { ...rest, sentAt: iso(sentAt), createdAt: iso(createdAt) };
  if (media !== undefined) view.media = media;
  return view;
}

export function serializeSnippet(snippet: Snippet, userId: string): InboxSnippetView {
  return {
    id: snippet.id,
    shortcut: snippet.shortcut,
    body: snippet.body,
    visibility: snippet.visibility,
    accountId: snippet.accountId,
    own: snippet.ownerUserId === userId,
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

/** Server filters of a list tab (also used to keep realtime patches consistent with the tab). */
export function tabStatuses(tab: InboxTab): ConversationStatus[] {
  switch (tab) {
    case "open":
    case "mine":
      return ["agent", "human"];
    case "agent":
      return ["agent"];
    case "human":
      return ["human"];
    case "closed":
      return ["closed"];
  }
}

export function matchesTab(
  conversation: Pick<InboxConversationView, "status" | "assignedTo">,
  tab: InboxTab,
  currentUserId: string,
): boolean {
  if (!tabStatuses(tab).includes(conversation.status)) return false;
  return tab !== "mine" || conversation.assignedTo === currentUserId;
}
