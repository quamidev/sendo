import type { ContactUpsertResult } from "../../adapters/types";
import { RecordNotFoundError } from "../../errors/errors";
import type { Account, Contact } from "../../types/entities";
import type { SendoContext } from "../context";

export interface EnsureContactInput {
  account: Account;
  /** E.164, or anything `normalizePhone` accepts (pass `+${wa_id}` for webhook senders). */
  phone: string;
  waId?: string | null;
  profileName?: string | null;
}

export interface SetOptInOptions {
  /** Where the decision came from (`contact.opt_in` `source`). Default `api`. */
  source?: string;
  /** The folded opt-out keyword, when an inbound keyword triggered it. */
  keyword?: string | null;
  /** The inbound message that carried the keyword. */
  messageId?: string | null;
}

export interface ContactsService {
  /**
   * Upserts the contact by `(account, phone)`. On create or profile change calls
   * `config.linkContact` and stores the result as `appRef` (errors are logged).
   */
  ensure(input: EnsureContactInput): Promise<ContactUpsertResult>;
  /**
   * Records an explicit marketing decision: `marketingOptIn = optIn`, `optInAt = now`, and emits
   * `contact.opt_in`. Repeating the stored explicit decision changes nothing and emits nothing.
   * Unknown contact → `RecordNotFoundError`.
   */
  setOptIn(contact: Contact | string, optIn: boolean, opts?: SetOptInOptions): Promise<Contact>;
}

export function createContactsService(ctx: SendoContext): ContactsService {
  return {
    async ensure({ account, phone, waId, profileName }) {
      const normalized = ctx.normalizePhone(phone);
      const result = await ctx.adapter.contacts.upsert({
        accountId: account.id,
        tenantId: account.tenantId,
        phone: normalized,
        waId,
        profileName,
      });
      const linkContact = ctx.config.linkContact;
      if (linkContact === null || (!result.created && !result.profileChanged)) return result;
      try {
        const appRef = await linkContact({ phone: normalized, account, contact: result.contact });
        if (appRef === result.contact.appRef) return result;
        const contact = await ctx.adapter.contacts.setAppRef(result.contact.id, appRef);
        return { ...result, contact };
      } catch (error) {
        ctx.logger.error("[sendo] linkContact failed", error);
        return result;
      }
    },

    async setOptIn(ref, optIn, opts = {}) {
      let current: Contact;
      if (typeof ref === "string") {
        const found = await ctx.adapter.contacts.get(ref);
        if (found === null) throw new RecordNotFoundError({ entity: "contact", id: ref });
        current = found;
      } else {
        current = ref;
      }
      if (current.optInAt !== null && current.marketingOptIn === optIn) return current;
      const contact = await ctx.adapter.contacts.setOptIn(current.id, {
        marketingOptIn: optIn,
        optInAt: new Date(),
      });
      await ctx.emitter.emit("contact.opt_in", {
        contact,
        optIn,
        previous: { marketingOptIn: current.marketingOptIn, optInAt: current.optInAt },
        source: opts.source ?? "api",
        keyword: opts.keyword ?? null,
        messageId: opts.messageId ?? null,
      });
      return contact;
    },
  };
}
