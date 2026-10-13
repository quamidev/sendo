import type { Actor, BroadcastRecipientInput, TenantId } from "@quami/sendo";

export interface BroadcastsUser {
  /** The signed-in user; `sendo.actor(userId, tenantId)` resolves their role through `resolveRole`. */
  userId: string;
  /** Tenant whose numbers and contacts the user broadcasts to; `null` for single-tenant apps. */
  tenantId: TenantId;
}

/**
 * The signed-in user. The broadcasts page and every server action call it first.
 * Fails closed: until it is implemented, the page throws instead of showing data.
 * If you installed inbox, return the same user as its `inbox-config.ts`.
 */
export function requireUser(): Promise<BroadcastsUser> {
  // TODO: implement requireUser() with your app's auth: return the user's id and tenant
  // (e.g. from the session and `app_metadata.tenant_id`), or redirect to your login page.
  return Promise.reject(
    new Error(
      "sendo broadcasts: implement requireUser() in app/(protected)/inbox/broadcasts/broadcasts-config.ts before using the broadcasts page.",
    ),
  );
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

/**
 * Your audiences. Until you add some, the screen explains how. Example:
 *
 *   list: async () => [{ id: "torre-a", label: "Residentes de Torre A" }],
 *   recipients: async (id) =>
 *     (await db.residents.byTower(id)).map((r) => ({ phone: r.phone, variables: [r.firstName] })),
 */
export const broadcastAudiences: BroadcastAudienceSource = {
  list: () => Promise.resolve([]),
  recipients: () => Promise.resolve([]),
};
