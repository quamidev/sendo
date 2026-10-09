import type { ConversationFilter } from "../adapters/types";
import { isUuid } from "../core/accounts";
import type { SendoContext } from "../core/context";
import { composeOutbound } from "../core/outbound";
import { createReply } from "../core/reply";
import {
  AccountNotFoundError,
  AccountStateError,
  ForbiddenError,
  PayloadValidationError,
  RecordNotFoundError,
  WindowClosedError,
} from "../errors/errors";
import { resolveAssigneeIds } from "../team/config";
import { assertCan, assertCanSeeConversation, can, isRole, type Actor } from "../team/permissions";
import type {
  Account,
  Contact,
  Conversation,
  Message,
  MessageWithMedia,
  Tag,
} from "../types/entities";
import { windowStatus } from "../utils/window";
import type {
  InboxApi,
  InboxAssignee,
  InboxConversation,
  InboxConversationCost,
  InboxCountQuery,
  InboxHandoff,
  InboxMedia,
  InboxMessage,
  InboxMessageOrigin,
  InboxSystemLine,
  InboxTag,
  InboxTranscription,
} from "./types";
import type { TranscriptionError } from "../core/pipeline/transcribe";

export const INBOX_LIST_DEFAULT_LIMIT = 30;
export const INBOX_THREAD_DEFAULT_LIMIT = 50;
export const INBOX_MAX_LIMIT = 100;
/** Lifetime of media URLs returned by `sendo.inbox.thread`. */
export const INBOX_MEDIA_URL_TTL_SEC = 300;
/** Recent messages read per conversation for the pending draft, handoff line and preview. */
const RECENT_MESSAGES = 30;
/** TTL of the per-draft approval lock (`draft:{id}`). */
const APPROVE_LOCK_TTL_MS = 30_000;

type ConversationWithContact = Conversation & { contact: Contact };

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), INBOX_MAX_LIMIT);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Fails closed for untyped callers: no actor, or a forged role, is `FORBIDDEN`. */
function requireActor(actor: unknown): Actor {
  const candidate = actor as Partial<Actor> | null | undefined;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.userId !== "string" ||
    candidate.userId.trim() === "" ||
    candidate.tenantId === undefined ||
    !isRole(candidate.role) ||
    !Array.isArray(candidate.queues)
  ) {
    throw new ForbiddenError({ message: "Access denied: no actor (use `sendo.actor()`)." });
  }
  return candidate as Actor;
}

function toTag(tag: Tag): InboxTag {
  return { id: tag.id, name: tag.name, color: tag.color };
}

function origin(message: Message): InboxMessageOrigin | null {
  if (message.metadata.imported === true) return "imported";
  if (message.metadata.origin === "business_app") return "business_app";
  return null;
}

function systemLine(message: Message): InboxSystemLine | null {
  if (!message.internal || message.sender !== "system") return null;
  return {
    kind: message.metadata.kind === "rule" ? "rule" : "system",
    event: str(message.metadata.event),
    by: str(message.metadata.by),
  };
}

const TRANSCRIPTION_ERRORS = new Set<string>([
  "too_large",
  "timeout",
  "no_audio",
  "empty",
  "failed",
] satisfies TranscriptionError[]);

function transcription(message: Message): InboxTranscription | null {
  const value = message.metadata.transcription;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { model, ms, error } = value as Record<string, unknown>;
  return {
    model: typeof model === "string" ? model : "",
    ms: typeof ms === "number" && Number.isFinite(ms) ? ms : null,
    error:
      typeof error === "string" && TRANSCRIPTION_ERRORS.has(error)
        ? (error as TranscriptionError)
        : error === undefined || error === null
          ? null
          : "failed",
  };
}

function isVisibleToContact(message: Message): boolean {
  return !message.internal && !message.draft;
}

