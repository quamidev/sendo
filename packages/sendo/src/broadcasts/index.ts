import type { SendoContext } from "../core/context";
import { registerBroadcastsTickStep } from "../rules/tick";
import type { Contact } from "../types/entities";
import { createBroadcastsApi } from "./api";
import { broadcastsTickStep } from "./sending";

export type {
  BroadcastCreateInput,
  BroadcastPreview,
  BroadcastPreviewInput,
  BroadcastRecipientInput,
  BroadcastRecipientsQuery,
  BroadcastRecipientView,
  BroadcastsApi,
  BroadcastsListQuery,
  BroadcastView,
} from "./api";
export { DEFAULT_RATE_PER_MINUTE } from "./api";
export type { BroadcastSkipReason, BroadcastVariables } from "./eligibility";
export { BROADCAST_SKIP_REASONS, hasOptedOut, skipReasonFor } from "./eligibility";
export type { BroadcastsEventMap, ContactOptInEvent } from "./events";
export type { OptOutConfig, ResolvedOptOutConfig } from "./opt-out";
export { DEFAULT_OPT_OUT_CONFIRMATION, DEFAULT_OPT_OUT_KEYWORDS, foldOptOutText } from "./opt-out";
export { BILLING_PAUSE_REASON } from "./sending";

export interface ContactsSetOptInOptions {
  /** Where the decision came from (e.g. `form`, `import`); sent on `contact.opt_in`. Default `api`. */
  source?: string;
}

/** `sendo.contacts` (AC-BC-5). */
export interface ContactsApi {
  /**
   * Records an explicit marketing decision: `marketingOptIn = optIn`, `optInAt = now`, and emits
   * `contact.opt_in`. Repeating the stored explicit decision is a no-op (no event). Unknown
   * contact → `RECORD_NOT_FOUND`.
   */
  setOptIn(contactId: string, optIn: boolean, o?: ContactsSetOptInOptions): Promise<Contact>;
}

function createContactsApi(ctx: SendoContext): ContactsApi {
  return {
    async setOptIn(contactId, optIn, o = {}) {
      await ctx.ready();
      return ctx.services.contacts.setOptIn(contactId, optIn, {
        ...(o.source === undefined ? {} : { source: o.source }),
      });
    },
  };
}

/** `SENDO_MODULES` entry: `sendo.broadcasts`, `sendo.contacts` and the tick's broadcasts step. */
export function installBroadcasts(ctx: SendoContext): void {
  ctx.slots.broadcasts = createBroadcastsApi(ctx);
  ctx.slots.contacts = createContactsApi(ctx);
  registerBroadcastsTickStep(ctx, broadcastsTickStep);
}
