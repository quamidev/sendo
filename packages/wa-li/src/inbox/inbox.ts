import type { ConversationListItem } from "../adapters/types";
import type { WhatsAppContext } from "../core/context";
import { createReply } from "../core/reply";
import { PayloadValidationError, RecordNotFoundError } from "../errors/errors";
import type { Conversation, MessageWithMedia } from "../types/entities";
import { windowStatus } from "../utils/window";
import type {
  InboxApi,
  InboxConversation,
  InboxMedia,
  InboxMessage,
  InboxTenantOption,
} from "./types";

export const INBOX_LIST_DEFAULT_LIMIT = 30;
export const INBOX_THREAD_DEFAULT_LIMIT = 50;
export const INBOX_MAX_LIMIT = 100;
/** Lifetime of media URLs returned by `wa.inbox.thread`. */
export const INBOX_MEDIA_URL_TTL_SEC = 300;

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), INBOX_MAX_LIMIT);
}

function toInboxConversation(item: ConversationListItem): InboxConversation {
  const { contact, lastMessage, ...conversation } = item;
  return {
    id: conversation.id,
    accountId: conversation.accountId,
    tenantId: conversation.tenantId,
    status: conversation.status,
    assignedTo: conversation.assignedTo,
    handoffReason: conversation.handoffReason,
    unreadCount: conversation.unreadCount,
    lastActivityAt: conversation.lastActivityAt,
    lastInboundAt: conversation.lastInboundAt,
    window: windowStatus(conversation.lastInboundAt),
    contact: {
      id: contact.id,
      phone: contact.phone,
      displayName: contact.profileName?.trim() ? contact.profileName : contact.phone,
      appRef: contact.appRef,
    },
    lastMessagePreview: lastMessage && {
      text: lastMessage.text,
      direction: lastMessage.direction,
      sender: lastMessage.sender,
      type: lastMessage.type,
      status: lastMessage.status,
      at: lastMessage.createdAt,
    },
    conversation,
  };
}

export function createInbox(ctx: WhatsAppContext): InboxApi {
  const { adapter } = ctx;

  async function requireConversation(
    id: string,
    opts: InboxTenantOption = {},
  ): Promise<Conversation> {
    const conversation = await adapter.conversations.get(id);
    if (!conversation || (opts.tenantId !== undefined && conversation.tenantId !== opts.tenantId)) {
      throw new RecordNotFoundError({ entity: "conversation", id });
    }
    return conversation;
  }

  async function signedUrl(path: string): Promise<string | null> {
    try {
      return await adapter.storage.signedUrl(path, INBOX_MEDIA_URL_TTL_SEC);
    } catch (error) {
      ctx.logger.warn("[wa-li] could not sign a media URL", error);
      return null;
    }
  }

  async function toInboxMessage(message: MessageWithMedia): Promise<InboxMessage> {
    const item: InboxMessage = {
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
      sentAt: message.sentAt,
      createdAt: message.createdAt,
      replyToMetaId: message.replyToMetaId,
      metaMessageId: message.metaMessageId,
    };
    const media = message.media;
    if (media) {
      const path = media.storagePath;
      const out: InboxMedia = {
        url: media.downloadStatus === "done" && path ? await signedUrl(path) : null,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        downloadStatus: media.downloadStatus,
      };
      const filename = message.content.filename;
      if (typeof filename === "string" && filename !== "") out.filename = filename;
      item.media = out;
    }
    return item;
  }

  return {
    async list(query) {
      await ctx.ready();
      const page = await adapter.conversations.list({
        tenantId: query.tenantId,
        accountId: query.accountId,
        status: query.status,
        assignedTo: query.assignedTo,
        cursor: query.cursor ?? null,
        limit: clampLimit(query.limit, INBOX_LIST_DEFAULT_LIMIT),
      });
      return { items: page.items.map(toInboxConversation), nextCursor: page.nextCursor };
    },

    async thread(conversationId, query = {}) {
      await ctx.ready();
      await requireConversation(conversationId, query);
      const page = await adapter.messages.thread(conversationId, {
        cursor: query.cursor ?? null,
        limit: clampLimit(query.limit, INBOX_THREAD_DEFAULT_LIMIT),
      });
      return {
        items: await Promise.all(page.items.map(toInboxMessage)),
        nextCursor: page.nextCursor,
      };
    },

    async reply(conversationId, payload, opts) {
      await ctx.ready();
      if (typeof opts.userId !== "string" || opts.userId.trim() === "") {
        throw new PayloadValidationError({ field: "userId", message: "is required" });
      }
      const conversation = await requireConversation(conversationId, opts);
      const account = await ctx.resolveAccount({ account: conversation.accountId });
      const contact = await adapter.contacts.get(conversation.contactId);
      if (!contact)
        throw new RecordNotFoundError({ entity: "contact", id: conversation.contactId });

      const reply = createReply(ctx, {
        account,
        contact,
        conversation,
        sender: "human",
        senderRef: opts.userId,
      });
      switch (payload.kind) {
        case "text":
          return reply.text(payload.body);
        case "media":
          return reply.media({
            type: payload.mediaType,
            file: payload.file,
            url: payload.url,
            caption: payload.caption,
            filename: payload.filename,
            mimeType: payload.mimeType,
          });
        case "template":
          return reply.template(payload.name, {
            language: payload.language,
            variables: payload.variables,
          });
      }
    },

    async markSeen(conversationId, opts) {
      await ctx.ready();
      await requireConversation(conversationId, opts);
      return adapter.conversations.update(conversationId, { unreadCount: 0 });
    },
  };
}

/** Module installer for `WHATSAPP_MODULES`. */
export function installInbox(ctx: WhatsAppContext): void {
  ctx.slots.inbox = createInbox(ctx);
}
