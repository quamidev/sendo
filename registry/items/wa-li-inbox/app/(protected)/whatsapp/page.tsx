import { WhatsAppInbox } from "@/components/whatsapp/whatsapp-inbox";
import { serializeConversation } from "@/components/whatsapp/types";
import { wa } from "@/lib/whatsapp";
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
import "@/components/whatsapp/motion.css";

export const metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

export default async function WhatsAppInboxPage() {
  const user = await requireUser();
  const page = await wa.inbox.list({ tenantId: user.tenantId, status: "human" });

  return (
    <main className="h-dvh">
      <WhatsAppInbox
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
