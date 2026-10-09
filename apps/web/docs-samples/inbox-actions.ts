// app/(protected)/inbox/actions.ts
"use server";

import type { InboxReplyPayload } from "@quami/sendo";
import { sendo } from "./sendo";

// #region auth
interface AppUser {
  id: string;
  tenantId: string | null;
}

// Fail closed: throw until you wire your app's session check.
async function requireUser(): Promise<AppUser> {
  throw new Error("TODO: requireUser() — return the signed-in staff user or throw.");
}

// The acting user: role and queues come from `resolveRole` in lib/sendo.ts.
// No `resolveRole`, or no role in the tenant, throws ForbiddenError (FORBIDDEN).
async function requireActor() {
  const user = await requireUser();
  return sendo.actor(user.id, user.tenantId);
}
// #endregion auth

// #region actions
export async function listConversations(cursor?: string) {
  const actor = await requireActor();
  // Agents only get their own conversations and unassigned ones in their queues.
  return sendo.inbox.list({ actor, status: ["human", "agent"], cursor });
}

export async function openThread(conversationId: string, cursor?: string) {
  const actor = await requireActor();
  const page = await sendo.inbox.thread(conversationId, { actor, cursor });
  await sendo.inbox.markSeen(conversationId, { actor });
  return { ...page, items: page.items.toReversed() }; // newest first → chronological
}

export async function reply(conversationId: string, payload: InboxReplyPayload) {
  // Step-in: sends as the user; the status and the agent don't change.
  return sendo.inbox.reply(conversationId, payload, { actor: await requireActor() });
}

export async function take(conversationId: string) {
  return sendo.inbox.take(conversationId, { actor: await requireActor() });
}
// #endregion actions

// #region team
export async function note(conversationId: string, text: string) {
  return sendo.inbox.note(conversationId, text, { actor: await requireActor() });
}

export async function pauseAgent(conversationId: string, paused: boolean) {
  // Supervisors and admins only (conversations.pause_agent).
  return sendo.inbox.pauseAgent(conversationId, paused, { actor: await requireActor() });
}

export async function approveDraft(messageId: string, text?: string) {
  return sendo.inbox.approveDraft(messageId, { actor: await requireActor(), text });
}

export async function assign(conversationId: string, userId: string | null) {
  // Anyone but yourself needs conversations.reassign (supervisors and admins).
  return sendo.inbox.assign(conversationId, userId, { actor: await requireActor() });
}
// #endregion team
