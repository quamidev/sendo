import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendoConversationRow, SendoMessageRow } from "@/hooks/use-sendo-realtime";

// The site has no Supabase. The demo inbox still gets "live" updates: when the demo
// conversation changes, `emitDemoChange` delivers the same `postgres_changes` payloads the
// inbox's realtime hook receives from Supabase, through this minimal stand-in client
// (only `channel().on().subscribe()` and `removeChannel()`, which is all the hook uses).

type Table = "sendo_conversations" | "sendo_messages";
type Payload = { eventType: "INSERT" | "UPDATE"; new: SendoConversationRow | SendoMessageRow };
type Listener = { table: Table; callback: (payload: Payload) => void };

class DemoChannel {
  readonly listeners: Listener[] = [];

  on(_type: "postgres_changes", filter: { table: Table }, callback: Listener["callback"]): this {
    this.listeners.push({ table: filter.table, callback });
    return this;
  }

  subscribe(): this {
    return this;
  }
}

const channels = new Set<DemoChannel>();

const client = {
  channel(): DemoChannel {
    const channel = new DemoChannel();
    channels.add(channel);
    return channel;
  },
  removeChannel(channel: DemoChannel): Promise<"ok"> {
    channels.delete(channel);
    return Promise.resolve("ok");
  },
};

/** The stand-in, typed as the Supabase client `useSendoRealtime` expects. */
export const demoRealtimeClient = client as unknown as SupabaseClient;

export function emitDemoChange(
  table: "sendo_conversations",
  row: SendoConversationRow,
  eventType: Payload["eventType"],
): void;
export function emitDemoChange(
  table: "sendo_messages",
  row: SendoMessageRow,
  eventType: Payload["eventType"],
): void;
export function emitDemoChange(
  table: Table,
  row: SendoConversationRow | SendoMessageRow,
  eventType: Payload["eventType"],
): void {
  for (const channel of channels) {
    for (const listener of channel.listeners) {
      if (listener.table === table) listener.callback({ eventType, new: row });
    }
  }
}
