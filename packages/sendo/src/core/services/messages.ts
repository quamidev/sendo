import type { MessagePayload } from "../../channels/whatsapp/send";
import { NotImplementedError, RecordNotFoundError, WindowClosedError } from "../../errors/errors";
import { META_BILLING_ERROR_CODE, MetaApiError } from "../../errors/meta-api-error";
import type {
  Account,
  Contact,
  Conversation,
  JsonObject,
  Message,
  MessageError,
  MessageWithMedia,
} from "../../types/entities";
import type { MessageType, OutboundSender } from "../../types/enums";
import { redactText } from "../../utils/redact";
import { windowStatus } from "../../utils/window";
import { isUuid } from "../accounts";
import { markBillingNotReady } from "../accounts/billing";
import type { SendoContext } from "../context";
import { systemLineText, type SystemEventName, type SystemLineParams } from "../messages";
import {
  composeOutbound,
  type OutboundInput,
  type PendingUpload,
  type SendTarget,
} from "../outbound";

export interface SendOutboundInput {
  account: Account;
  contact: Contact;
  conversation: Conversation;
  /** Validated Meta payload (from the `build*Payload` builders). */
  payload: MessagePayload;
  type: Exclude<MessageType, "status_placeholder">;
  content: JsonObject;
  text: string | null;
  sender: OutboundSender;
  senderRef?: string | null;
  /** Meta id of the quoted message. */
  replyTo?: string;
  metadata?: JsonObject;
  /** Templates are always exempt from the 24-hour window. */
  skipWindowCheck?: boolean;
  /** Uploads the file after the pending row is stored, then sends `upload.build(mediaId)`. */
  upload?: PendingUpload;
  /** Model usage of the agent turn that produced the message (AC-CO-1). */
  usage?: MessageUsage;
}

export interface MessageUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  costCents: number | null;
}

/** `metadata.kind` of a system line: `system` (inbox and service actions) or `rule` (rules engine). */
export type SystemLineKind = "system" | "rule";

export interface SystemLineInput {
  /** Who did it (`metadata.by`): a user id, `"system"`, `"agent:<name>"` or `"rule:<key>"`. */
  by: string;
  /** Default `system`. */
  kind?: SystemLineKind;
  /** What happened (`metadata.event`). */
  event: SystemEventName;
  /** `by` as a display name for the English `text`. Default `by`. */
  subject?: string;
  /** Stored as top-level `metadata` keys and surfaced as `InboxSystemLine.params`. */
  params?: SystemLineParams;
}

export interface MessagesService {
  /**
   * Steps 4–7 of the send flow: window check (`WindowClosedError` before any write),
   * `insertOutbound` (pending), optional upload, `transport.send`, then `markSent`
   * or `markFailed` + rethrow. A sent reply from `human` or `agent` clears
   * `awaitingReplySince`. Meta error 131042 also sets the account's `billingReady = false`
   * (emitting `account.billing`) before the `MetaApiError` (hint `billing_not_ready`) is rethrown.
   */
  sendOutbound(input: SendOutboundInput): Promise<Message>;
  /**
   * Sends a stored `pending` row (an approved draft) like `sendOutbound` from step 5 on: window
   * check, optional upload, `transport.send`, then `markSent` or `markFailed` + rethrow.
   */
  sendStored(message: Message, input: SendOutboundInput): Promise<Message>;
  /** Validates `input` (`composeOutbound`) and runs `sendOutbound`. */
  send(target: SendTarget, input: OutboundInput): Promise<Message>;
  /**
   * Stores a system line: `sender "system"`, `internal`, status `sent`, never sent through the
   * transport, never clears `awaitingReplySince`, excluded from the agent's history.
   */
  insertSystemLine(
    conversation: Pick<Conversation, "id" | "tenantId">,
    input: SystemLineInput,
  ): Promise<Message>;
  /** Looks a message up by sendo id or Meta id. */
  find(ref: string): Promise<MessageWithMedia | null>;
  /** Marks an inbound message read on WhatsApp (blue ticks). */
  markRead(ref: string): Promise<void>;
}

