import { can, isSendoError, type Actor } from "@quami/sendo";
import { InboxAccessDenied } from "@/components/sendo/access-denied";
import { SendoInbox } from "@/components/sendo/sendo-inbox";
import type { InboxNumberView } from "@/components/sendo/types";
import { sendo } from "@/lib/sendo";
import {
  approveDraft,
  assign,
  addTag,
  close,
  deleteSnippet,
  deleteTag,
  discardDraft,
  list,
  listAssignees,
  listSnippets,
  listTags,
  listTemplates,
  markSeen,
  note,
  pauseAgent,
  removeTag,
  renderSnippet,
  reply,
  returnToAgent,
  tagUsage,
  take,
  thread,
  upsertSnippet,
  upsertTag,
} from "./actions";
import {
  inboxAgentNames,
  inboxNav,
  inboxRealtimeEnabled,
  requireUser,
  resolveUserNames,
} from "./inbox-config";
import "@/components/sendo/motion.css";

export const metadata = { title: "Bandeja" };
export const dynamic = "force-dynamic";

/** `null` when the operator has no role in the tenant (AC-RL-4: "No tienes acceso a la bandeja"). */
async function actorOrNull(userId: string, tenantId: Actor["tenantId"]): Promise<Actor | null> {
  try {
    return await sendo.actor(userId, tenantId);
  } catch (error) {
    if (isSendoError(error) && error.code === "FORBIDDEN") return null;
    throw error;
  }
}

export default async function SendoInboxPage() {
  const user = await requireUser();
  const actor = await actorOrNull(user.userId, user.tenantId);
  if (actor === null) {
    return (
      <main className="h-dvh">
        <InboxAccessDenied />
      </main>
    );
  }

  const [initialPage, tags, accounts, names] = await Promise.all([
    list({ tab: "open" }),
    listTags(),
    sendo.accounts.list({ tenant: actor.tenantId, includeInactive: true }),
    resolveUserNames([user.userId]),
  ]);
  if (!initialPage.ok) throw new Error(`sendo inbox: ${initialPage.message}`);
  const numbers: InboxNumberView[] = accounts.map((account) => ({
    id: account.id,
    label: account.label ?? account.displayPhone,
    displayPhone: account.displayPhone,
    active: account.active,
  }));

  return (
    <main className="h-dvh">
      <SendoInbox
        currentUser={{ id: user.userId, name: names[user.userId] ?? null }}
        tenantId={user.tenantId}
        realtime={inboxRealtimeEnabled()}
        actions={{
          list,
          thread,
          reply,
          markSeen,
          take,
          assign,
          returnToAgent,
          close,
          pauseAgent,
          approveDraft,
          discardDraft,
          addTag,
          removeTag,
          listAssignees,
          listTags,
          listTemplates,
          note,
          listSnippets,
          renderSnippet,
          upsertSnippet,
          deleteSnippet,
          upsertTag,
          deleteTag,
          tagUsage,
        }}
        permissions={{
          reassign: can(actor, "conversations.reassign"),
          pauseAgent: can(actor, "conversations.pause_agent"),
          viewCosts: can(actor, "costs.view"),
          manageSnippets: can(actor, "snippets.manage_tenant"),
          manageTags: can(actor, "tags.manage"),
        }}
        numbers={numbers}
        tags={tags.ok ? tags.data : undefined}
        nav={inboxNav}
        agentNames={inboxAgentNames}
        initialPage={initialPage.data}
        initialTab="open"
      />
    </main>
  );
}
