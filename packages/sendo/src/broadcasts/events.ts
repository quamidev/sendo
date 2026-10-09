import type { Contact } from "../types/entities";

/** A contact's marketing opt-in changed (`sendo.contacts.setOptIn` or an opt-out keyword). */
export interface ContactOptInEvent {
  /** The contact after the change. */
  contact: Contact;
  optIn: boolean;
  /** The value before the change. */
  previous: { marketingOptIn: boolean; optInAt: Date | null };
  /** `keyword` for an inbound opt-out keyword, else the caller's `source` (default `api`). */
  source: string;
  /** The folded keyword that matched (`source: "keyword"`), else null. */
  keyword: string | null;
  /** The inbound message that carried the keyword, else null. */
  messageId: string | null;
}

/** Events of the broadcasts module, merged into `SendoEventMap`. */
export interface BroadcastsEventMap {
  "contact.opt_in": ContactOptInEvent;
}
