import type { ButtonsInput, ListInput } from "../client/payloads";
import type { Account, Message } from "../types/entities";
import type { WhatsAppContext } from "./context";
import type {
  OutboundInput,
  ReplyToOption,
  SendMediaInput,
  SendTarget,
  TemplateSendOptions,
  TextOptions,
} from "./outbound";

export interface AccountOption {
  /** Account object, account id or phone number id. Required when several accounts are active. */
  account?: string | Account;
}

export type SendOptions = AccountOption & ReplyToOption;
export type SendTextOptions = AccountOption & TextOptions;
export type SendTemplateOptions = AccountOption & TemplateSendOptions;

export interface SendApi {
  text(to: string, body: string, opts?: SendTextOptions): Promise<Message>;
  media(to: string, media: SendMediaInput, opts?: SendOptions): Promise<Message>;
  buttons(to: string, input: ButtonsInput, opts?: SendOptions): Promise<Message>;
  list(to: string, input: ListInput, opts?: SendOptions): Promise<Message>;
  template(to: string, name: string, opts: SendTemplateOptions): Promise<Message>;
  /** Marks an inbound message (wa-li id or Meta id) as read. */
  markRead(messageId: string): Promise<void>;
}

/**
 * The 7-step send flow: normalize → resolve account → ensure contact and
 * conversation → window check → pending row → Meta → sent / failed + rethrow.
 * App-initiated sends are stored with sender `"system"`.
 */
export function createSendApi(ctx: WhatsAppContext): SendApi {
  async function deliver(
    to: string,
    account: AccountOption["account"],
    input: OutboundInput,
  ): Promise<Message> {
    await ctx.ready();
    const phone = ctx.normalizePhone(to);
    const resolved = await ctx.resolveAccount({ account });
    const { contact } = await ctx.services.contacts.ensure({ account: resolved, phone });
    const { conversation } = await ctx.services.conversations.ensure({
      account: resolved,
      contact,
    });
    const target: SendTarget = {
      account: resolved,
      contact,
      conversation,
      sender: "system",
      senderRef: null,
    };
    return ctx.services.messages.send(target, input);
  }

  return {
    text: (to, body, { account, ...opts } = {}) =>
      deliver(to, account, { kind: "text", body, ...opts }),
    media: (to, media, { account, ...opts } = {}) =>
      deliver(to, account, { kind: "media", media, ...opts }),
    buttons: (to, input, { account, ...opts } = {}) =>
      deliver(to, account, { kind: "buttons", input, ...opts }),
    list: (to, input, { account, ...opts } = {}) =>
      deliver(to, account, { kind: "list", input, ...opts }),
    template: (to, name, { account, ...opts }) =>
      deliver(to, account, { kind: "template", name, ...opts }),
    async markRead(messageId) {
      await ctx.ready();
      await ctx.services.messages.markRead(messageId);
    },
  };
}
