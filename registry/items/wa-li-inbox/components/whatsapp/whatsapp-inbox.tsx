"use client";

import { getWhatsAppRealtimeClient } from "@/lib/whatsapp-realtime";
import { Inbox, type InboxProps } from "./inbox";

export type WhatsAppInboxProps = Omit<InboxProps, "realtimeClient"> & {
  /** Subscribe to Supabase Realtime (decided on the server, see `inboxRealtimeEnabled()`). */
  realtime: boolean;
};

/** Client boundary for the page: creates the browser realtime client, then renders `<Inbox>`. */
export function WhatsAppInbox({ realtime, ...props }: WhatsAppInboxProps) {
  return <Inbox {...props} realtimeClient={realtime ? getWhatsAppRealtimeClient() : null} />;
}
