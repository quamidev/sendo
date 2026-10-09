import type { ContactUpsertResult } from "../../adapters/types";
import type { Account } from "../../types/entities";
import type { SendoContext } from "../context";

export interface EnsureContactInput {
  account: Account;
  /** E.164, or anything `normalizePhone` accepts (pass `+${wa_id}` for webhook senders). */
  phone: string;
  waId?: string | null;
  profileName?: string | null;
}

export interface ContactsService {
  /**
   * Upserts the contact by `(account, phone)`. On create or profile change calls
   * `config.linkContact` and stores the result as `appRef` (errors are logged).
   */
  ensure(input: EnsureContactInput): Promise<ContactUpsertResult>;
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
  };
}
