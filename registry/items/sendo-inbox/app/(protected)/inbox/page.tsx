import { SendoInbox } from "@/components/sendo/sendo-inbox";
import { serializeConversation } from "@/components/sendo/types";
import { sendo } from "@/lib/sendo";
import {
  close,
  list,
  listTemplates,
  markSeen,
  reply,
  returnToAgent,
  take,
  thread,
} from "./actions";
import { inboxRealtimeEnabled, requireUser } from "./inbox-config";
import "@/components/sendo/motion.css";

export const metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

export default async function SendoInboxPage() {
  const user = await requireUser();
  const page = await sendo.inbox.list({ tenantId: user.tenantId, status: "human" });

  return (
    <main className="h-dvh">
      <SendoInbox
        currentUserId={user.userId}
        tenantId={user.tenantId}
        realtime={inboxRealtimeEnabled()}
        actions={{ list, thread, reply, markSeen, take, returnToAgent, close, listTemplates }}
        initialConversations={page.items.map(serializeConversation)}
        initialNextCursor={page.nextCursor}
        initialFilter="human"
      />
    </main>
  );
}
