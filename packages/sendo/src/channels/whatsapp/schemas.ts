import { z } from "zod";
import { DELIVERY_STATUSES } from "../../types/enums";

/* ------------------------------------------------------------------ */
/* Raw Meta Cloud API webhook payload (snake_case, as received).       */
/* Objects are loose so new Meta fields never break parsing.           */
/* ------------------------------------------------------------------ */

export const unixTimestampSchema = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((value) => new Date(Number(value) * 1000));

export const metaWebhookErrorSchema = z.looseObject({
  code: z.number(),
  title: z.string().optional(),
  message: z.string().optional(),
  error_data: z.looseObject({ details: z.string().optional() }).optional(),
  href: z.string().optional(),
});

export const metaMessageContextSchema = z.looseObject({
  from: z.string().optional(),
  id: z.string().optional(),
  forwarded: z.boolean().optional(),
  frequently_forwarded: z.boolean().optional(),
});

/** Click-to-WhatsApp ad (or post) the contact came from (`referral` on the first message). */
export const metaReferralSchema = z.looseObject({
  source_id: z.string().optional(),
  source_type: z.string().optional(),
  source_url: z.string().optional(),
  headline: z.string().optional(),
  ctwa_clid: z.string().optional(),
});

/** Fields every inbound message carries; per-type content is validated separately. */
export const metaMessageBaseSchema = z.looseObject({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: unixTimestampSchema,
  type: z.string().min(1),
  context: metaMessageContextSchema.optional(),
  referral: metaReferralSchema.optional(),
  errors: z.array(metaWebhookErrorSchema).optional(),
});

const metaMediaSchema = z.looseObject({
  id: z.string().min(1),
  mime_type: z.string().min(1),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  voice: z.boolean().optional(),
  animated: z.boolean().optional(),
});

export const metaMessageContentSchemas = {
  text: z.looseObject({ text: z.looseObject({ body: z.string() }) }),
  image: z.looseObject({ image: metaMediaSchema }),
  audio: z.looseObject({ audio: metaMediaSchema }),
  video: z.looseObject({ video: metaMediaSchema }),
  document: z.looseObject({ document: metaMediaSchema }),
  sticker: z.looseObject({ sticker: metaMediaSchema }),
  location: z.looseObject({
    location: z.looseObject({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
      url: z.string().optional(),
    }),
  }),
  contacts: z.looseObject({
    contacts: z.array(
      z.looseObject({
        name: z
          .looseObject({
            formatted_name: z.string().optional(),
            first_name: z.string().optional(),
            last_name: z.string().optional(),
          })
          .optional(),
        phones: z
          .array(
            z.looseObject({
              phone: z.string().optional(),
              wa_id: z.string().optional(),
              type: z.string().optional(),
            }),
          )
          .optional(),
        emails: z
          .array(z.looseObject({ email: z.string().optional(), type: z.string().optional() }))
          .optional(),
        org: z
          .looseObject({ company: z.string().optional(), title: z.string().optional() })
          .optional(),
      }),
    ),
  }),
  reaction: z.looseObject({
    reaction: z.looseObject({ message_id: z.string().min(1), emoji: z.string().optional() }),
  }),
  interactive: z.looseObject({
    interactive: z.discriminatedUnion("type", [
      z.looseObject({
        type: z.literal("button_reply"),
        button_reply: z.looseObject({ id: z.string(), title: z.string() }),
      }),
      z.looseObject({
        type: z.literal("list_reply"),
        list_reply: z.looseObject({
          id: z.string(),
          title: z.string(),
          description: z.string().optional(),
        }),
      }),
    ]),
  }),
  button: z.looseObject({
    button: z.looseObject({ text: z.string(), payload: z.string().optional() }),
  }),
} as const;

export type SupportedInboundType = keyof typeof metaMessageContentSchemas;

export const metaStatusSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: unixTimestampSchema,
  recipient_id: z.string().min(1),
  conversation: z
    .looseObject({
      id: z.string(),
      expiration_timestamp: unixTimestampSchema.optional(),
      origin: z.looseObject({ type: z.string() }).optional(),
    })
    .optional(),
  pricing: z
    .looseObject({
      billable: z.boolean().optional(),
      pricing_model: z.string().optional(),
      category: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
  errors: z.array(metaWebhookErrorSchema).optional(),
  biz_opaque_callback_data: z.string().optional(),
});

const metaValueMetadataSchema = z.looseObject({
  display_phone_number: z.string(),
  phone_number_id: z.string().min(1),
});

