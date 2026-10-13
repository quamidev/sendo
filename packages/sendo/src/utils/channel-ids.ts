import { ConfigError, PayloadValidationError } from "../errors/errors";
import type { Account, Contact } from "../types/entities";

/** The account's Meta phone number id; WhatsApp accounts always have one (schema check). */
export function requirePhoneNumberId(account: Pick<Account, "id" | "phoneNumberId">): string {
  if (account.phoneNumberId === null) {
    throw new ConfigError(`Account ${account.id} has no phone_number_id.`);
  }
  return account.phoneNumberId;
}

/** The account's WhatsApp Business Account id; WhatsApp accounts always have one. */
export function requireWabaId(account: Pick<Account, "id" | "wabaId">): string {
  if (account.wabaId === null) {
    throw new ConfigError(`Account ${account.id} has no waba_id.`);
  }
  return account.wabaId;
}

/** The contact's phone, the WhatsApp recipient address. */
export function requireContactPhone(contact: Pick<Contact, "id" | "phone">): string {
  if (contact.phone === null) {
    throw new PayloadValidationError({
      field: "to",
      message: `contact ${contact.id} has no phone number`,
    });
  }
  return contact.phone;
}