export function createInbox(ctx: SendoContext): InboxApi {
  const { adapter } = ctx;

  /** Another tenant's conversation is "not found"; one the actor may not see is `FORBIDDEN`. */
  async function load(conversationId: string, actor: Actor): Promise<Conversation> {
    const conversation = await adapter.conversations.get(conversationId);
    if (!conversation || conversation.tenantId !== actor.tenantId) {
      throw new RecordNotFoundError({ entity: "conversation", id: conversationId });
    }
    assertCanSeeConversation(actor, conversation);
    return conversation;
  }

  async function requireContact(conversation: Conversation): Promise<Contact> {
    const contact = await adapter.contacts.get(conversation.contactId);
    if (!contact) throw new RecordNotFoundError({ entity: "contact", id: conversation.contactId });
    return contact;
  }

  /** Replies, notes and approvals need a connected number (AC-IB-8). */
  async function requireActiveAccount(conversation: Conversation): Promise<Account> {
    const account = await adapter.accounts.getById(conversation.accountId);
    if (!account) throw new AccountNotFoundError({ account: conversation.accountId });
    if (!account.active) throw new AccountStateError({ accountId: account.id, state: "inactive" });
    return account;
  }

  async function users(ids: string[]): Promise<Map<string, InboxAssignee>> {
    const out = new Map<string, InboxAssignee>(
      ids.map((id) => [id, { id, name: null, avatarUrl: null }]),
    );
    const resolveUsers = ctx.team.resolveUsers;
    if (resolveUsers === null || ids.length === 0) return out;
    try {
      for (const user of await resolveUsers(ids)) {
        if (!out.has(user.id)) continue;
        out.set(user.id, {
          id: user.id,
          name: user.name.trim() === "" ? null : user.name,
          avatarUrl: user.avatarUrl ?? null,
        });
      }
    } catch (error) {
      ctx.logger.warn("[sendo] resolveUsers failed", error);
    }
    return out;
  }

  async function signedUrl(path: string): Promise<string | null> {
    const media = ctx.config.media;
    if (media === null) return null;
    try {
      return await media.signedUrl(path, INBOX_MEDIA_URL_TTL_SEC);
    } catch (error) {
      ctx.logger.warn("[sendo] could not sign a media URL", error);
      return null;
    }
  }

  async function toInboxMessage(
    message: Message | MessageWithMedia,
    actor: Actor,
  ): Promise<InboxMessage> {
    const { metadata } = message;
    const costs = can(actor, "costs.view");
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
      internal: message.internal,
      systemLine: systemLine(message),
      draft: message.draft,
      handoffAfterDraft: message.draft && metadata.handoffAfterDraft === true,
      approvedBy: str(metadata.approvedBy),
      edited: metadata.edited === true,
      origin: origin(message),
      source: str(metadata.source),
      tokensIn: costs ? message.tokensIn : null,
      tokensOut: costs ? message.tokensOut : null,
      costCents: costs ? message.costCents : null,
      transcription: transcription(message),
    };
    const media = "media" in message ? message.media : null;
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

  /** Adds tags, assignee, account state, pending draft and handoff to a page of conversations. */
  async function decorate(items: ConversationWithContact[]): Promise<InboxConversation[]> {
    const ids = items.map((item) => item.id);
    const accountIds = [...new Set(items.map((item) => item.accountId))];
    const assigneeIds = [
      ...new Set(items.flatMap((item) => (item.assignedTo === null ? [] : [item.assignedTo]))),
    ];
    const [accounts, tags, assignees, recent] = await Promise.all([
      Promise.all(accountIds.map((id) => adapter.accounts.getById(id))),
      ids.length === 0
        ? Promise.resolve<Record<string, Tag[]>>({})
        : adapter.tags.forConversations(ids),
      users(assigneeIds),
      Promise.all(ids.map((id) => adapter.messages.history(id, RECENT_MESSAGES))),
    ]);
    const accountById = new Map(
      accounts.flatMap((account) => (account === null ? [] : [[account.id, account] as const])),
    );

    return items.map((item, index): InboxConversation => {
      const { contact, ...conversation } = item;
      const messages = recent[index] ?? [];
      const account = accountById.get(conversation.accountId);
      const preview = messages.findLast(isVisibleToContact);
      let handoff: InboxHandoff | null = null;
      if (conversation.status === "human" && conversation.handoffReason !== null) {
        const line = messages.findLast(
          (m) => m.internal && m.sender === "system" && m.metadata.event === "handoff",
        );
        handoff = {
          reason: conversation.handoffReason,
          by: line ? str(line.metadata.by) : null,
          at: line ? line.createdAt : null,
        };
      }
      const agentPausedOn = conversation.agentPaused
        ? "conversation"
        : account?.agentPaused
          ? "account"
          : null;
      return {
        id: conversation.id,
        accountId: conversation.accountId,
        tenantId: conversation.tenantId,
        channel: conversation.channel,
        status: conversation.status,
        source: conversation.source,
        queue: conversation.queue,
        assignedTo: conversation.assignedTo,
        assignee:
          conversation.assignedTo === null
            ? null
            : (assignees.get(conversation.assignedTo) ?? {
                id: conversation.assignedTo,
                name: null,
                avatarUrl: null,
              }),
        handoffReason: conversation.handoffReason,
        handoff,
        agentPaused: agentPausedOn !== null,
        agentPausedOn,
        hasPendingDraft: messages.some((m) => m.draft),
        accountActive: account?.active ?? false,
        tags: (tags[conversation.id] ?? []).map(toTag),
        unreadCount: conversation.unreadCount,
        lastActivityAt: conversation.lastActivityAt,
        lastInboundAt: conversation.lastInboundAt,
        window: windowStatus(conversation.lastInboundAt),
        contact: {
          id: contact.id,
          phone: contact.phone,
          displayName: contact.profileName?.trim()
            ? contact.profileName
            : (contact.phone ?? contact.channelUserId ?? ""),
          appRef: contact.appRef,
        },
        lastMessagePreview: preview
          ? {
              text: preview.text,
              direction: preview.direction,
              sender: preview.sender,
              type: preview.type,
              status: preview.status,
              at: preview.createdAt,
            }
          : null,
        conversation,
      };
    });
  }

  async function view(conversation: Conversation): Promise<InboxConversation> {
    const contact = await requireContact(conversation);
    const [item] = await decorate([{ ...conversation, contact }]);
    if (!item) throw new RecordNotFoundError({ entity: "conversation", id: conversation.id });
    return item;
  }

  function filterFor(query: InboxCountQuery, actor: Actor): ConversationFilter {
    const filter: ConversationFilter = { tenantId: actor.tenantId };
    if (query.status !== undefined) filter.status = query.status;
    if (query.accountId !== undefined) filter.accountId = query.accountId;
    if (query.queue !== undefined) filter.queue = query.queue;
    if (query.tagIds !== undefined) filter.tagIds = query.tagIds;
    if (query.search !== undefined) filter.search = query.search;
    if (query.mine === true) filter.assignedTo = actor.userId;
    else if (query.assignedTo !== undefined) filter.assignedTo = query.assignedTo;
    if (!can(actor, "conversations.view_all")) {
      filter.visibleTo = { userId: actor.userId, queues: actor.queues };
    }
    return filter;
  }

  /** Assigning anyone but yourself, or taking someone else's conversation, is a reassignment. */
  function assertMayAssign(actor: Actor, current: Conversation, userId: string | null): void {
    const takesFromOther = current.assignedTo !== null && current.assignedTo !== actor.userId;
    if (userId !== actor.userId || takesFromOther) assertCan(actor, "conversations.reassign");
  }

  async function requireDraft(messageId: string, actor: Actor) {
    const message = isUuid(messageId) ? await adapter.messages.get(messageId) : null;
    if (!message?.draft) throw new RecordNotFoundError({ entity: "message", id: messageId });
    const conversation = await load(message.conversationId, actor);
    return { message, conversation };
  }

  async function conversationTags(conversationId: string): Promise<InboxTag[]> {
    const tags = await adapter.tags.forConversations([conversationId]);
    return (tags[conversationId] ?? []).map(toTag);
  }

  const { conversations } = ctx.services;

  return {
    async list(query) {
      await ctx.ready();
      const actor = requireActor(query.actor);
      const page = await adapter.conversations.list({
        ...filterFor(query, actor),
        cursor: query.cursor ?? null,
        limit: clampLimit(query.limit, INBOX_LIST_DEFAULT_LIMIT),
      });
      return { items: await decorate(page.items), nextCursor: page.nextCursor };
    },

    async count(query) {
      await ctx.ready();
      const actor = requireActor(query.actor);
      return adapter.conversations.count(filterFor(query, actor));
    },

    async get(conversationId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      return view(await load(conversationId, actor));
    },

    async thread(conversationId, query) {
      await ctx.ready();
      const actor = requireActor(query.actor);
      await load(conversationId, actor);
      const page = await adapter.messages.thread(conversationId, {
        cursor: query.cursor ?? null,
        limit: clampLimit(query.limit, INBOX_THREAD_DEFAULT_LIMIT),
      });
      return {
        items: await Promise.all(page.items.map((m) => toInboxMessage(m, actor))),
        nextCursor: page.nextCursor,
      };
    },

    async reply(conversationId, payload, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const conversation = await load(conversationId, actor);
      const account = await requireActiveAccount(conversation);
      const contact = await requireContact(conversation);

      const reply = createReply(ctx, {
        account,
        contact,
        conversation,
        sender: "human",
        senderRef: actor.userId,
      });
      let message: Message;
      switch (payload.kind) {
        case "text":
          message = await reply.text(payload.body);
          break;
        case "media":
          message = await reply.media({
            type: payload.mediaType,
            file: payload.file,
            url: payload.url,
            caption: payload.caption,
            filename: payload.filename,
            mimeType: payload.mimeType,
          });
          break;
        case "template":
          message = await reply.template(payload.name, {
            language: payload.language,
            variables: payload.variables,
          });
          break;
      }
      // A person answered: the agent's pending draft is stale.
      try {
        await adapter.messages.deleteDrafts(conversation.id);
      } catch (error) {
        ctx.logger.warn("[sendo] could not discard the pending draft", error);
      }
      return toInboxMessage(message, actor);
    },

    async note(conversationId, text, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      if (typeof text !== "string" || text.trim() === "") {
        throw new PayloadValidationError({ field: "text", message: "is required" });
      }
      const conversation = await load(conversationId, actor);
      await requireActiveAccount(conversation);
      const note = await adapter.messages.insertOutbound({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        type: "text",
        content: { body: text },
        text,
        sender: "human",
        senderRef: actor.userId,
        internal: true,
        status: "sent",
      });
      return toInboxMessage(note, actor);
    },

    async take(conversationId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const current = await load(conversationId, actor);
      assertMayAssign(actor, current, actor.userId);
      return view(await conversations.assign(current.id, actor.userId, { by: actor.userId }));
    },

    async assign(conversationId, userId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      if (userId !== null && (typeof userId !== "string" || userId.trim() === "")) {
        throw new PayloadValidationError({ field: "userId", message: "must be a user id or null" });
      }
      const current = await load(conversationId, actor);
      assertMayAssign(actor, current, userId);
      return view(await conversations.assign(current.id, userId, { by: actor.userId }));
    },

    async returnToAgent(conversationId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const current = await load(conversationId, actor);
      return view(await conversations.returnToAgent(current.id, { by: actor.userId }));
    },

    async close(conversationId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const current = await load(conversationId, actor);
      return view(await conversations.close(current.id, { by: actor.userId }));
    },

    async pauseAgent(conversationId, paused, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const current = await load(conversationId, actor);
      assertCan(actor, "conversations.pause_agent");
      return view(
        await conversations.pauseAgent(current.id, (paused as unknown) === true, {
          by: actor.userId,
        }),
      );
    },

    async approveDraft(messageId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const { message: draft, conversation } = await requireDraft(messageId, actor);
      const account = await requireActiveAccount(conversation);
      const contact = await requireContact(conversation);
      const text = opts.text ?? draft.text ?? "";
      if (typeof text !== "string" || text.trim() === "") {
        throw new PayloadValidationError({ field: "text", message: "is required" });
      }
      const window = windowStatus(conversation.lastInboundAt);
      if (!window.open) {
        throw new WindowClosedError({
          conversationId: conversation.id,
          expiresAt: window.expiresAt,
        });
      }
      const target = {
        account,
        contact,
        conversation,
        sender: "agent" as const,
        senderRef: draft.senderRef,
      };
      const composed = await composeOutbound(ctx, target, { kind: "text", body: text });

      const key = `draft:${draft.id}`;
      if (!(await adapter.locks.acquire(key, APPROVE_LOCK_TTL_MS))) {
        throw new RecordNotFoundError({ entity: "message", id: messageId });
      }
      try {
        const current = await adapter.messages.get(draft.id);
        if (!current?.draft) throw new RecordNotFoundError({ entity: "message", id: messageId });
        // No longer a draft before the send, so a new agent turn cannot delete it mid-flight.
        const claimed = await adapter.messages.update(draft.id, {
          draft: false,
          text: composed.text,
          content: composed.content,
          metadata: { approvedBy: actor.userId, edited: text !== draft.text },
        });
        const sent = await ctx.services.messages.sendStored(claimed, { ...target, ...composed });
        return await toInboxMessage(sent, actor);
      } finally {
        await adapter.locks.release(key);
      }
    },

    async discardDraft(messageId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const { conversation } = await requireDraft(messageId, actor);
      // The runtime keeps at most one pending draft per conversation.
      await adapter.messages.deleteDrafts(conversation.id);
    },

    async markSeen(conversationId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const current = await load(conversationId, actor);
      await adapter.conversations.update(current.id, { unreadCount: 0 });
    },

    async assignees(conversationId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      const conversation = await load(conversationId, actor);
      const [account, contact] = await Promise.all([
        adapter.accounts.getById(conversation.accountId),
        requireContact(conversation),
      ]);
      if (!account) throw new AccountNotFoundError({ account: conversation.accountId });
      const ids = await resolveAssigneeIds(ctx.team, ctx.config.resolveHandoffTargets, {
        tenantId: conversation.tenantId,
        queue: conversation.queue,
        account,
        conversation,
        contact,
      });
      const unique = [...new Set(ids)];
      const byId = await users(unique);
      return unique.map((id) => byId.get(id) ?? { id, name: null, avatarUrl: null });
    },

    async cost(conversationId, opts) {
      await ctx.ready();
      const actor = requireActor(opts.actor);
      assertCan(actor, "costs.view");
      await load(conversationId, actor);
      const total: InboxConversationCost = {
        turns: 0,
        tokensIn: 0,
        tokensOut: 0,
        costCents: null,
        unpricedTurns: 0,
      };
      let cursor: string | null = null;
      do {
        const page = await adapter.messages.thread(conversationId, {
          cursor,
          limit: INBOX_MAX_LIMIT,
        });
        for (const message of page.items) {
          if (message.sender !== "agent" || message.direction !== "out" || message.internal) {
            continue;
          }
          total.turns += 1;
          total.tokensIn += message.tokensIn ?? 0;
          total.tokensOut += message.tokensOut ?? 0;
          if (message.costCents === null) total.unpricedTurns += 1;
          else total.costCents = (total.costCents ?? 0) + message.costCents;
        }
        cursor = page.nextCursor;
      } while (cursor !== null);
      return total;
    },

    tags: {
      async add(conversationId, tagId, opts) {
        await ctx.ready();
        const actor = requireActor(opts.actor);
        const conversation = await load(conversationId, actor);
        if (!isUuid(tagId)) throw new RecordNotFoundError({ entity: "tag", id: tagId });
        await adapter.tags.addToConversation(conversation.id, tagId, { by: actor.userId });
        return conversationTags(conversation.id);
      },
      async remove(conversationId, tagId, opts) {
        await ctx.ready();
        const actor = requireActor(opts.actor);
        const conversation = await load(conversationId, actor);
        if (isUuid(tagId)) await adapter.tags.removeFromConversation(conversation.id, tagId);
        return conversationTags(conversation.id);
      },
    },
  };
}

/** Module installer for `SENDO_MODULES`. */
export function installInbox(ctx: SendoContext): void {
  ctx.slots.inbox = createInbox(ctx);
}
