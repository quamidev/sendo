"use server";

import {
  can,
  isSendoError,
  type Actor,
  type InboxConversation,
  type InboxListQuery,
  type InboxMessage,
  type InboxReplyPayload,
  type SnippetInput,
  type Tag,
  type TagInput,
} from "@quami/sendo";
import {
  INBOX_TABS,
  mediaTypeForFile,
  serializeConversation,
  serializeMessage,
  serializeSnippet,
  serializeTemplate,
  tabStatuses,
  type InboxActionResult,
  type InboxAssigneeView,
  type InboxConversationView,
  type InboxErrorCode,
  type InboxListInput,
  type InboxListPage,
  type InboxMessageView,
  type InboxRenderedSnippet,
  type InboxReplyInput,
  type InboxSnippetInput,
  type InboxSnippetView,
  type InboxTab,
  type InboxTabCounts,
  type InboxTagInput,
  type InboxTagView,
  type InboxTemplateView,
  type InboxThreadPage,
} from "@/components/sendo/types";
import { sendo } from "@/lib/sendo";
import { contactAppHref, requireUser, resolveUserNames, type InboxUser } from "./inbox-config";

const MAX_ID_LENGTH = 200;
const MAX_SEARCH_LENGTH = 100;
const MAX_TAG_FILTERS = 50;

class InvalidInputError extends Error {}

function errorCode(error: unknown): InboxErrorCode {
  if (error instanceof InvalidInputError) return "INVALID";
  if (!isSendoError(error)) return "UNKNOWN";
  switch (error.code) {
    case "WINDOW_CLOSED":
      return "WINDOW_CLOSED";
    case "FORBIDDEN":
      return "FORBIDDEN";
    case "ACCOUNT_STATE":
      return "ACCOUNT_INACTIVE";
    case "CONSTRAINT_VIOLATION":
      return "CONFLICT";
    case "RECORD_NOT_FOUND":
    case "ACCOUNT_NOT_FOUND":
      return "NOT_FOUND";
    case "TEMPLATE_NOT_FOUND":
    case "TEMPLATE_VARIABLES":
    case "MEDIA_TOO_LARGE":
    case "UNSUPPORTED_MEDIA_TYPE":
    case "INVALID_PAYLOAD":
    case "INVALID_PHONE":
      return "INVALID";
    default:
      return "UNKNOWN";
  }
}

/** Runs `fn` and turns errors into `{ ok: false }`. Library errors carry redacted, user-safe messages. */
async function attempt<T>(fn: () => Promise<T>): Promise<InboxActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const code = errorCode(error);
    if (code === "UNKNOWN" && !isSendoError(error)) console.error("[sendo inbox]", error);
    const message =
      error instanceof InvalidInputError || isSendoError(error)
        ? error.message
        : "Unexpected error";
    return { ok: false, code, message };
  }
}

function requireId(value: unknown, what = "id"): string {
  if (typeof value !== "string" || value === "" || value.length > MAX_ID_LENGTH) {
    throw new InvalidInputError(`Invalid ${what}`);
  }
  return value;
}

/** Server action arguments come from the client: check the type, not just the signature. */
function requireFlag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new InvalidInputError("Invalid flag");
  return value;
}

/**
 * The operator as a Sendo actor (role and queues from `resolveRole` in lib/sendo.ts). Fails
 * closed: no `resolveRole`, or no role in the tenant, is `FORBIDDEN`.
 */
function actorOf(user: InboxUser): Promise<Actor> {
  return sendo.actor(user.userId, user.tenantId);
}

/** Fills assignee names `resolveUsers` didn't know from `resolveUserNames()` (inbox-config). */
async function toViews(items: InboxConversation[]): Promise<InboxConversationView[]> {
  const unnamed = [
    ...new Set(
      items.flatMap((item) =>
        item.assignee !== null && item.assignee.name === null ? [item.assignee.id] : [],
      ),
    ),
  ];
  const names = unnamed.length === 0 ? {} : await resolveUserNames(unnamed);
  return items.map((item) => {
    const view = serializeConversation(item, contactAppHref(item.contact));
    const name = view.assignee === null ? undefined : names[view.assignee.id];
    return name === undefined || view.assignee === null
      ? view
      : { ...view, assignee: { ...view.assignee, name } };
  });
}

async function toView(item: InboxConversation): Promise<InboxConversationView> {
  const [view] = await toViews([item]);
  if (view === undefined) throw new Error("unreachable");
  return view;
}

/**
 * User ids a thread page mentions: note and reply authors, approvers, `by` and the assignee of
 * system lines.
 */
