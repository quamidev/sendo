import type { z } from "zod";
import type { JsonObject } from "../types/entities";
import { DELIVERY_STATUSES, type DeliveryStatus } from "../types/enums";
import {
  metaChangeValueSchema,
  metaMessageBaseSchema,
  metaMessageContentSchemas,
  metaStatusSchema,
  metaWebhookPayloadSchema,
  type ContactCard,
  type InboundMessage,
  type InboundMessageContext,
  type ParsedChange,
  type StatusUpdate,
  type SupportedInboundType,
  type WebhookError,
  type metaWebhookErrorSchema,
} from "./schemas";

const MESSAGES_FIELD = "messages";

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

type Common = Pick<InboundMessage, "metaMessageId" | "from" | "timestamp" | "context">;

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

/**
 * Validates a Meta webhook body and flattens every `messages` change into a ParsedChange.
 * Throws a ZodError when the envelope is malformed. Non-`messages` fields are skipped.
 */
export function parseWebhook(json: unknown): ParsedChange[] {
  const payload = metaWebhookPayloadSchema.parse(json);
  const result: ParsedChange[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== MESSAGES_FIELD) continue;
      const value = metaChangeValueSchema.parse(change.value);
      result.push({
        wabaId: entry.id,
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
      });
    }
  }
  return result;
}

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

/** JSON-safe content for `wa_messages.content`: everything except the common envelope fields. */
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