export const metaChangeValueSchema = z.looseObject({
  messaging_product: z.literal("whatsapp"),
  metadata: metaValueMetadataSchema,
  contacts: z
    .array(
      z.looseObject({
        wa_id: z.string().min(1),
        profile: z.looseObject({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(z.record(z.string(), z.unknown())).optional(),
  statuses: z.array(z.record(z.string(), z.unknown())).optional(),
  errors: z.array(z.unknown()).optional(),
});

/** Coexistence: messages the business sent from the WhatsApp Business app (`smb_message_echoes`). */
export const metaEchoValueSchema = z.looseObject({
  messaging_product: z.literal("whatsapp"),
  metadata: metaValueMetadataSchema,
  message_echoes: z.array(z.record(z.string(), z.unknown())).optional(),
});

/** An echo is a message object (business number in `from`) plus the contact in `to`. */
export const metaEchoSchema = z.looseObject({ to: z.string().min(1) });

/** Coexistence: chunks of the WhatsApp Business app's chat history (`history`). */
export const metaHistoryValueSchema = z.looseObject({
  messaging_product: z.literal("whatsapp"),
  metadata: metaValueMetadataSchema,
  history: z
    .array(
      z.looseObject({
        metadata: z
          .looseObject({
            phase: z.number().optional(),
            chunk_order: z.number().optional(),
            progress: z.number().optional(),
          })
          .optional(),
        threads: z
          .array(
            z.looseObject({
              /** The contact's WhatsApp number. */
              id: z.string().min(1),
              messages: z.array(z.record(z.string(), z.unknown())).optional(),
            }),
          )
          .optional(),
        /** Present instead of `threads` when the business declined history sharing (2593109). */
        errors: z.array(metaWebhookErrorSchema).optional(),
      }),
    )
    .optional(),
});

/** `history_context` of one history message. */
export const metaHistoryContextSchema = z.looseObject({
  history_context: z.looseObject({ status: z.string().optional() }).optional(),
});

export const metaWebhookChangeSchema = z.looseObject({
  field: z.string(),
  value: z.unknown(),
});

export const metaWebhookEntrySchema = z.looseObject({
  id: z.string(),
  changes: z.array(metaWebhookChangeSchema),
});

/** The webhook body's `object` for WhatsApp Cloud API notifications. */
export const WHATSAPP_WEBHOOK_OBJECT = "whatsapp_business_account";

export const metaWebhookPayloadSchema = z.looseObject({
  object: z.literal(WHATSAPP_WEBHOOK_OBJECT),
  entry: z.array(metaWebhookEntrySchema),
});

export type MetaWebhookPayload = z.input<typeof metaWebhookPayloadSchema>;
export type MetaChangeValue = z.output<typeof metaChangeValueSchema>;

/* ------------------------------------------------------------------ */
/* Normalized output (camelCase) returned by parseWebhook.             */
/* ------------------------------------------------------------------ */

export const webhookErrorSchema = z.object({
  code: z.number(),
  title: z.string(),
  message: z.string().optional(),
  details: z.string().optional(),
});
export type WebhookError = z.infer<typeof webhookErrorSchema>;

export const inboundMessageContextSchema = z.object({
  replyToMetaId: z.string().optional(),
  replyToFrom: z.string().optional(),
  forwarded: z.boolean().optional(),
  frequentlyForwarded: z.boolean().optional(),
});
export type InboundMessageContext = z.infer<typeof inboundMessageContextSchema>;

export const inboundReferralSchema = z.object({
  sourceId: z.string(),
  sourceType: z.string().optional(),
  sourceUrl: z.string().optional(),
  headline: z.string().optional(),
  ctwaClid: z.string().optional(),
});
export type InboundReferral = z.infer<typeof inboundReferralSchema>;

const inboundBaseShape = {
  metaMessageId: z.string(),
  from: z.string(),
  timestamp: z.date(),
  context: inboundMessageContextSchema.optional(),
  /** Set when the contact came from a Click-to-WhatsApp ad; `source` becomes `ad:<sourceId>`. */
  referral: inboundReferralSchema.optional(),
};

const mediaShape = {
  mediaId: z.string(),
  mimeType: z.string(),
  sha256: z.string().optional(),
};

export const contactCardSchema = z.object({
  formattedName: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phones: z.array(
    z.object({
      phone: z.string().optional(),
      waId: z.string().optional(),
      type: z.string().optional(),
    }),
  ),
  emails: z.array(z.object({ email: z.string().optional(), type: z.string().optional() })),
  organization: z.string().optional(),
});
export type ContactCard = z.infer<typeof contactCardSchema>;

export const interactiveReplySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("button_reply"), id: z.string(), title: z.string() }),
  z.object({
    type: z.literal("list_reply"),
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
  }),
]);
export type InteractiveReply = z.infer<typeof interactiveReplySchema>;

export const inboundMessageSchema = z.discriminatedUnion("type", [
  z.object({ ...inboundBaseShape, type: z.literal("text"), body: z.string() }),
  z.object({
    ...inboundBaseShape,
    ...mediaShape,
    type: z.literal("image"),
    caption: z.string().optional(),
  }),
  z.object({
    ...inboundBaseShape,
    ...mediaShape,
    type: z.literal("audio"),
    voice: z.boolean().optional(),
  }),
  z.object({
    ...inboundBaseShape,
    ...mediaShape,
    type: z.literal("video"),
    caption: z.string().optional(),
  }),
  z.object({
    ...inboundBaseShape,
    ...mediaShape,
    type: z.literal("document"),
    caption: z.string().optional(),
    filename: z.string().optional(),
  }),
  z.object({
    ...inboundBaseShape,
    ...mediaShape,
    type: z.literal("sticker"),
    animated: z.boolean().optional(),
  }),
  z.object({
    ...inboundBaseShape,
    type: z.literal("location"),
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
  z.object({
    ...inboundBaseShape,
    type: z.literal("contacts"),
    contacts: z.array(contactCardSchema),
  }),
  z.object({
    ...inboundBaseShape,
    type: z.literal("reaction"),
    /** `null` when the contact removed their reaction. */
    emoji: z.string().nullable(),
    targetMetaId: z.string(),
  }),
  z.object({ ...inboundBaseShape, type: z.literal("interactive"), reply: interactiveReplySchema }),
  z.object({
    ...inboundBaseShape,
    type: z.literal("button"),
    text: z.string(),
    payload: z.string().optional(),
  }),
  z.object({
    ...inboundBaseShape,
    type: z.literal("unsupported"),
    originalType: z.string(),
    raw: z.record(z.string(), z.unknown()),
    errors: z.array(webhookErrorSchema).optional(),
  }),
]);
export type InboundMessage = z.infer<typeof inboundMessageSchema>;
export type InboundMessageType = InboundMessage["type"];
export type InboundMessageOf<T extends InboundMessageType> = Extract<InboundMessage, { type: T }>;
export type InboundMediaMessage = InboundMessageOf<
  "image" | "audio" | "video" | "document" | "sticker"
>;

export const statusUpdateSchema = z.object({
  metaMessageId: z.string(),
  status: z.enum(DELIVERY_STATUSES),
  timestamp: z.date(),
  recipientId: z.string(),
  conversation: z
    .object({
      id: z.string(),
      expiresAt: z.date().optional(),
      originType: z.string().optional(),
    })
    .optional(),
  pricing: z
    .object({
      billable: z.boolean().optional(),
      pricingModel: z.string().optional(),
      category: z.string().optional(),
      type: z.string().optional(),
    })
    .optional(),
  errors: z.array(webhookErrorSchema).optional(),
  bizOpaqueCallbackData: z.string().optional(),
});
export type StatusUpdate = z.infer<typeof statusUpdateSchema>;

/** A WhatsApp `messages` change: inbound messages and delivery statuses for one number. */
export const parsedMessagesChangeSchema = z.object({
  kind: z.literal("messages"),
  wabaId: z.string(),
  phoneNumberId: z.string(),
  displayPhone: z.string(),
  contacts: z.array(z.object({ waId: z.string(), profileName: z.string().nullable() })),
  messages: z.array(inboundMessageSchema),
  statuses: z.array(statusUpdateSchema),
  errors: z.array(z.unknown()),
});
export type ParsedMessagesChange = z.infer<typeof parsedMessagesChangeSchema>;
/** A message the business sent from the WhatsApp Business app (coexistence). */
export const echoMessageSchema = z.object({
  /** The contact's WhatsApp number (`message.from` is the business number). */
  to: z.string(),
  message: inboundMessageSchema,
});
export type EchoMessage = z.infer<typeof echoMessageSchema>;

/** A WhatsApp `smb_message_echoes` change: phone-app messages for one number. */
export const parsedEchoSchema = z.object({
  kind: z.literal("echo"),
  wabaId: z.string(),
  phoneNumberId: z.string(),
  displayPhone: z.string(),
  echoes: z.array(echoMessageSchema),
});
export type ParsedEcho = z.infer<typeof parsedEchoSchema>;

/** One message of the WhatsApp Business app's history. */
export const historyMessageSchema = z.object({
  /** `in`: sent by the contact; `out`: sent by the business from the phone app. */
  direction: z.enum(["in", "out"]),
  /** Last known delivery status of an `out` message, when Meta reports one we track. */
  status: z.enum(DELIVERY_STATUSES).nullable(),
  message: inboundMessageSchema,
});
export type HistoryMessage = z.infer<typeof historyMessageSchema>;

/** A WhatsApp `history` change: imported phone-app chats, one thread per contact. */
export const parsedHistorySchema = z.object({
  kind: z.literal("history"),
  wabaId: z.string(),
  phoneNumberId: z.string(),
  displayPhone: z.string(),
  threads: z.array(z.object({ waId: z.string(), messages: z.array(historyMessageSchema) })),
  /** E.g. code 2593109 when the business declined to share its history. */
  errors: z.array(webhookErrorSchema),
});
export type ParsedHistory = z.infer<typeof parsedHistorySchema>;

/** @deprecated Use `parsedMessagesChangeSchema`; `ParsedChange` (in `channels/types`) is the union of all variants. */
export const parsedChangeSchema = parsedMessagesChangeSchema;
export type WebhookContact = ParsedMessagesChange["contacts"][number];
