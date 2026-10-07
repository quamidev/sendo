import type {
  ButtonsInput,
  ListInput,
  MessagePayload,
  TemplateButtonInput,
  TemplateInput,
} from "../client/payloads";
import {
  buildButtonsPayload,
  buildListPayload,
  buildMediaPayload,
  buildReactionPayload,
  buildTextPayload,
} from "../client/payloads";
import { NotImplementedError, PayloadValidationError } from "../errors/errors";
import type { Account, Contact, Conversation, JsonObject } from "../types/entities";
import type { MediaType, MessageType, OutboundSender } from "../types/enums";
import { assertMediaAcceptable } from "../utils/media";
import type { WhatsAppContext } from "./context";

/** Who a message goes to and who it is stored as sent by. */
export interface SendTarget {
  account: Account;
  contact: Contact;
  conversation: Conversation;
  sender: OutboundSender;
  /** Agent name or user id. */
  senderRef?: string | null;
}

export interface SendMediaInput {
  type: MediaType;
  /** Public http(s) URL Meta downloads from. */
  url?: string;
  /** Uploaded to Meta first (`transport.uploadMedia`). */
  file?: Blob | Uint8Array;
  /** A Meta media id from an earlier upload. */
  id?: string;
  /** Required for `Uint8Array` files; defaults to `Blob.type`. */
  mimeType?: string;
  caption?: string;
  filename?: string;
}

export interface ReplyToOption {
  /** Meta message id (`wamid…`) to quote. */
  replyTo?: string;
}

export interface TextOptions extends ReplyToOption {
  previewUrl?: boolean;
}

export interface TemplateSendOptions extends ReplyToOption {
  language: string;
  variables?: string[] | Record<string, string>;
  headerMedia?: TemplateInput["headerMedia"];
  buttons?: TemplateButtonInput[];
}

/** Everything wa-li can send into a conversation. */
export type OutboundInput =
  | ({ kind: "text"; body: string } & TextOptions)
  | ({ kind: "media"; media: SendMediaInput } & ReplyToOption)
  | ({ kind: "buttons"; input: ButtonsInput } & ReplyToOption)
  | ({ kind: "list"; input: ListInput } & ReplyToOption)
  | ({ kind: "template"; name: string } & TemplateSendOptions)
  | { kind: "reaction"; metaMessageId: string; emoji: string };

export interface PendingUpload {
  file: Blob | Uint8Array;
  mimeType: string;
  mediaType: MediaType;
  filename?: string;
  /** Builds the final payload once Meta returned the media id. */
  build(mediaId: string): MessagePayload;
}

/** A validated outbound message, ready for `services.messages.sendOutbound`. */
export interface ComposedOutbound {
  payload: MessagePayload;
  type: Exclude<MessageType, "status_placeholder">;
  content: JsonObject;
  text: string | null;
  replyTo?: string;
  skipWindowCheck?: boolean;
  upload?: PendingUpload;
}

const UPLOAD_PLACEHOLDER_ID = "pending-upload";

function optional(entries: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));
}

function composeMedia(
  ctx: WhatsAppContext,
  to: string,
  media: SendMediaInput,
  replyTo?: string,
): ComposedOutbound {
  const sources = [media.url, media.file, media.id].filter((v) => v !== undefined).length;
  if (sources !== 1) {
    throw new PayloadValidationError({
      field: "media",
      message: "needs exactly one of `url`, `file` or `id`",
    });
  }
  const opts = { replyTo };
  const base = { type: media.type, caption: media.caption, filename: media.filename };
  const content = optional({
    url: media.url,
    id: media.id,
    caption: media.caption,
    filename: media.filename,
    mimeType: media.mimeType,
  });
  const shared = { type: media.type, text: media.caption ?? null, replyTo };
  if (media.file === undefined) {
    return {
      ...shared,
      payload: buildMediaPayload(to, { ...base, url: media.url, id: media.id }, opts),
      content,
    };
  }

  if (ctx.transport.uploadMedia === undefined) {
    throw new NotImplementedError(`media uploads on the "${ctx.transport.kind}" transport`);
  }
  const file = media.file;
  const mimeType = media.mimeType ?? (file instanceof Blob ? file.type : "");
  if (mimeType === "") {
    throw new PayloadValidationError({
      field: "media.mimeType",
      message: "is required when `file` has no type",
    });
  }
  const size = file instanceof Blob ? file.size : file.byteLength;
  assertMediaAcceptable(media.type, size, mimeType);
  return {
    ...shared,
    // Validates caption/filename now; the real id is filled in after the upload.
    payload: buildMediaPayload(to, { ...base, id: UPLOAD_PLACEHOLDER_ID }, opts),
    content: { ...content, mimeType, sizeBytes: size },
    upload: {
      file,
      mimeType,
      mediaType: media.type,
      filename: media.filename,
      build: (mediaId) => buildMediaPayload(to, { ...base, id: mediaId }, opts),
    },
  };
}

/**
 * Validates an outbound input and builds its Meta payload. Throws before any
 * write: `PayloadValidationError`, `MediaTooLargeError`, `TemplateNotFoundError`,
 * `TemplateVariablesError`.
 */
export async function composeOutbound(
  ctx: WhatsAppContext,
  target: SendTarget,
  input: OutboundInput,
): Promise<ComposedOutbound> {
  const to = target.contact.phone;
  switch (input.kind) {
    case "text":
      return {
        payload: buildTextPayload(to, input.body, {
          previewUrl: input.previewUrl,
          replyTo: input.replyTo,
        }),
        type: "text",
        content: optional({ body: input.body, previewUrl: input.previewUrl }),
        text: input.body,
        replyTo: input.replyTo,
      };
    case "media":
      return composeMedia(ctx, to, input.media, input.replyTo);
    case "buttons":
    case "list": {
      const payload =
        input.kind === "buttons"
          ? buildButtonsPayload(to, input.input, { replyTo: input.replyTo })
          : buildListPayload(to, input.input, { replyTo: input.replyTo });
      return {
        payload,
        type: "interactive",
        content: { ...payload.interactive },
        text: input.input.body,
        replyTo: input.replyTo,
      };
    }
    case "template": {
      const prepared = await ctx.services.templates.prepare({
        account: target.account,
        to,
        name: input.name,
        language: input.language,
        variables: input.variables,
        headerMedia: input.headerMedia,
        buttons: input.buttons,
        replyTo: input.replyTo,
      });
      return {
        payload: prepared.payload,
        type: "template",
        content: prepared.content,
        text: prepared.text,
        replyTo: input.replyTo,
        skipWindowCheck: true,
      };
    }
    case "reaction":
      return {
        payload: buildReactionPayload(to, input.metaMessageId, input.emoji),
        type: "reaction",
        content: { messageId: input.metaMessageId, emoji: input.emoji },
        text: input.emoji === "" ? null : input.emoji,
      };
  }
}
