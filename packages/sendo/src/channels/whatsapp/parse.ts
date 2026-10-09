import type { z } from "zod";
import type { JsonObject } from "../../types/entities";
import { DELIVERY_STATUSES, type DeliveryStatus } from "../../types/enums";
import type { ChannelParser, ParsedChange } from "../types";
import {
  WHATSAPP_WEBHOOK_OBJECT,
  metaChangeValueSchema,
  metaEchoSchema,
  metaEchoValueSchema,
  metaHistoryContextSchema,
  metaHistoryValueSchema,
  metaMessageBaseSchema,
  metaMessageContentSchemas,
  metaStatusSchema,
  metaWebhookPayloadSchema,
  type ContactCard,
  type EchoMessage,
  type HistoryMessage,
  type InboundMessage,
  type InboundMessageContext,
  type InboundReferral,
  type ParsedEcho,
  type ParsedHistory,
  type ParsedMessagesChange,
  type StatusUpdate,
  type SupportedInboundType,
  type WebhookError,
  type metaWebhookErrorSchema,
} from "./schemas";

const MESSAGES_FIELD = "messages";
const ECHOES_FIELD = "smb_message_echoes";
const HISTORY_FIELD = "history";

/** Meta's `history_context.status` values that map to a tracked delivery status. */
const HISTORY_STATUSES: Readonly<Record<string, DeliveryStatus>> = {
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  PLAYED: "read",
};

type MetaMessageBase = z.output<typeof metaMessageBaseSchema>;
type MetaWebhookError = z.output<typeof metaWebhookErrorSchema>;

function isSupportedType(type: string): type is SupportedInboundType {
  return Object.hasOwn(metaMessageContentSchemas, type);
}

function isDeliveryStatus(status: string): status is DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(status);
}

function toWebhookErrors(errors: MetaWebhookError[] | undefined): WebhookError[] | undefined {
  if (!errors || errors.length === 0) return undefined;
  return errors.map((error) => ({
    code: error.code,
    title: error.title ?? "",
    ...(error.message !== undefined && { message: error.message }),
    ...(error.error_data?.details !== undefined && { details: error.error_data.details }),
  }));
}