function mentionedUsers(messages: InboxMessage[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.sender === "human" && message.senderRef !== null) ids.add(message.senderRef);
    if (message.approvedBy !== null) ids.add(message.approvedBy);
    const by = message.systemLine?.by ?? null;
    if (by !== null && !/^(agent:|rule:)|^(system|business_app)$/.test(by)) ids.add(by);
    const assignedTo = message.systemLine?.params.assignedTo;
    if (typeof assignedTo === "string" && assignedTo !== "") ids.add(assignedTo);
  }
  return [...ids];
}

function toPayload(input: unknown): InboxReplyPayload {
  if (typeof input !== "object" || input === null || !("kind" in input)) {
    throw new InvalidInputError("Invalid reply");
  }
  const reply = input as Partial<Record<string, unknown>>;
  if (reply.kind === "text" && typeof reply.body === "string" && reply.body.trim() !== "") {
    return { kind: "text", body: reply.body };
  }
  if (reply.kind === "media" && reply.file instanceof File) {
    const caption =
      typeof reply.caption === "string" && reply.caption !== "" ? reply.caption : undefined;
    const mediaType = mediaTypeForFile(reply.file.type);
    return {
      kind: "media",
      mediaType,
      file: reply.file,
      mimeType: reply.file.type,
      caption,
      // Meta accepts a filename only for documents.
      filename: mediaType === "document" ? reply.file.name : undefined,
    };
  }
  if (
    reply.kind === "template" &&
    typeof reply.name === "string" &&
    typeof reply.language === "string" &&
    Array.isArray(reply.variables) &&
    reply.variables.every((value) => typeof value === "string")
  ) {
    return {
      kind: "template",
      name: reply.name,
      language: reply.language,
      variables: reply.variables,
    };
  }
  throw new InvalidInputError("Invalid reply");
}

/**
 * `list` filters of a tab (status, "Assigned to me") plus number, tags and search. Conversations
 * of disconnected numbers are left out unless the operator picked that number, chose "Show
 * disconnected" or is searching.
 */
function listFilters(actor: Actor, input: InboxListInput, tab: InboxTab): InboxListQuery {
  const tagIds = Array.isArray(input.tagIds)
    ? input.tagIds
        .filter((id): id is string => typeof id === "string" && id !== "")
        .slice(0, MAX_TAG_FILTERS)
    : [];
  const search =
    typeof input.search === "string" ? input.search.trim().slice(0, MAX_SEARCH_LENGTH) : "";
  return {
    actor,
    status: tabStatuses(tab),
    mine: tab === "mine",
    includeInactiveAccounts: input.includeInactiveAccounts === true || search !== "",
    ...(typeof input.accountId === "string" && { accountId: requireId(input.accountId) }),
    ...(tagIds.length > 0 && { tagIds }),
    ...(search !== "" && { search }),
  };
}

export async function list(input: InboxListInput): Promise<InboxActionResult<InboxListPage>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const tab: InboxTab = INBOX_TABS.includes(input.tab) ? input.tab : "open";
    const cursor = typeof input.cursor === "string" ? input.cursor : null;
    const page = await sendo.inbox.list({ ...listFilters(actor, input, tab), cursor });
    let counts: InboxTabCounts | null = null;
    if (cursor === null) {
      const values = await Promise.all(
        INBOX_TABS.map((each) => sendo.inbox.count(listFilters(actor, input, each))),
      );
      counts = Object.fromEntries(
        INBOX_TABS.map((each, index) => [each, values[index] ?? 0]),
      ) as InboxTabCounts;
    }
    return { items: await toViews(page.items), nextCursor: page.nextCursor, counts };
  });
}

export async function thread(
  conversationId: string,
  cursor?: string | null,
): Promise<InboxActionResult<InboxThreadPage>> {
  const user = await requireUser();
  return attempt(async () => {
    const id = requireId(conversationId);
    const actor = await actorOf(user);
    const first = typeof cursor !== "string";
    const page = await sendo.inbox.thread(id, { actor, cursor: first ? null : cursor });
    const ids = mentionedUsers(page.items);
    const names = ids.length === 0 ? {} : await resolveUserNames(ids);
    // "Costo del agente" totals the whole conversation (admins); sent with the latest page.
    const cost = first && can(actor, "costs.view") ? await sendo.inbox.cost(id, { actor }) : null;
    return { items: page.items.map(serializeMessage), nextCursor: page.nextCursor, names, cost };
  });
}

/** Step-in reply (AC-IB-1): goes out as a person; status, assignment and the agent don't change. */
export async function reply(
  conversationId: string,
  input: InboxReplyInput,
): Promise<InboxActionResult<InboxMessageView>> {
  const user = await requireUser();
  return attempt(async () => {
    const message = await sendo.inbox.reply(requireId(conversationId), toPayload(input), {
      actor: await actorOf(user),
    });
    return serializeMessage(message);
  });
}

