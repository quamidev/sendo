"use client";

import type {
  ConversationStatus,
  Direction,
  MessageError,
  MessageStatus,
  MessageType,
  Sender,
} from "@quami/sendo";
import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimePostgresChangesPayload,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";

/** `sendo_conversations` row as Supabase Realtime delivers it (snake_case). */
export interface SendoConversationRow {
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
  /** Schema v1 team columns (optional so older payloads still type-check). */
  agent_paused?: boolean;
  queue?: string | null;
  source?: string | null;
  assigned_at?: string | null;
}

/** `sendo_messages` row as Supabase Realtime delivers it (snake_case). */
export interface SendoMessageRow {
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
  /** Notes and system lines (`true`) are never sent. */
  internal?: boolean;
  /** An agent reply waiting for approval. */
  draft?: boolean;
}

export type RealtimeChange = "INSERT" | "UPDATE";

export interface UseSendoRealtimeOptions {
  /**
   * Browser Supabase client signed in as the operator (RLS applies). `null` disables realtime:
   * the hook polls instead (non-Supabase adapters, Realtime turned off).
   */
  client: SupabaseClient | null;
  /** Tenant of the operator; `null` for single-tenant apps (no filter). */
  tenantId: string | null;
  /** When set, message changes are limited to this conversation (and polled as the open thread). */
  conversationId?: string | null;
  onConversation: (row: SendoConversationRow, change: RealtimeChange) => void;
  onMessage: (row: SendoMessageRow, change: RealtimeChange) => void;
  /** Polling fallback: refetch the conversation list (every `POLL_LIST_MS`). */
  onPollList?: () => void;
  /** Polling fallback: refetch the open thread (every `POLL_THREAD_MS`). */
  onPollThread?: (conversationId: string) => void;
}

/** Without realtime the list is refetched every 10 s… */
export const POLL_LIST_MS = 10_000;
/** …and the open thread every 3 s, both paused while the tab is hidden. */
export const POLL_THREAD_MS = 3_000;

/** Channel states after which realtime won't deliver changes (polling takes over). */
const DOWN_STATES: ReadonlySet<REALTIME_SUBSCRIBE_STATES> = new Set([
  REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR,
  REALTIME_SUBSCRIBE_STATES.TIMED_OUT,
  REALTIME_SUBSCRIBE_STATES.CLOSED,
]);

/**
 * Calls `tick` every `ms` while the tab is visible. Hidden tabs stop the timer; coming back
 * refetches at once and restarts it.
 */
function useVisibleInterval(tick: (() => void) | null, ms: number): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  }, [tick]);
  const enabled = tick !== null;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => latest.current?.();
    const start = () => {
      if (timer === null) timer = setInterval(run, ms);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else if (timer === null) {
        run();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, ms]);
}

function changeOf(eventType: string): RealtimeChange | null {
  return eventType === "INSERT" || eventType === "UPDATE" ? eventType : null;
}

/**
 * Subscribes to `postgres_changes` on `sendo_conversations` and `sendo_messages`. Without
 * realtime (`client` is `null`, or the channel errors, times out or closes) it polls instead:
 * `onPollList` every 10 s and `onPollThread` every 3 s for the open conversation, paused while
 * `document.hidden`.
 */
export function useSendoRealtime({
  client,
  tenantId,
  conversationId = null,
  onConversation,
  onMessage,
  onPollList,
  onPollThread,
}: UseSendoRealtimeOptions): void {
  const handlers = useRef({ onConversation, onMessage, onPollList, onPollThread });
  useEffect(() => {
    handlers.current = { onConversation, onMessage, onPollList, onPollThread };
  }, [onConversation, onMessage, onPollList, onPollThread]);
  const [downClient, setDownClient] = useState<SupabaseClient | null>(null);
  const polling = client === null || downClient === client;

  const hasListPoll = onPollList !== undefined;
  const hasThreadPoll = onPollThread !== undefined;
  useVisibleInterval(
    polling && hasListPoll ? () => handlers.current.onPollList?.() : null,
    POLL_LIST_MS,
  );
  useVisibleInterval(
    polling && hasThreadPoll && conversationId !== null
      ? () => handlers.current.onPollThread?.(conversationId)
      : null,
    POLL_THREAD_MS,
  );

  useEffect(() => {
    if (client === null) return;
    let active = true;
    const tenantFilter = tenantId === null ? undefined : `tenant_id=eq.${tenantId}`;
    const messageFilter =
      conversationId === null ? tenantFilter : `conversation_id=eq.${conversationId}`;
    const channel = client
      .channel(`sendo-inbox:${tenantId ?? "default"}:${conversationId ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sendo_conversations", filter: tenantFilter },
        (payload: RealtimePostgresChangesPayload<SendoConversationRow>) => {
          const change = changeOf(payload.eventType);
          if (change === null || !("id" in payload.new)) return;
          handlers.current.onConversation(payload.new, change);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sendo_messages", filter: messageFilter },
        (payload: RealtimePostgresChangesPayload<SendoMessageRow>) => {
          const change = changeOf(payload.eventType);
          if (change === null || !("id" in payload.new)) return;
          // Status placeholders have no conversation and are never shown.
          if (payload.new.conversation_id === null) return;
          handlers.current.onMessage(payload.new, change);
        },
      )
      .subscribe((status) => {
        // Our own cleanup closes the channel too; only a live subscription's state counts.
        if (!active) return;
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED)
          setDownClient((down) => (down === client ? null : down));
        else if (DOWN_STATES.has(status)) setDownClient(client);
      });
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, tenantId, conversationId]);
}
