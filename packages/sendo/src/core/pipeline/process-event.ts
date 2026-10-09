import { RecordNotFoundError } from "../../errors/errors";
import type {
  Account,
  Contact,
  Conversation,
  MessageError,
  MessageWithMedia,
  SendoEvent,
} from "../../types/entities";
import type { EventStatus } from "../../types/enums";
import { mediaPath } from "../../utils/media";
import { redactText } from "../../utils/redact";
import { messageText, parseWebhook, toContent } from "../../webhook/parse";
import type {
  InboundMediaMessage,
  InboundMessage,
  ParsedChange,
  StatusUpdate,
} from "../../webhook/schemas";
import type { SendoContext } from "../context";
import { createReply } from "../reply";

const MEDIA_TYPES = new Set<InboundMessage["type"]>([
  "image",
  "audio",
  "video",
  "document",
  "sticker",
]);
/** One retry after the first failed download. */
const MEDIA_ATTEMPTS = 2;

function isMediaMessage(message: InboundMessage): message is InboundMediaMessage {
  return MEDIA_TYPES.has(message.type);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function toMessageError(status: StatusUpdate): MessageError | undefined {
  const [first] = status.errors ?? [];
  if (first === undefined) return undefined;
  return {
    code: first.code,
    title: first.title,
    message: first.message ?? first.title,
    ...(first.details === undefined ? {} : { details: first.details }),
  };
}

interface ChangeOutcome {
  routed: boolean;
  errors: string[];
}

async function downloadMedia(
  ctx: SendoContext,
  account: Account,
  conversation: Conversation,
  messageId: string,
  message: InboundMediaMessage,
): Promise<void> {
  const { adapter, transport } = ctx;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MEDIA_ATTEMPTS; attempt++) {
    try {
      const fetched = await ctx.callTransport(account, () =>
        transport.fetchMedia(account, message.mediaId),
      );
      const mimeType = fetched.mimeType || message.mimeType;
      const storagePath = mediaPath({
        tenantId: account.tenantId,
        accountId: account.id,
        conversationId: conversation.id,
        metaMediaId: message.mediaId,
        mime: mimeType,
      });
      await adapter.storage.put(storagePath, fetched.bytes, mimeType);
      await adapter.media.insert({
        tenantId: account.tenantId,
        messageId,
        metaMediaId: message.mediaId,
        mimeType,
        sizeBytes: fetched.fileSize ?? fetched.bytes.byteLength,
        sha256: fetched.sha256 ?? message.sha256 ?? null,
        storagePath,
        downloadStatus: "done",
      });
      return;
    } catch (error) {
      lastError = error;
      ctx.logger.warn(
        `[sendo] media ${message.mediaId} download attempt ${attempt}/${MEDIA_ATTEMPTS} failed`,
        error,
      );
    }
  }
  ctx.logger.error(`[sendo] media ${message.mediaId} could not be downloaded`, lastError);
  await adapter.media.insert({
    tenantId: account.tenantId,
    messageId,
    metaMediaId: message.mediaId,
    mimeType: message.mimeType,
    sha256: message.sha256 ?? null,
    downloadStatus: "failed",
  });
}

async function dispatchToAgent(
  ctx: SendoContext,
  input: { account: Account; contact: Contact; conversationId: string; message: MessageWithMedia },
): Promise<void> {
  const dispatcher = ctx.agentDispatcher;
  if (dispatcher === undefined) return;
  const conversation = await ctx.adapter.conversations.get(input.conversationId);
  if (conversation?.status !== "agent") return;
  try {
    await dispatcher.handleInbound({
      account: input.account,
      contact: input.contact,
      conversation,
      message: input.message,
    });
  } catch (error) {
    ctx.logger.error(`[sendo] agent dispatch failed for conversation ${conversation.id}`, error);
  }
}

interface StoredInbound {
  contact: Contact;
  conversationId: string;
  message: MessageWithMedia;
}

/**
 * Steps 3–8 for one inbound message (agent dispatch happens per conversation once the
 * whole change is stored). Returns null without side effects when the Meta id is already
 * stored (replays, Meta retries, reprocess).
 */
async function processMessage(
  ctx: SendoContext,
  account: Account,
  change: ParsedChange,
  message: InboundMessage,
): Promise<StoredInbound | null> {
  const { adapter, services } = ctx;
  // Cheap pre-check so a replay never touches contacts or reopens a closed conversation;
  // `insertInbound` returning null is the authoritative (race-safe) dedupe.
  if ((await adapter.messages.getByMetaId(message.metaMessageId)) !== null) return null;

  const profileName = change.contacts.find((c) => c.waId === message.from)?.profileName ?? null;
  const { contact } = await services.contacts.ensure({
    account,
    phone: `+${message.from}`,
    waId: message.from,
    profileName,
  });
  const { conversation: open } = await services.conversations.ensure({ account, contact });

  const inserted = await adapter.messages.insertInbound({
    tenantId: account.tenantId,
    conversationId: open.id,
    metaMessageId: message.metaMessageId,
    type: message.type,
    content: toContent(message),
    text: messageText(message),
    replyToMetaId: message.context?.replyToMetaId ?? null,
    sentAt: message.timestamp,
  });
  if (inserted === null) return null;

  // Only a stored message bumps unread, activity and the 24 h window.
  const { conversation } = await services.conversations.ensure({
    account,
    contact,
    inbound: { at: message.timestamp },
  });

  if (isMediaMessage(message)) {
    await downloadMedia(ctx, account, conversation, inserted.id, message);
  }
  const stored = (await adapter.messages.get(inserted.id)) ?? { ...inserted, media: null };

  await ctx.emitter.emit("message", {
    message: stored,
    contact,
    conversation,
    account,
    reply: createReply(ctx, {
      account,
      contact,
      conversation,
      sender: "system",
      senderRef: null,
      message: stored,
    }),
  });

  return { contact, conversationId: conversation.id, message: stored };
}

