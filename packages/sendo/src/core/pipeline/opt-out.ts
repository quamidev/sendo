import { matchOptOutKeyword } from "../../broadcasts/opt-out";
import type { Account, Contact, Conversation, MessageWithMedia } from "../../types/entities";
import { windowStatus } from "../../utils/window";
import type { SendoContext } from "../context";

/** `metadata.agentSkipped` of an opt-out keyword message (the agent never answers it). */
export const SKIPPED_OPT_OUT = "opt_out";

const KEYWORD_TYPES = new Set(["text", "button", "interactive"]);

export interface OptOutResult {
  contact: Contact;
  message: MessageWithMedia;
}

/**
 * AC-BC-5: an inbound message that is exactly an opt-out keyword (trim, case and accent
 * folding) sets `marketingOptIn = false` + `optInAt = now` (emitting `contact.opt_in`), marks
 * the message `metadata.optOut` / `agentSkipped: "opt_out"`, and sends the confirmation while the
 * window is open (a failed confirmation is logged). Returns null when the message is not a
 * keyword. The caller skips rules and the agent turn for it.
 */
export async function applyOptOut(
  ctx: SendoContext,
  input: {
    account: Account;
    contact: Contact;
    conversation: Conversation;
    message: MessageWithMedia;
  },
): Promise<OptOutResult | null> {
  const { account, conversation, message } = input;
  if (!KEYWORD_TYPES.has(message.type)) return null;
  const keyword = matchOptOutKeyword(ctx.team.optOut, message.text);
  if (keyword === null) return null;

  await ctx.adapter.messages.updateMetadata(message.id, {
    optOut: keyword,
    agentSkipped: SKIPPED_OPT_OUT,
  });
  const current = (await ctx.adapter.contacts.get(input.contact.id)) ?? input.contact;
  const contact = await ctx.services.contacts.setOptIn(current, false, {
    source: "keyword",
    keyword,
    messageId: message.id,
  });

  const confirmation = ctx.team.optOut.confirmation;
  if (confirmation !== null && windowStatus(conversation.lastInboundAt).open) {
    try {
      await ctx.services.messages.send(
        { account, contact, conversation, sender: "system", senderRef: null },
        { kind: "text", body: confirmation },
      );
    } catch (error) {
      ctx.logger.error(
        `[sendo] opt-out confirmation for conversation ${conversation.id} failed`,
        error,
      );
    }
  }
  const stored = (await ctx.adapter.messages.get(message.id)) ?? message;
  return { contact, message: stored };
}
