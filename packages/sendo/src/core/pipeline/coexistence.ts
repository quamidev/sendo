import type { ConversationPatch } from "../../adapters/types";
import { messageText, toContent } from "../../channels/whatsapp/parse";
import type {
  HistoryMessage,
  InboundMessage,
  ParsedEcho,
  ParsedHistory,
} from "../../channels/whatsapp/schemas";
import type { Account, Contact, Conversation, JsonObject, Message } from "../../types/entities";
import type { DeliveryStatus } from "../../types/enums";
import type { SendoContext } from "../context";
import {
  downloadMedia,
  errorMessage,
  isMediaMessage,
  routeAccount,
  type ChangeOutcome,
  type ChangeSource,
} from "./steps";

/**
 * Coexistence: the business keeps using the WhatsApp Business app on a Cloud API number.
 *
 * - `smb_message_echoes`: each phone-app message is stored as an outbound `human` message
 *   (`senderRef` and `metadata.origin` `"business_app"`, status `sent`). It updates the
 *   conversation's activity and clears `awaitingReplySince`, never `lastInboundAt` or the
 *   window (echoes don't open or extend it). In an `agent` conversation it pauses the agent
 *   (`coexistence.pauseAgentOnPhoneReply`, default true) and emits `conversation.agent_paused`.
 * - `history`: with `coexistence.importHistory`, messages are stored with
 *   `metadata.imported = true`; no unread, window, `message` event or agent turn. Off → ignored.
 *
 * Both dedupe on the Meta message id, so Meta retries and `events.reprocess` are safe.
 */

/** `senderRef` and `metadata.origin` of messages sent from the WhatsApp Business app. */
export const BUSINESS_APP = "business_app";

/** Serializes concurrent copies of one Meta message id (`insertOutbound` has no unique key). */
const COPY_LOCK_TTL_MS = 30_000;

interface Target {
  account: Account;
  contact: Contact;
  conversation: Conversation;
}

async function ensureTarget(ctx: SendoContext, account: Account, waId: string): Promise<Target> {
  const { contact } = await ctx.services.contacts.ensure({ account, phone: `+${waId}`, waId });
  const { conversation } = await ctx.services.conversations.ensure({ account, contact });
  return { account, contact, conversation };
}

async function isStored(ctx: SendoContext, metaMessageId: string): Promise<boolean> {
  return (await ctx.adapter.messages.getByMetaId(metaMessageId)) !== null;
}

/**
 * Stores a message the business sent from the phone app as `sent`. Returns null without
 * writing when the Meta id is already stored or another worker is storing it.
 */
async function storeBusinessAppMessage(
  ctx: SendoContext,
  target: Target,
  input: {
    message: InboundMessage;
    metadata: JsonObject;
    status: DeliveryStatus | null;
    downloadMedia: boolean;
  },
): Promise<Message | null> {
  const { adapter } = ctx;
  const { message } = input;
  const key = `meta:${message.metaMessageId}`;
  if (!(await adapter.locks.acquire(key, COPY_LOCK_TTL_MS))) return null;
  try {
    if (await isStored(ctx, message.metaMessageId)) return null;
    const pending = await adapter.messages.insertOutbound({
      tenantId: target.account.tenantId,
      conversationId: target.conversation.id,
      type: message.type,
      content: toContent(message),
      text: messageText(message),
      replyToMetaId: message.context?.replyToMetaId ?? null,
      sender: "human",
      senderRef: BUSINESS_APP,
      metadata: input.metadata,
    });
    let stored = await adapter.messages.markSent(pending.id, message.metaMessageId);
    if (input.status !== null && input.status !== "sent") {
      await adapter.messages.updateStatus(message.metaMessageId, input.status);
      stored = (await adapter.messages.get(stored.id)) ?? stored;
    }
    if (input.downloadMedia && isMediaMessage(message)) {
      await downloadMedia(ctx, target.account, target.conversation, stored.id, message);
    }
    return stored;
  } finally {
    await adapter.locks.release(key);
  }
}