async function processStatus(ctx: SendoContext, status: StatusUpdate): Promise<void> {
  const error = toMessageError(status);
  const result = await ctx.adapter.messages.updateStatus(status.metaMessageId, status.status, {
    ...(error === undefined ? {} : { error }),
    at: status.timestamp,
  });
  // `ignored`: not a forward move. `placeholder`: no row yet; markSent merges it later.
  if (result !== "updated") return;
  const message = await ctx.adapter.messages.getByMetaId(status.metaMessageId);
  if (message === null) return;
  await ctx.emitter.emit("status", {
    message,
    status: status.status,
    ...(error === undefined ? {} : { error }),
  });
}

async function processChange(
  ctx: SendoContext,
  change: ParsedChange,
  raw: unknown,
): Promise<ChangeOutcome> {
  const account = await ctx.adapter.accounts.getByPhoneNumberId(change.phoneNumberId);
  if (account === null || !account.active) {
    ctx.logger.warn(
      `[sendo] webhook for unknown phone_number_id ${change.phoneNumberId}; event left unrouted`,
    );
    await ctx.emitter.emit("event.unrouted", { phoneNumberId: change.phoneNumberId, raw });
    return { routed: false, errors: [] };
  }

  const errors: string[] = [];
  // A burst batched into one payload gets one agent turn per conversation, with the last
  // stored message; Map keeps first-appearance order while the value tracks the latest.
  const latestByConversation = new Map<string, StoredInbound>();
  for (const message of change.messages) {
    try {
      const stored = await processMessage(ctx, account, change, message);
      if (stored !== null) latestByConversation.set(stored.conversationId, stored);
    } catch (error) {
      ctx.logger.error(`[sendo] inbound message ${message.metaMessageId} failed`, error);
      errors.push(`message ${message.metaMessageId}: ${errorMessage(error)}`);
    }
  }
  for (const stored of latestByConversation.values()) {
    try {
      await dispatchToAgent(ctx, { account, ...stored });
    } catch (error) {
      ctx.logger.error(`[sendo] agent dispatch for ${stored.conversationId} failed`, error);
      errors.push(`agent ${stored.conversationId}: ${errorMessage(error)}`);
    }
  }
  for (const status of change.statuses) {
    try {
      await processStatus(ctx, status);
    } catch (error) {
      ctx.logger.error(`[sendo] status ${status.metaMessageId} failed`, error);
      errors.push(`status ${status.metaMessageId}: ${errorMessage(error)}`);
    }
  }
  return { routed: true, errors };
}

/**
 * The background part of the webhook pipeline for one stored `sendo_events` row.
 * Safe to run again (dedupe by Meta message id, forward-only statuses).
 *
 * Per change: route by `phone_number_id` (unknown → `event.unrouted`) → for each message:
 * dedupe pre-check → contact upsert (+ `linkContact`) → open/reopen conversation →
 * `insertInbound` (null = duplicate, stop) → unread/activity/window → media (1 retry) →
 * `message` event. Then, once per conversation (first-appearance order), the agent
 * dispatcher with its last stored message when the re-read conversation is `agent`.
 * Then statuses (forward-only; `status` event when a stored message moved forward).
 *
 * Final event status: `failed` if any change/message/status threw (redacted error),
 * else `unrouted` if no change matched an account, else `processed`.
 */
export async function processEvent(ctx: SendoContext, eventId: string): Promise<SendoEvent> {
  const event = await ctx.adapter.events.get(eventId);
  if (event === null) throw new RecordNotFoundError({ entity: "event", id: eventId });
  await ctx.ready();

  let status: EventStatus;
  let failure: string | null = null;
  try {
    const changes = parseWebhook(event.payload);
    const errors: string[] = [];
    let routed = 0;
    for (const change of changes) {
      try {
        const outcome = await processChange(ctx, change, event.payload);
        if (outcome.routed) routed++;
        errors.push(...outcome.errors);
      } catch (error) {
        ctx.logger.error(`[sendo] webhook change for ${change.phoneNumberId} failed`, error);
        errors.push(`change ${change.phoneNumberId}: ${errorMessage(error)}`);
      }
    }
    if (errors.length > 0) {
      status = "failed";
      failure = errors.join("\n");
    } else {
      status = changes.length > 0 && routed === 0 ? "unrouted" : "processed";
    }
  } catch (error) {
    ctx.logger.error(`[sendo] webhook event ${eventId} could not be parsed`, error);
    status = "failed";
    failure = errorMessage(error);
  }

  return ctx.adapter.events.setStatus(
    eventId,
    status,
    failure === null ? null : redactText(failure, ctx.secrets()),
  );
}
