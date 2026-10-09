// app/(protected)/whatsapp/actions.ts
"use server";

import type { InboxReplyPayload } from "@quami/wa-li";
import { wa } from "./whatsapp";

// #region auth
interface AppUser {
  id: string;
  tenantId: string | null;
}

// Fail closed: throw until you wire your app's session check.
async function requireUser(): Promise<AppUser> {
  throw new Error("TODO: requireUser() — return the signed-in staff user or throw.");
}
// #endregion auth

// #region actions
export async function listConversations(cursor?: string) {
  const user = await requireUser();
  return wa.inbox.list({ tenantId: user.tenantId, status: ["human", "agent"], cursor });
}

export async function openThread(conversationId: string, cursor?: string) {
  const user = await requireUser();
  const page = await wa.inbox.thread(conversationId, { tenantId: user.tenantId, cursor });
  await wa.inbox.markSeen(conversationId, { tenantId: user.tenantId });
  return { ...page, items: page.items.toReversed() }; // newest first → chronological
}

export async function reply(conversationId: string, payload: InboxReplyPayload) {
  const user = await requireUser();
  return wa.inbox.reply(conversationId, payload, { userId: user.id, tenantId: user.tenantId });
}

export async function take(conversationId: string) {
  const user = await requireUser();
  await assertSameTenant(conversationId, user);
  return wa.conversations.assign(conversationId, user.id, { by: user.id });
}
// #endregion actions

async function assertSameTenant(conversationId: string, user: AppUser) {
  const conversation = await wa.conversations.get(conversationId);
  if (conversation === null || conversation.tenantId !== user.tenantId) {
    throw new Error("Not found");
  }
}