function toContext(context: MetaMessageBase["context"]): InboundMessageContext | undefined {
  if (!context) return undefined;
  const result: InboundMessageContext = {
    ...(context.id !== undefined && { replyToMetaId: context.id }),
    ...(context.from !== undefined && { replyToFrom: context.from }),
    ...(context.forwarded !== undefined && { forwarded: context.forwarded }),
    ...(context.frequently_forwarded !== undefined && {
      frequentlyForwarded: context.frequently_forwarded,
    }),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function toContactCard(
  card: z.output<typeof metaMessageContentSchemas.contacts>["contacts"][number],
): ContactCard {
  return {
    formattedName: card.name?.formatted_name,
    firstName: card.name?.first_name,
    lastName: card.name?.last_name,
    phones: (card.phones ?? []).map((phone) => ({
      phone: phone.phone,
      waId: phone.wa_id,
      type: phone.type,
    })),
    emails: (card.emails ?? []).map((email) => ({ email: email.email, type: email.type })),
    organization: card.org?.company,
  };
}

type Common = Pick<InboundMessage, "metaMessageId" | "from" | "timestamp" | "context" | "referral">;

function toReferral(referral: MetaMessageBase["referral"]): InboundReferral | undefined {
  const sourceId = referral?.source_id;
  if (referral === undefined || sourceId === undefined || sourceId.trim() === "") return undefined;
  return stripUndefined({
    sourceId,
    sourceType: referral.source_type,
    sourceUrl: referral.source_url,
    headline: referral.headline,
    ctwaClid: referral.ctwa_clid,
  });
}

function parseContent(
  type: SupportedInboundType,
  raw: Record<string, unknown>,
  common: Common,
): InboundMessage | null {
  switch (type) {
    case "text": {
      const parsed = metaMessageContentSchemas.text.safeParse(raw);
      return parsed.success ? { ...common, type, body: parsed.data.text.body } : null;
    }
    case "image": {
      const parsed = metaMessageContentSchemas.image.safeParse(raw);
      if (!parsed.success) return null;
      const media = parsed.data.image;
      return {
        ...common,
        type,
        mediaId: media.id,
        mimeType: media.mime_type,
        sha256: media.sha256,
        caption: media.caption,
      };
    }
    case "video": {
      const parsed = metaMessageContentSchemas.video.safeParse(raw);
      if (!parsed.success) return null;
      const media = parsed.data.video;
      return {
        ...common,
        type,
        mediaId: media.id,
        mimeType: media.mime_type,
        sha256: media.sha256,
        caption: media.caption,
      };
    }
    case "audio": {
      const parsed = metaMessageContentSchemas.audio.safeParse(raw);
      if (!parsed.success) return null;
      const media = parsed.data.audio;
      return {
        ...common,
        type,
        mediaId: media.id,
        mimeType: media.mime_type,
        sha256: media.sha256,
        voice: media.voice,
      };
    }
    case "document": {
      const parsed = metaMessageContentSchemas.document.safeParse(raw);
      if (!parsed.success) return null;
      const media = parsed.data.document;
      return {
        ...common,
        type,
        mediaId: media.id,
        mimeType: media.mime_type,
        sha256: media.sha256,
        caption: media.caption,
        filename: media.filename,
      };
    }
    case "sticker": {
      const parsed = metaMessageContentSchemas.sticker.safeParse(raw);
      if (!parsed.success) return null;
      const media = parsed.data.sticker;
      return {
        ...common,
        type,
        mediaId: media.id,
        mimeType: media.mime_type,
        sha256: media.sha256,
        animated: media.animated,
      };
    }
    case "location": {
      const parsed = metaMessageContentSchemas.location.safeParse(raw);
      if (!parsed.success) return null;
      const { latitude, longitude, name, address } = parsed.data.location;
      return { ...common, type, latitude, longitude, name, address };
    }
    case "contacts": {
      const parsed = metaMessageContentSchemas.contacts.safeParse(raw);
      return parsed.success
        ? { ...common, type, contacts: parsed.data.contacts.map(toContactCard) }
        : null;
    }
    case "reaction": {
      const parsed = metaMessageContentSchemas.reaction.safeParse(raw);
      if (!parsed.success) return null;
      const { emoji, message_id } = parsed.data.reaction;
      return { ...common, type, emoji: emoji ? emoji : null, targetMetaId: message_id };
    }
    case "interactive": {
      const parsed = metaMessageContentSchemas.interactive.safeParse(raw);
      if (!parsed.success) return null;
      const interactive = parsed.data.interactive;
      const reply =
        interactive.type === "button_reply"
          ? {
              type: interactive.type,
              id: interactive.button_reply.id,
              title: interactive.button_reply.title,
            }
          : {
              type: interactive.type,
              id: interactive.list_reply.id,
              title: interactive.list_reply.title,
              description: interactive.list_reply.description,
            };
      return { ...common, type, reply };
    }
    case "button": {
      const parsed = metaMessageContentSchemas.button.safeParse(raw);
      return parsed.success
        ? { ...common, type, text: parsed.data.button.text, payload: parsed.data.button.payload }
        : null;
    }
  }
}

/** Normalizes one raw Meta message. Unknown or malformed per-type content becomes `unsupported`. */
export function parseInboundMessage(raw: Record<string, unknown>): InboundMessage {
  const base = metaMessageBaseSchema.parse(raw);
  const common: Common = {
    metaMessageId: base.id,
    from: base.from,
    timestamp: base.timestamp,
    context: toContext(base.context),
    referral: toReferral(base.referral),
  };
  const parsed = isSupportedType(base.type) ? parseContent(base.type, raw, common) : null;
  if (parsed) return stripUndefined(parsed);
  return stripUndefined({
    ...common,
    type: "unsupported",
    originalType: base.type,
    raw,
    errors: toWebhookErrors(base.errors),
  });
}

/** Normalizes one raw Meta status. Returns null for statuses outside `DELIVERY_STATUSES`. */
export function parseStatusUpdate(raw: Record<string, unknown>): StatusUpdate | null {
  const status = metaStatusSchema.parse(raw);
  if (!isDeliveryStatus(status.status)) return null;
  return stripUndefined({
    metaMessageId: status.id,
    status: status.status,
    timestamp: status.timestamp,
    recipientId: status.recipient_id,
    conversation: status.conversation && {
      id: status.conversation.id,
      expiresAt: status.conversation.expiration_timestamp,
      originType: status.conversation.origin?.type,
    },
    pricing: status.pricing && {
      billable: status.pricing.billable,
      pricingModel: status.pricing.pricing_model,
      category: status.pricing.category,
      type: status.pricing.type,
    },
    errors: toWebhookErrors(status.errors),
    bizOpaqueCallbackData: status.biz_opaque_callback_data,
  });
}

function parseMessagesChange(wabaId: string, raw: unknown): ParsedMessagesChange {
  const value = metaChangeValueSchema.parse(raw);
  return {
    kind: "messages",
    wabaId,
    phoneNumberId: value.metadata.phone_number_id,
    displayPhone: value.metadata.display_phone_number,
    contacts: (value.contacts ?? []).map((contact) => ({
      waId: contact.wa_id,
      profileName: contact.profile?.name ?? null,
    })),
    messages: (value.messages ?? []).map(parseInboundMessage),
    statuses: (value.statuses ?? [])
      .map(parseStatusUpdate)
      .filter((status): status is StatusUpdate => status !== null),
    errors: value.errors ?? [],
  };
}

/** Normalizes one `message_echoes` item. Throws when `to` or the message envelope is missing. */
export function parseEchoMessage(raw: Record<string, unknown>): EchoMessage {
  const { to } = metaEchoSchema.parse(raw);
  return { to, message: parseInboundMessage(raw) };
}

function parseEchoChange(wabaId: string, raw: unknown): ParsedEcho {
  const value = metaEchoValueSchema.parse(raw);
  return {
    kind: "echo",
    wabaId,
    phoneNumberId: value.metadata.phone_number_id,
    displayPhone: value.metadata.display_phone_number,
    echoes: (value.message_echoes ?? []).map(parseEchoMessage),
  };
}

function parseHistoryMessage(contactWaId: string, raw: Record<string, unknown>): HistoryMessage {
  const message = parseInboundMessage(raw);
  const context = metaHistoryContextSchema.parse(raw).history_context;
  const direction = message.from === contactWaId ? "in" : "out";
  const status =
    direction === "out" ? (HISTORY_STATUSES[context?.status?.toUpperCase() ?? ""] ?? null) : null;
  return { direction, status, message };
}

function parseHistoryChange(wabaId: string, raw: unknown): ParsedHistory {
  const value = metaHistoryValueSchema.parse(raw);
  const chunks = value.history ?? [];
  return {
    kind: "history",
    wabaId,
    phoneNumberId: value.metadata.phone_number_id,
    displayPhone: value.metadata.display_phone_number,
    threads: chunks.flatMap((chunk) =>
      (chunk.threads ?? []).map((thread) => ({
        waId: thread.id,
        messages: (thread.messages ?? []).map((message) => parseHistoryMessage(thread.id, message)),
      })),
    ),
    errors: chunks.flatMap((chunk) => toWebhookErrors(chunk.errors) ?? []),
  };
}

/**
 * Validates a WhatsApp webhook body and flattens every change Sendo handles: `messages`,
 * coexistence `smb_message_echoes` (`kind: "echo"`) and `history`. Other fields (e.g.
 * `smb_app_state_sync`, `account_update`) are skipped. Throws a ZodError when malformed.
 */
export function parseChanges(json: unknown): ParsedChange[] {
  const payload = metaWebhookPayloadSchema.parse(json);
  const result: ParsedChange[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      switch (change.field) {
        case MESSAGES_FIELD:
          result.push(parseMessagesChange(entry.id, change.value));
          break;
        case ECHOES_FIELD:
          result.push(parseEchoChange(entry.id, change.value));
          break;
        case HISTORY_FIELD:
          result.push(parseHistoryChange(entry.id, change.value));
          break;
        default:
          break;
      }
    }
  }
  return result;
}

/**
 * Validates a WhatsApp webhook body and flattens every `messages` change.
 * Throws a ZodError when the envelope is malformed. Other fields are skipped
 * (use `parseChanges` for echoes and history).
 */
export function parseWebhook(json: unknown): ParsedMessagesChange[] {
  const payload = metaWebhookPayloadSchema.parse(json);
  return payload.entry.flatMap((entry) =>
    entry.changes
      .filter((change) => change.field === MESSAGES_FIELD)
      .map((change) => parseMessagesChange(entry.id, change.value)),
  );
}

export const whatsappParser: ChannelParser = {
  channel: "whatsapp",
  object: WHATSAPP_WEBHOOK_OBJECT,
  parse: parseChanges,
};

/** Denormalized text for previews and search: body, caption, reply title, etc. */
export function messageText(message: InboundMessage): string | null {
  switch (message.type) {
    case "text":
      return message.body;
    case "image":
    case "video":
    case "document":
      return message.caption ?? null;
    case "audio":
    case "sticker":
    case "unsupported":
      return null;
    case "location":
      return message.name ?? message.address ?? null;
    case "contacts": {
      const names = message.contacts
        .map((card) => card.formattedName)
        .filter((name): name is string => Boolean(name));
      return names.length > 0 ? names.join(", ") : null;
    }
    case "reaction":
      return message.emoji;
    case "interactive":
      return message.reply.title;
    case "button":
      return message.text;
  }
}

/** JSON-safe content for `sendo_messages.content`: everything except the common envelope fields. */
export function toContent(message: InboundMessage): JsonObject {
  const {
    metaMessageId: _id,
    from: _from,
    timestamp: _timestamp,
    type: _type,
    ...content
  } = message;
  return JSON.parse(JSON.stringify(content)) as JsonObject;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
