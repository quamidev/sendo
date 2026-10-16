// Installed by `npx shadcn add @sendo/broadcasts`, then adapted for the playground: the user comes from
// the playground's auth (fixed dev user in fixtures mode) and the audiences come from the inbox's
// own contacts. Kept on reinstall (see scripts/registry-install.mjs).
import type { Actor, BroadcastRecipientInput, TenantId } from "@quami/sendo";
import { requireUser as requireAppUser } from "@/lib/auth";
import { playground, sendo } from "@/lib/sendo";

export interface BroadcastsUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose numbers and contacts the user broadcasts to; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/** The signed-in user (redirects to /login), once the fixtures are seeded. */
export async function requireUser(): Promise<BroadcastsUser> {
  const user = await requireAppUser();
  await playground.ready;
  return user;
}

/** A contact list or filter the admin can pick in "Destinatarios". */
export interface BroadcastAudience {
  /** Stable id, sent back to `recipients` (e.g. "torre-a", "cobro-pendiente"). */
  id: string;
  /** Shown in the picker, e.g. "Residentes de Torre A". */
  label: string;
  description?: string;
  /** Approximate number of contacts, when it is cheap to know. */
  size?: number;
}

export interface BroadcastAudienceContext {
  user: BroadcastsUser;
  /** Admin actor (`broadcasts.manage`) of the user's tenant. */
  actor: Actor;
  /** The number the broadcast goes out from (account id). */
  accountId: string;
}

/**
 * Where recipients come from: your app's own contact lists or filters. Sendo stores no
 * audiences; the screen shows what `list` returns and sends `recipients(id)` to
 * `sendo.broadcasts.preview` / `create` (always on the server, never from the browser).
 */
export interface BroadcastAudienceSource {
  /** The lists and filters offered for one number. */
  list(ctx: BroadcastAudienceContext): Promise<BroadcastAudience[]>;
  /**
   * The recipients of one audience: Sendo contact ids, `{ phone }` (any format; upserted as a
   * contact on create) or either with its own template `variables` (e.g. `["Ana", "15 nov"]`),
   * which win over the ones typed in the screen. Opt-in is checked by Sendo, not here: return
   * everyone in the list and the preview shows who is skipped and why.
   */
  recipients(audienceId: string, ctx: BroadcastAudienceContext): Promise<BroadcastRecipientInput[]>;
}

/** Test phones of the playground (the last one is invalid on purpose: "Teléfono inválido"). */
export const PLAYGROUND_TEST_PHONES = ["+502 5555 0101", "+502 5555 0102", "+1 555 0100 777", "12"];

/** Every contact with a conversation on the number, paged through the inbox API. */
async function inboxContacts(ctx: BroadcastAudienceContext): Promise<string[]> {
  const ids = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await sendo.inbox.list({
      actor: ctx.actor,
      accountId: ctx.accountId,
      status: ["agent", "human", "closed"],
      cursor,
      limit: 100,
    });
    for (const conversation of page.items) ids.add(conversation.contact.id);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return [...ids];
}

/** The playground's audiences: the inbox's contacts, or a few test phones. */
export const broadcastAudiences: BroadcastAudienceSource = {
  list: async (ctx) => [
    {
      id: "inbox",
      label: "Contactos de la bandeja",
      description: "Todos los que tienen una conversación con este número.",
      size: (await inboxContacts(ctx)).length,
    },
    {
      id: "test-phones",
      label: "Teléfonos de prueba",
      description: "Tres números de prueba y uno inválido.",
      size: PLAYGROUND_TEST_PHONES.length,
    },
  ],
  recipients: async (audienceId, ctx) => {
    if (audienceId === "inbox") return inboxContacts(ctx);
    if (audienceId === "test-phones") return PLAYGROUND_TEST_PHONES.map((phone) => ({ phone }));
    return [];
  },
};
