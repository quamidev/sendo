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
import { redactText } from "../../utils/redact";
import { stripSourceCode } from "../../rules/source";
import { parserForObject } from "../../channels";
import type { ChannelParser, ParsedChange } from "../../channels/types";
import { messageText, toContent } from "../../channels/whatsapp/parse";
import type {
  InboundMessage,
  ParsedMessagesChange,
  StatusUpdate,
} from "../../channels/whatsapp/schemas";
import type { SendoContext } from "../context";
import { createReply } from "../reply";
import { syncBroadcastRecipient } from "./broadcast-status";
import { processEchoChange, processHistoryChange } from "./coexistence";
import { applyOptOut } from "./opt-out";
import {
  downloadMedia,
  errorMessage,
  isMediaMessage,
  routeAccount,
  type ChangeOutcome,
  type ChangeSource,
} from "./steps";
import { transcribeVoiceNote } from "./transcribe";

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

/**
 * Attribution of a conversation's first message: a trailing `[#code]` in a text message, else
 * a Click-to-WhatsApp `referral` (`ad:<source_id>`), else none.
 */
function attributionOf(message: InboundMessage): string | null {
  if (message.type === "text") {
    const { source } = stripSourceCode(message.body);
    if (source !== null) return source;
  }
  return message.referral === undefined ? null : `ad:${message.referral.sourceId}`;
}

/**
 * Rules hooks for one stored inbound message: `onNewConversation` (routing) for the first
 * message, then `onInbound` (after-hours). A failing hook is logged and never fails the event.
 * Returns the conversation as the hooks left it.
 */
async function applyRules(
  ctx: SendoContext,
  input: {
    account: Account;
    contact: Contact;
    conversation: Conversation;
    message: MessageWithMedia;
    first: boolean;
  },
): Promise<Conversation> {
  const { account, contact, message } = input;
  let conversation = input.conversation;
  if (input.first) {
    try {
      conversation = await ctx.rulesHooks.onNewConversation({
        account,
        contact,
        conversation,
        message,
      });
    } catch (error) {
      ctx.logger.error(`[sendo] routing rules failed for conversation ${conversation.id}`, error);
    }
  }
  try {
    await ctx.rulesHooks.onInbound({ account, conversation, message });
  } catch (error) {
    ctx.logger.error(`[sendo] after-hours rules failed for conversation ${conversation.id}`, error);
  }
  return (await ctx.adapter.conversations.get(conversation.id)) ?? conversation;
}

interface StoredInbound {
  contact: Contact;
  conversationId: string;
  message: MessageWithMedia;
  /** An opt-out keyword: no rules, no agent turn. */
  optedOut: boolean;
}

/**
 * Steps 3–8 for one inbound message (agent dispatch happens per conversation once the
 * whole change is stored). Returns null without side effects when the Meta id is already
 * stored (replays, Meta retries, reprocess).
 */
async function processMessage(
  ctx: SendoContext,
  account: Account,
  change: ParsedMessagesChange,
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
  const opened = await services.conversations.ensure({ account, contact });
  // The message that creates or reopens a conversation is its first: only it is attributed
  // and routed.
  const first = opened.created || opened.reopened;
  const source = first ? attributionOf(message) : null;

  const inserted = await adapter.messages.insertInbound({
    tenantId: account.tenantId,
    conversationId: opened.conversation.id,
    metaMessageId: message.metaMessageId,
    type: message.type,
    content: toContent(message),
    text: messageText(message),
    replyToMetaId: message.context?.replyToMetaId ?? null,
    sentAt: message.timestamp,
    ...(source === null ? {} : { metadata: { source } }),
  });
  if (inserted === null) return null;

  // Only a stored message bumps unread, activity and the 24 h window.
  let { conversation } = await services.conversations.ensure({
    account,
    contact,
    inbound: { at: message.timestamp },
  });
  if (source !== null && conversation.source !== source) {
    conversation = await adapter.conversations.update(conversation.id, { source });
  }

  if (isMediaMessage(message)) {
    await downloadMedia(ctx, account, conversation, inserted.id, message);
  }
  let stored = (await adapter.messages.get(inserted.id)) ?? { ...inserted, media: null };
  stored = await transcribeVoiceNote(ctx, stored);

  let current = contact;
  const optOut = await applyOptOut(ctx, { account, contact, conversation, message: stored });
  if (optOut === null) {
    conversation = await applyRules(ctx, {
      account,
      contact,
      conversation,
      message: stored,
      first,
    });
  } else {
    ({ contact: current, message: stored } = optOut);
    conversation = (await adapter.conversations.get(conversation.id)) ?? conversation;
  }

  await ctx.emitter.emit("message", {
    message: stored,
    contact: current,
    conversation,
    account,
    reply: createReply(ctx, {
      account,
      contact: current,
      conversation,
      sender: "system",
      senderRef: null,
      message: stored,
    }),
  });

  return {
    contact: current,
    conversationId: conversation.id,
    message: stored,
    optedOut: optOut !== null,
  };
}