function toMessageError(error: unknown, secrets: readonly string[]): MessageError {
  if (error instanceof MetaApiError) {
    const out: MessageError = { message: error.message };
    if (error.metaCode !== null) out.code = error.metaCode;
    if (error.subcode !== null) out.subcode = error.subcode;
    if (error.type !== null) out.title = error.type;
    if (error.details !== null) out.details = error.details;
    if (error.fbtraceId !== null) out.fbtraceId = error.fbtraceId;
    return out;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { message: redactText(message, secrets) };
}

export function createMessagesService(ctx: SendoContext): MessagesService {
  const { adapter, transport } = ctx;

  async function find(ref: string): Promise<MessageWithMedia | null> {
    if (isUuid(ref)) {
      return (await adapter.messages.get(ref)) ?? (await adapter.messages.getByMetaId(ref));
    }
    return adapter.messages.getByMetaId(ref);
  }

  function assertWindowOpen(input: SendOutboundInput): void {
    if (input.skipWindowCheck || input.type === "template") return;
    const window = windowStatus(input.conversation.lastInboundAt);
    if (!window.open) {
      throw new WindowClosedError({
        conversationId: input.conversation.id,
        expiresAt: window.expiresAt,
      });
    }
  }

  async function deliver(pending: Message, input: SendOutboundInput): Promise<Message> {
    const { account, conversation } = input;
    let metaMessageId: string;
    try {
      let payload = input.payload;
      const upload = input.upload;
      if (upload !== undefined) {
        const uploadMedia = transport.uploadMedia?.bind(transport);
        if (uploadMedia === undefined) {
          throw new NotImplementedError(`media uploads on the "${transport.kind}" transport`);
        }
        const { mediaId } = await ctx.callTransport(account, () =>
          uploadMedia(account, {
            file: upload.file,
            mimeType: upload.mimeType,
            mediaType: upload.mediaType,
            filename: upload.filename,
          }),
        );
        payload = upload.build(mediaId);
        await adapter.messages.updateMetadata(pending.id, { metaMediaId: mediaId });
      }
      ({ metaMessageId } = await ctx.callTransport(account, () =>
        transport.send(account, payload),
      ));
    } catch (error) {
      try {
        await adapter.messages.markFailed(pending.id, toMessageError(error, ctx.secrets()));
      } catch (markError) {
        ctx.logger.error("[sendo] could not mark the message as failed", markError);
      }
      // Sends are always attempted (Meta is the source of truth); 131042 records the outcome.
      if (error instanceof MetaApiError && error.metaCode === META_BILLING_ERROR_CODE) {
        await markBillingNotReady(ctx, account);
      }
      throw error;
    }

    const sent = await adapter.messages.markSent(pending.id, metaMessageId);
    try {
      // A reply from a person or the agent answers the contact; system messages do not.
      const answered = input.sender === "human" || input.sender === "agent";
      await adapter.conversations.update(conversation.id, {
        lastActivityAt: sent.createdAt,
        ...(answered && { awaitingReplySince: null }),
      });
    } catch (error) {
      ctx.logger.warn("[sendo] could not update conversation activity", error);
    }
    return sent;
  }

  async function sendOutbound(input: SendOutboundInput): Promise<Message> {
    assertWindowOpen(input);
    const { conversation, usage } = input;
    const pending = await adapter.messages.insertOutbound({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      type: input.type,
      content: input.content,
      text: input.text,
      replyToMetaId: input.replyTo ?? null,
      sender: input.sender,
      senderRef: input.senderRef ?? null,
      metadata: input.metadata,
      ...(usage && {
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        costCents: usage.costCents,
      }),
    });
    return deliver(pending, input);
  }

  return {
    sendOutbound,
    async sendStored(message, input) {
      assertWindowOpen(input);
      return deliver(message, input);
    },
    insertSystemLine(conversation, input) {
      const kind = input.kind ?? "system";
      const params = input.params ?? {};
      const text = systemLineText({
        kind,
        event: input.event,
        by: input.by,
        subject: input.subject ?? input.by,
        params,
      });
      return adapter.messages.insertOutbound({
        tenantId: conversation.tenantId,
        conversationId: conversation.id,
        type: "text",
        content: { body: text },
        text,
        sender: "system",
        senderRef: null,
        internal: true,
        status: "sent",
        metadata: { ...params, kind, by: input.by, event: input.event },
      });
    },
    async send(target, input) {
      const composed = await composeOutbound(ctx, target, input);
      return sendOutbound({
        account: target.account,
        contact: target.contact,
        conversation: target.conversation,
        sender: target.sender,
        senderRef: target.senderRef ?? null,
        ...composed,
      });
    },
    find,
    async markRead(ref) {
      const message = await find(ref);
      if (message?.metaMessageId == null)
        throw new RecordNotFoundError({ entity: "message", id: ref });
      const metaMessageId = message.metaMessageId;
      const conversation = await adapter.conversations.get(message.conversationId);
      if (!conversation) {
        throw new RecordNotFoundError({ entity: "conversation", id: message.conversationId });
      }
      const account = await adapter.accounts.getById(conversation.accountId);
      if (!account)
        throw new RecordNotFoundError({ entity: "account", id: conversation.accountId });
      const markRead = transport.markRead?.bind(transport);
      if (markRead === undefined) {
        throw new NotImplementedError(`markRead on the "${transport.kind}" transport`);
      }
      await ctx.callTransport(account, () => markRead(account, metaMessageId));
    },
  };
}
