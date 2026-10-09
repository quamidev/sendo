import type { SendoContext } from "../core/context";
import { stubNamespace } from "../core/slots";
import type { Actor } from "../team/permissions";
import type { Contact, Page } from "../types/entities";

/** `sendo.broadcasts` (SND-4.2). Placeholder signatures until the `Broadcast` entity lands. */
export interface BroadcastsApi {
  create(input: Record<string, unknown> & { actor: Actor }): Promise<unknown>;
  preview(input: Record<string, unknown> & { actor: Actor }): Promise<unknown>;
  get(id: string, o: { actor: Actor }): Promise<unknown>;
  list(q: { actor: Actor; cursor?: string | null; limit?: number }): Promise<Page<unknown>>;
  cancel(id: string, o: { actor: Actor }): Promise<unknown>;
}

/** `sendo.contacts` (SND-4.2). */
export interface ContactsApi {
  setOptIn(contactId: string, optIn: boolean, o?: { source?: string }): Promise<Contact>;
}

/** `SENDO_MODULES` entry. Placeholder: keeps the stubs until SND-4.2. */
export function installBroadcasts(ctx: SendoContext): void {
  ctx.slots.broadcasts = stubNamespace("broadcasts");
  ctx.slots.contacts = stubNamespace("contacts");
}