async function processStatus(ctx: SendoContext, status: StatusUpdate): Promise<void> {
  const error = toMessageError(status);
  const result = await ctx.adapter.messages.updateStatus(status.metaMessageId, status.status, {
    ...(error === undefined ? {} : { error }),
    at: status.timestamp,
  });
  // `placeholder`: no row yet; markSent merges it later (the broadcast tick reads it then).
  if (result === "placeholder") return;
  const message = await ctx.adapter.messages.getByMetaId(status.metaMessageId);
  if (message === null) return;
  await syncBroadcastRecipient(ctx, message);
  // `ignored`: not a forward move.
  if (result !== "updated") return;
  await ctx.emitter.emit("status", {
    message,
    status: status.status,
    ...(error === undefined ? {} : { error }),
  });
}

async function processMessagesChange(
  ctx: SendoContext,
  change: ParsedMessagesChange,
  source: ChangeSource,
): Promise<ChangeOutcome> {
  const account = await routeAccount(ctx, change.phoneNumberId, source);
  if (account === null) return { routed: false, errors: [] };

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
    if (stored.optedOut) continue;
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

function processChange(
  ctx: SendoContext,
  change: ParsedChange,
  source: ChangeSource,
): Promise<ChangeOutcome> {
  switch (change.kind) {
    case "messages":
      return processMessagesChange(ctx, change, source);
    case "echo":
      return processEchoChange(ctx, change, source);
    case "history":
      return processHistoryChange(ctx, change, source);
  }
}

/** The body's `object` field, or null when the body is not an object or the field is not a string. */
function payloadObject(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const object = (payload as { object?: unknown }).object;
  return typeof object === "string" ? object : null;
}

interface Outcome {
  status: EventStatus;
  failure: string | null;
}

async function processChanges(
  ctx: SendoContext,
  parser: ChannelParser,
  payload: unknown,
): Promise<Outcome> {
  const changes = parser.parse(payload);
  const errors: string[] = [];
  let routed = 0;
  for (const change of changes) {
    try {
      const outcome = await processChange(ctx, change, { object: parser.object, raw: payload });
      if (outcome.routed) routed++;
      errors.push(...outcome.errors);
    } catch (error) {
      ctx.logger.error(`[sendo] webhook change for ${change.phoneNumberId} failed`, error);
      errors.push(`change ${change.phoneNumberId}: ${errorMessage(error)}`);
    }
  }
  if (errors.length > 0) return { status: "failed", failure: errors.join("\n") };
  return { status: changes.length > 0 && routed === 0 ? "unrouted" : "processed", failure: null };
}

/**
 * The background part of the webhook pipeline for one stored `sendo_events` row.
 * Safe to run again (dedupe by Meta message id, forward-only statuses).
 *
 * Dispatch on the body's `object` to its channel parser. With no parser (`instagram`, `page`,
 * missing) the event is `unrouted`, `event.unrouted` fires and nothing else is written.
 *
 * Per change: route by `phone_number_id` (unknown → `event.unrouted`) → for each message:
 * dedupe pre-check → contact upsert (+ `linkContact`) → open/reopen conversation →
 * `insertInbound` (null = duplicate, stop; the first message of a new or reopened conversation
 * carries `metadata.source`) → unread/activity/window (+ `conversation.source`) → media
 * (1 retry) → voice-note transcription (`transcribe.ts`, with `config.transcribe`) → opt-out
 * keyword (`opt-out.ts`: contact opted out, `contact.opt_in`, confirmation;
 * skips the rules and the agent turn) → rules (`onNewConversation` for the first message, then
 * `onInbound`) → `message` event. Then, once per conversation (first-appearance order), the
 * agent dispatcher with its last stored message when the re-read conversation is `agent` and
 * that message is not an opt-out. Then statuses (forward-only; broadcast recipients follow
 * their message, `broadcast-status.ts`; `status` event when a stored message moved forward).
 * Coexistence `echo` and `history` changes are handled in `coexistence.ts`.
 *
 * Final event status: `failed` if parsing or any change/message/status threw (redacted error),
 * else `unrouted` if no channel or no change matched an account, else `processed`.
 */
export async function processEvent(ctx: SendoContext, eventId: string): Promise<SendoEvent> {
  const event = await ctx.adapter.events.get(eventId);
  if (event === null) throw new RecordNotFoundError({ entity: "event", id: eventId });
  await ctx.ready();

  let outcome: Outcome;
  try {
    const object = payloadObject(event.payload);
    const parser = parserForObject(object);
    if (parser === null) {
      ctx.logger.warn(
        `[sendo] webhook object ${object ?? "(missing)"} has no channel; event left unrouted`,
      );
      await ctx.emitter.emit("event.unrouted", {
        reason: "unknown_object",
        object,
        phoneNumberId: null,
        raw: event.payload,
      });
      outcome = { status: "unrouted", failure: null };
    } else {
      outcome = await processChanges(ctx, parser, event.payload);
    }
  } catch (error) {
    ctx.logger.error(`[sendo] webhook event ${eventId} could not be parsed`, error);
    outcome = { status: "failed", failure: errorMessage(error) };
  }

  return ctx.adapter.events.setStatus(
    eventId,
    outcome.status,
    outcome.failure === null ? null : redactText(outcome.failure, ctx.secrets()),
  );
}
