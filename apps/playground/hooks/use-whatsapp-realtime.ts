"use client";

import type {
  ConversationStatus,
  Direction,
  MessageError,
  MessageStatus,
  MessageType,
  Sender,
} from "@quami/wa-li";
import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

/** `wa_conversations` row as Supabase Realtime delivers it (snake_case). */
export interface WaConversationRow {
  id: string;
  tenant_id: string | null;
  account_id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_to: string | null;
  handoff_reason: string | null;
  last_inbound_at: string | null;
  last_activity_at: string;
  window_expires_at: string | null;
  unread_count: number;
  created_at: string;
}

/** `wa_messages` row as Supabase Realtime delivers it (snake_case). */
export interface WaMessageRow {
  id: string;
  tenant_id: string | null;
  conversation_id: string | null;
  direction: Direction;
  type: MessageType;
  text: string | null;
  meta_message_id: string | null;
  status: MessageStatus;
  error: MessageError | null;
  sender: Sender;
  sender_ref: string | null;
  sent_at: string | null;
  created_at: string;
}

export type RealtimeChange = "INSERT" | "UPDATE";

export interface UseWhatsAppRealtimeOptions {
  /** Browser Supabase client signed in as the operator (RLS applies). `null` disables realtime. */
  client: SupabaseClient | null;
  /** Tenant of the operator; `null` for single-tenant apps (no filter). */
  tenantId: string | null;
  /** When set, message changes are limited to this conversation. */
  conversationId?: string | null;
  onConversation: (row: WaConversationRow, change: RealtimeChange) => void;
  onMessage: (row: WaMessageRow, change: RealtimeChange) => void;
}

function changeOf(eventType: string): RealtimeChange | null {
  return eventType === "INSERT" || eventType === "UPDATE" ? eventType : null;
}

/** Subscribes to `postgres_changes` on `wa_conversations` and `wa_messages`. */
export function useWhatsAppRealtime({
  client,
  tenantId,
  conversationId = null,
  onConversation,
  onMessage,
}: UseWhatsAppRealtimeOptions): void {
  const handlers = useRef({ onConversation, onMessage });
  useEffect(() => {
    handlers.current = { onConversation, onMessage };
  }, [onConversation, onMessage]);

  useEffect(() => {
    if (client === null) return;
    const tenantFilter = tenantId === null ? undefined : `tenant_id=eq.${tenantId}`;
    const messageFilter =
      conversationId === null ? tenantFilter : `conversation_id=eq.${conversationId}`;
    const channel = client
      .channel(`wa-inbox:${tenantId ?? "default"}:${conversationId ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_conversations", filter: tenantFilter },
        (payload: RealtimePostgresChangesPayload<WaConversationRow>) => {
          const change = changeOf(payload.eventType);
          if (change === null || !("id" in payload.new)) return;
          handlers.current.onConversation(payload.new, change);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_messages", filter: messageFilter },
        (payload: RealtimePostgresChangesPayload<WaMessageRow>) => {
          const change = changeOf(payload.eventType);
          if (change === null || !("id" in payload.new)) return;
          // Status placeholders have no conversation and are never shown.
          if (payload.new.conversation_id === null) return;
          handlers.current.onMessage(payload.new, change);
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [client, tenantId, conversationId]);
}
