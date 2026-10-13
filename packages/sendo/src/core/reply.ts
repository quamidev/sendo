import type { ButtonsInput, ListInput } from "../client/payloads";
import { RecordNotFoundError } from "../errors/errors";
import type { Message } from "../types/entities";
import { isUuid } from "./accounts";
import type { SendoContext } from "./context";
import type {
  OutboundInput,
  ReplyToOption,
  SendMediaInput,
  SendTarget,
  TemplateSendOptions,
  TextOptions,
} from "./outbound";

/** Sends into one conversation. Bound to the `message` event, agents and the inbox. */
export interface Reply {
  text(body: string, opts?: TextOptions): Promise<Message>;
  media(media: SendMediaInput, opts?: ReplyToOption): Promise<Message>;
  buttons(input: ButtonsInput, opts?: ReplyToOption): Promise<Message>;
  list(input: ListInput, opts?: ReplyToOption): Promise<Message>;
  template(name: string, opts: TemplateSendOptions): Promise<Message>;
  /** Reacts to `messageId` (sendo or Meta id), default the bound message. `""` removes it. */
  react(emoji: string, messageId?: string): Promise<Message>;
  /** Marks `messageId` (sendo or Meta id), default the bound message, as read. */
  markRead(messageId?: string): Promise<void>;
}

export interface CreateReplyInput extends SendTarget {
  /** The inbound message being answered (default target of `react`/`markRead`). */
  message?: Message;
}

export function createReply(ctx: SendoContext, input: CreateReplyInput): Reply {
  const { message, ...target } = input;
  const send = (target: SendTarget, outbound: OutboundInput) =>
    ctx.services.messages.send(target, outbound);

  async function targetMetaId(ref: string | undefined): Promise<string> {
    if (ref === undefined) {
      if (message?.metaMessageId == null) {
        throw new RecordNotFoundError({ entity: "message", id: message?.id ?? "(none)" });
      }
      return message.metaMessageId;
    }
    const found = await ctx.services.messages.find(ref);
    if (found?.metaMessageId != null) return found.metaMessageId;
    if (found === null && !isUuid(ref)) return ref;
    throw new RecordNotFoundError({ entity: "message", id: ref });
  }

  return {
    text: (body, opts = {}) => send(target, { kind: "text", body, ...opts }),
    media: (media, opts = {}) => send(target, { kind: "media", media, ...opts }),
    buttons: (buttons, opts = {}) => send(target, { kind: "buttons", input: buttons, ...opts }),
    list: (list, opts = {}) => send(target, { kind: "list", input: list, ...opts }),
    template: (name, opts) => send(target, { kind: "template", name, ...opts }),
    async react(emoji, messageId) {
      const metaMessageId = await targetMetaId(messageId);
      return send(target, { kind: "reaction", metaMessageId, emoji });
    },
    async markRead(messageId) {
      await ctx.services.messages.markRead(await targetMetaId(messageId));
    },
  };
}