/** Activity, `awaitingReplySince` and the pause after an echo. Never touches the window. */
async function afterEcho(ctx: SendoContext, conversationId: string, at: Date): Promise<void> {
  const current = await ctx.services.conversations.require(conversationId);
  const pause =
    ctx.accountsConfig.coexistence.pauseAgentOnPhoneReply &&
    current.status === "agent" &&
    !current.agentPaused;
  const patch: ConversationPatch = {};
  if (at.getTime() > current.lastActivityAt.getTime()) patch.lastActivityAt = at;
  if (current.awaitingReplySince !== null) patch.awaitingReplySince = null;
  if (pause) patch.agentPaused = true;
  if (Object.keys(patch).length === 0) return;
  const conversation = await ctx.adapter.conversations.update(conversationId, patch);
  if (pause) {
    await ctx.emitter.emit("conversation.agent_paused", {
      conversation,
      paused: true,
      by: BUSINESS_APP,
    });
  }
}

export async function processEchoChange(
  ctx: SendoContext,
  change: ParsedEcho,
  source: ChangeSource,
): Promise<ChangeOutcome> {
  const account = await routeAccount(ctx, change.phoneNumberId, source);
  if (account === null) return { routed: false, errors: [] };

  const errors: string[] = [];
  for (const echo of change.echoes) {
    const { message } = echo;
    try {
      // Pre-check so a replay never reopens a closed conversation.
      if (await isStored(ctx, message.metaMessageId)) continue;
      const target = await ensureTarget(ctx, account, echo.to);
      const stored = await storeBusinessAppMessage(ctx, target, {
        message,
        metadata: { origin: BUSINESS_APP },
        status: null,
        downloadMedia: true,
      });
      if (stored === null) continue;
      await afterEcho(ctx, target.conversation.id, message.timestamp);
    } catch (error) {
      ctx.logger.error(`[sendo] message echo ${message.metaMessageId} failed`, error);
      errors.push(`echo ${message.metaMessageId}: ${errorMessage(error)}`);
    }
  }
  return { routed: true, errors };
}

async function importHistoryMessage(
  ctx: SendoContext,
  target: Target,
  item: HistoryMessage,
): Promise<void> {
  const { message } = item;
  if (item.direction === "out") {
    await storeBusinessAppMessage(ctx, target, {
      message,
      metadata: { origin: BUSINESS_APP, imported: true },
      status: item.status,
      downloadMedia: false,
    });
    return;
  }
  await ctx.adapter.messages.insertInbound({
    tenantId: target.account.tenantId,
    conversationId: target.conversation.id,
    metaMessageId: message.metaMessageId,
    type: message.type,
    content: toContent(message),
    text: messageText(message),
    replyToMetaId: message.context?.replyToMetaId ?? null,
    sentAt: message.timestamp,
    metadata: { imported: true },
  });
}

export async function processHistoryChange(
  ctx: SendoContext,
  change: ParsedHistory,
  source: ChangeSource,
): Promise<ChangeOutcome> {
  const account = await routeAccount(ctx, change.phoneNumberId, source);
  if (account === null) return { routed: false, errors: [] };
  if (change.errors.length > 0) {
    const codes = change.errors.map((error) => String(error.code)).join(", ");
    ctx.logger.info(`[sendo] history sync for ${change.phoneNumberId} reported errors: ${codes}`);
  }
  if (!ctx.accountsConfig.coexistence.importHistory) {
    ctx.logger.debug(
      `[sendo] history for ${change.phoneNumberId} ignored (coexistence.importHistory is off)`,
    );
    return { routed: true, errors: [] };
  }

  const errors: string[] = [];
  for (const thread of change.threads) {
    try {
      const fresh: HistoryMessage[] = [];
      for (const item of thread.messages) {
        if (!(await isStored(ctx, item.message.metaMessageId))) fresh.push(item);
      }
      if (fresh.length === 0) continue;
      const target = await ensureTarget(ctx, account, thread.waId);
      for (const item of fresh) {
        try {
          await importHistoryMessage(ctx, target, item);
        } catch (error) {
          const id = item.message.metaMessageId;
          ctx.logger.error(`[sendo] history message ${id} failed`, error);
          errors.push(`history ${id}: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      ctx.logger.error(`[sendo] history thread for ${thread.waId} failed`, error);
      errors.push(`history thread ${thread.waId}: ${errorMessage(error)}`);
    }
  }
  return { routed: true, errors };
}
