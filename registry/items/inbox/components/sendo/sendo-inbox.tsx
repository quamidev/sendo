"use client";

import { getSendoRealtimeClient } from "@/lib/sendo-realtime";
import { Inbox, type InboxProps } from "./inbox";

export type SendoInboxProps = Omit<InboxProps, "realtimeClient"> & {
  /** Subscribe to Supabase Realtime (decided on the server, see `inboxRealtimeEnabled()`). */
  realtime: boolean;
};

/** Client boundary for the page: creates the browser realtime client, then renders `<Inbox>`. */
export function SendoInbox({ realtime, ...props }: SendoInboxProps) {
  return <Inbox {...props} realtimeClient={realtime ? getSendoRealtimeClient() : null} />;
}