export async function markSeen(conversationId: string): Promise<InboxActionResult<null>> {
  const user = await requireUser();
  return attempt(async () => {
    await sendo.inbox.markSeen(requireId(conversationId), { actor: await actorOf(user) });
    return null;
  });
}

/** "Tomar conversación": assigns the operator (status becomes `human`). */
export async function take(
  conversationId: string,
): Promise<InboxActionResult<InboxConversationView>> {
  const user = await requireUser();
  return attempt(async () =>
    toView(await sendo.inbox.take(requireId(conversationId), { actor: await actorOf(user) })),
  );
}

/** Assigns `userId` (`null` unassigns). Anyone but yourself needs `conversations.reassign`. */
export async function assign(
  conversationId: string,
  userId: string | null,
): Promise<InboxActionResult<InboxConversationView>> {
  const user = await requireUser();
  return attempt(async () =>
    toView(
      await sendo.inbox.assign(
        requireId(conversationId),
        userId === null ? null : requireId(userId, "user id"),
        { actor: await actorOf(user) },
      ),
    ),
  );
}

export async function returnToAgent(
  conversationId: string,
): Promise<InboxActionResult<InboxConversationView>> {
  const user = await requireUser();
  return attempt(async () =>
    toView(
      await sendo.inbox.returnToAgent(requireId(conversationId), { actor: await actorOf(user) }),
    ),
  );
}

export async function close(
  conversationId: string,
): Promise<InboxActionResult<InboxConversationView>> {
  const user = await requireUser();
  return attempt(async () =>
    toView(await sendo.inbox.close(requireId(conversationId), { actor: await actorOf(user) })),
  );
}

/** Pauses or resumes the agent on one conversation (`conversations.pause_agent`). */
export async function pauseAgent(
  conversationId: string,
  paused: boolean,
): Promise<InboxActionResult<InboxConversationView>> {
  const user = await requireUser();
  return attempt(async () =>
    toView(
      await sendo.inbox.pauseAgent(requireId(conversationId), requireFlag(paused), {
        actor: await actorOf(user),
      }),
    ),
  );
}

/** Sends the pending draft as the agent, recording who approved it (and the edit, if any). */
export async function approveDraft(
  messageId: string,
  text?: string,
): Promise<InboxActionResult<InboxMessageView>> {
  const user = await requireUser();
  return attempt(async () => {
    const edited = typeof text === "string" && text.trim() !== "" ? text.trim() : undefined;
    const message = await sendo.inbox.approveDraft(requireId(messageId, "message id"), {
      actor: await actorOf(user),
      ...(edited !== undefined && { text: edited }),
    });
    return serializeMessage(message);
  });
}

export async function discardDraft(messageId: string): Promise<InboxActionResult<null>> {
  const user = await requireUser();
  return attempt(async () => {
    await sendo.inbox.discardDraft(requireId(messageId, "message id"), {
      actor: await actorOf(user),
    });
    return null;
  });
}

export async function addTag(
  conversationId: string,
  tagId: string,
): Promise<InboxActionResult<InboxTagView[]>> {
  const user = await requireUser();
  return attempt(async () =>
    sendo.inbox.tags.add(requireId(conversationId), requireId(tagId, "tag id"), {
      actor: await actorOf(user),
    }),
  );
}

export async function removeTag(
  conversationId: string,
  tagId: string,
): Promise<InboxActionResult<InboxTagView[]>> {
  const user = await requireUser();
  return attempt(async () =>
    sendo.inbox.tags.remove(requireId(conversationId), requireId(tagId, "tag id"), {
      actor: await actorOf(user),
    }),
  );
}

/** People the conversation can be assigned to, with names (assign menu). */
export async function listAssignees(
  conversationId: string,
): Promise<InboxActionResult<InboxAssigneeView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const people = await sendo.inbox.assignees(requireId(conversationId), {
      actor: await actorOf(user),
    });
    const unnamed = people.filter((person) => person.name === null).map((person) => person.id);
    const names = unnamed.length === 0 ? {} : await resolveUserNames(unnamed);
    return people.map((person) => ({ ...person, name: person.name ?? names[person.id] ?? null }));
  });
}

/** The tenant's tag catalog (every role may read it). */
export async function listTags(): Promise<InboxActionResult<InboxTagView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const tags = await sendo.tags.list({ actor: await actorOf(user) });
    return tags.map(toTagView);
  });
}

/** Approved templates of the conversation's WhatsApp number, for the closed-window picker. */
export async function listTemplates(
  conversationId: string,
): Promise<InboxActionResult<InboxTemplateView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const conversation = await sendo.inbox.get(requireId(conversationId), {
      actor: await actorOf(user),
    });
    const templates = await sendo.templates.list({
      account: conversation.accountId,
      status: "APPROVED",
    });
    return templates.map(serializeTemplate);
  });
}

