"use server";

import {
  isWhatsAppError,
  RecordNotFoundError,
  type Conversation,
  type InboxReplyPayload,
} from "@quami/wa-li";
import {
  mediaTypeForFile,
  serializeConversation,
  serializeConversationPatch,
  serializeMessage,
  serializeTemplate,
  type InboxActionResult,
  type InboxConversationPatch,
  type InboxConversationView,
  type InboxErrorCode,
  type InboxFilter,
  type InboxListInput,
  type InboxMessageView,
  type InboxPage,
  type InboxReplyInput,
  type InboxTemplateView,
} from "@/components/whatsapp/types";
import { wa } from "@/lib/whatsapp";
import { requireUser, type InboxUser } from "./inbox-config";

const FILTERS: readonly InboxFilter[] = ["human", "agent", "closed", "all"];

class InvalidInputError extends Error {}

function errorCode(error: unknown): InboxErrorCode {
  if (error instanceof InvalidInputError) return "INVALID";
  if (!isWhatsAppError(error)) return "UNKNOWN";
  switch (error.code) {
    case "WINDOW_CLOSED":
      return "WINDOW_CLOSED";
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
    if (code === "UNKNOWN" && !isWhatsAppError(error)) console.error("[wa-li inbox]", error);
    const message =
      error instanceof InvalidInputError || isWhatsAppError(error)
        ? error.message
        : "Unexpected error";
    return { ok: false, code, message };
  }
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value === "" || value.length > 200) {
    throw new InvalidInputError("Invalid conversation id");
  }
  return value;
}

/** The conversation, only when it belongs to the operator's tenant. */
async function requireConversation(user: InboxUser, id: unknown): Promise<Conversation> {
  const conversationId = requireId(id);
  const conversation = await wa.conversations.get(conversationId);
  if (conversation === null || conversation.tenantId !== user.tenantId) {
    throw new RecordNotFoundError({ entity: "conversation", id: conversationId });
  }
  return conversation;
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

export async function list(
  input: InboxListInput,
): Promise<InboxActionResult<InboxPage<InboxConversationView>>> {
  const user = await requireUser();
  return attempt(async () => {
    const filter: InboxFilter = FILTERS.includes(input.filter) ? input.filter : "human";
    const page = await wa.inbox.list({
      tenantId: user.tenantId,
      status: filter === "all" ? undefined : filter,
      assignedTo: input.assignedToMe ? user.userId : undefined,
      cursor: typeof input.cursor === "string" ? input.cursor : null,
    });
    return { items: page.items.map(serializeConversation), nextCursor: page.nextCursor };
  });
}

export async function thread(
  conversationId: string,
  cursor?: string | null,
): Promise<InboxActionResult<InboxPage<InboxMessageView>>> {
  const user = await requireUser();
  return attempt(async () => {
    const page = await wa.inbox.thread(requireId(conversationId), {
      tenantId: user.tenantId,
      cursor: typeof cursor === "string" ? cursor : null,
    });
    return { items: page.items.map(serializeMessage), nextCursor: page.nextCursor };
  });
}

export async function reply(
  conversationId: string,
  input: InboxReplyInput,
): Promise<InboxActionResult<InboxMessageView>> {
  const user = await requireUser();
  return attempt(async () => {
    const message = await wa.inbox.reply(requireId(conversationId), toPayload(input), {
      userId: user.userId,
      tenantId: user.tenantId,
    });
    return serializeMessage(message);
  });
}

export async function markSeen(
  conversationId: string,
): Promise<InboxActionResult<InboxConversationPatch>> {
  const user = await requireUser();
  return attempt(async () =>
    serializeConversationPatch(
      await wa.inbox.markSeen(requireId(conversationId), { tenantId: user.tenantId }),
    ),
  );
}

/** "Tomar": assigns the conversation to the operator (status becomes `human`). */
export async function take(
  conversationId: string,
): Promise<InboxActionResult<InboxConversationPatch>> {
  const user = await requireUser();
  return attempt(async () => {
    const conversation = await requireConversation(user, conversationId);
    return serializeConversationPatch(
      await wa.conversations.assign(conversation.id, user.userId, { by: user.userId }),
    );
  });
}

export async function returnToAgent(
  conversationId: string,
): Promise<InboxActionResult<InboxConversationPatch>> {
  const user = await requireUser();
  return attempt(async () => {
    const conversation = await requireConversation(user, conversationId);
    return serializeConversationPatch(
      await wa.conversations.returnToAgent(conversation.id, { by: user.userId }),
    );
  });
}

export async function close(
  conversationId: string,
): Promise<InboxActionResult<InboxConversationPatch>> {
  const user = await requireUser();
  return attempt(async () => {
    const conversation = await requireConversation(user, conversationId);
    return serializeConversationPatch(
      await wa.conversations.close(conversation.id, { by: user.userId }),
    );
  });
}

/** Approved templates of the conversation's WhatsApp number, for the closed-window picker. */
export async function listTemplates(
  conversationId: string,
): Promise<InboxActionResult<InboxTemplateView[]>> {
  const user = await requireUser();
  return attempt(async () => {
    const conversation = await requireConversation(user, conversationId);
    const templates = await wa.templates.list({
      account: conversation.accountId,
      status: "APPROVED",
    });
    return templates.map(serializeTemplate);
  });
}