/** Internal note (AC-IB-3): stored for the team, never sent, never in the agent's history. */
export async function note(
  conversationId: string,
  text: string,
): Promise<InboxActionResult<InboxMessageView>> {
  const user = await requireUser();
  return attempt(async () => {
    if (typeof text !== "string" || text.trim() === "") throw new InvalidInputError("Invalid note");
    const message = await sendo.inbox.note(requireId(conversationId), text.trim(), {
      actor: await actorOf(user),
    });
    return serializeMessage(message);
  });
}

/**
 * Snippets the operator can use: the team's plus their own personal ones. With a conversation,
 * only those usable on its number (every-number snippets plus that number's).
 */
export async function listSnippets(
  conversationId: string | null,
): Promise<InboxActionResult<InboxSnippetView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const accountId =
      conversationId === null
        ? undefined
        : (await sendo.inbox.get(requireId(conversationId), { actor })).accountId;
    const snippets = await sendo.snippets.list({
      actor,
      ...(accountId !== undefined && { accountId }),
    });
    return snippets.map((snippet) => serializeSnippet(snippet, actor.userId));
  });
}

/** The snippet filled for the conversation; variables without a value stay as `{{name}}`. */
export async function renderSnippet(
  snippetId: string,
  conversationId: string,
): Promise<InboxActionResult<InboxRenderedSnippet>> {
  const user = await requireUser();
  return attempt(async () =>
    sendo.snippets.render(requireId(snippetId, "snippet id"), {
      actor: await actorOf(user),
      conversationId: requireId(conversationId),
    }),
  );
}

function toSnippetInput(input: unknown): SnippetInput {
  if (typeof input !== "object" || input === null) throw new InvalidInputError("Invalid snippet");
  const value = input as Partial<Record<keyof InboxSnippetInput, unknown>>;
  if (typeof value.shortcut !== "string" || typeof value.body !== "string") {
    throw new InvalidInputError("Invalid snippet");
  }
  return {
    ...(value.id !== undefined && { id: requireId(value.id, "snippet id") }),
    shortcut: value.shortcut.trim(),
    body: value.body,
    ...((value.visibility === "tenant" || value.visibility === "personal") && {
      visibility: value.visibility,
    }),
    ...(value.accountId !== undefined && {
      accountId: value.accountId === null ? null : requireId(value.accountId, "account id"),
    }),
  };
}

/** Team snippets need `snippets.manage_tenant`; anyone manages their own personal ones. */
export async function upsertSnippet(
  input: InboxSnippetInput,
): Promise<InboxActionResult<InboxSnippetView>> {
  const user = await requireUser();
  return attempt(async () => {
    const actor = await actorOf(user);
    const snippet = await sendo.snippets.upsert(toSnippetInput(input), { actor });
    return serializeSnippet(snippet, actor.userId);
  });
}

export async function deleteSnippet(snippetId: string): Promise<InboxActionResult<null>> {
  const user = await requireUser();
  return attempt(async () => {
    await sendo.snippets.delete(requireId(snippetId, "snippet id"), {
      actor: await actorOf(user),
    });
    return null;
  });
}

function toTagView(tag: Tag): InboxTagView {
  return { id: tag.id, name: tag.name, color: tag.color };
}

function toTagInput(input: unknown): TagInput {
  if (typeof input !== "object" || input === null) throw new InvalidInputError("Invalid tag");
  const value = input as Partial<Record<keyof InboxTagInput, unknown>>;
  if (typeof value.name !== "string" || typeof value.color !== "string") {
    throw new InvalidInputError("Invalid tag");
  }
  return {
    ...(value.id !== undefined && { id: requireId(value.id, "tag id") }),
    name: value.name,
    // The package checks it against the palette (`TAG_COLORS`).
    color: value.color as TagInput["color"],
  };
}

/** Creates or edits a catalog tag (`tags.manage`). */
export async function upsertTag(input: InboxTagInput): Promise<InboxActionResult<InboxTagView>> {
  const user = await requireUser();
  return attempt(async () =>
    toTagView(await sendo.tags.upsert(toTagInput(input), { actor: await actorOf(user) })),
  );
}

/** Deletes a catalog tag and removes it from every conversation (`tags.manage`). */
export async function deleteTag(tagId: string): Promise<InboxActionResult<null>> {
  const user = await requireUser();
  return attempt(async () => {
    await sendo.tags.delete(requireId(tagId, "tag id"), { actor: await actorOf(user) });
    return null;
  });
}

/** Conversations carrying the tag, for the delete confirmation (`tags.manage`). */
export async function tagUsage(tagId: string): Promise<InboxActionResult<number>> {
  const user = await requireUser();
  return attempt(async () =>
    sendo.tags.usage(requireId(tagId, "tag id"), { actor: await actorOf(user) }),
  );
}
