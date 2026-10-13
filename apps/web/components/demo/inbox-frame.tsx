"use client";

import { useEffect, useMemo, useState } from "react";
import { SendoInbox } from "@/components/sendo/sendo-inbox";
import {
  INBOX_TABS,
  matchesTab,
  type InboxActionResult,
  type InboxActions,
  type InboxConversationView,
  type InboxListInput,
  type InboxMessageView,
  type InboxNumberView,
  type InboxTabCounts,
} from "@/components/sendo/types";
import { Toaster } from "@/components/ui/sonner";
import { demo as demoDictionary } from "@/lib/i18n/dictionaries/demo";
import type { Lang } from "@/lib/i18n/langs";
import {
  DEMO_ACCOUNT_ID,
  DEMO_AGENT_NAME,
  DEMO_CONVERSATION_ID,
  DEMO_OPERATOR_ID,
  DEMO_TENANT_ID,
  type DemoInboxSnapshot,
  type InboxSnapshot,
} from "@/lib/demo/protocol";
import { emitDemoChange } from "./demo-realtime";
import { isHostMessage, type FrameToHost, type HostToFrame } from "./frame-protocol";

// The demo inbox: the real `inbox` component, its actions answered from data the
// server computed with `sendo.inbox` over the memory adapter (fixtures) plus the visitor's
// demo conversation, which the host page sends after every turn.

interface FrameState {
  fixtures: InboxSnapshot;
  demo: DemoInboxSnapshot | null;
  /** Fixture conversations marked seen in this visit. */
  seen: Set<string>;
  /** Inbound messages of the demo conversation when it was last marked seen. */
  demoSeenInbound: number;
}

function inboundCount(thread: InboxMessageView[]): number {
  return thread.filter((message) => message.direction === "in").length;
}

function ok<T>(data: T): Promise<InboxActionResult<T>> {
  return Promise.resolve({ ok: true, data });
}

function readOnly<T>(message: string): Promise<InboxActionResult<T>> {
  return Promise.resolve({ ok: false, code: "INVALID", message });
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function allConversations(state: FrameState): InboxConversationView[] {
  const items = state.fixtures.conversations.map((item) =>
    state.seen.has(item.id) ? { ...item, unreadCount: 0 } : item,
  );
  if (state.demo !== null) {
    const unreadCount = Math.max(0, inboundCount(state.demo.thread) - state.demoSeenInbound);
    items.push({ ...state.demo.conversation, unreadCount });
  }
  return items.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

function matchesFilters(item: InboxConversationView, input: InboxListInput): boolean {
  if (input.accountId != null && item.accountId !== input.accountId) return false;
  const tagIds = input.tagIds ?? [];
  if (tagIds.length > 0 && !item.tags.some((tag) => tagIds.includes(tag.id))) return false;
  const search = normalize(input.search?.trim() ?? "");
  if (search === "") return true;
  return [item.contact.displayName, item.contact.appRef ?? "", item.contact.phone ?? ""].some(
    (field) => normalize(field).includes(search),
  );
}

function threadOf(state: FrameState, id: string): InboxMessageView[] {
  if (id === DEMO_CONVERSATION_ID) return state.demo?.thread ?? [];
  return state.fixtures.threads[id] ?? [];
}

function createActions(
  state: { current: FrameState },
  teamReply: (text: string) => Promise<InboxActionResult<InboxMessageView>>,
  readOnlyMessage: string,
): InboxActions {
  const denied = <T,>() => readOnly<T>(readOnlyMessage);
  return {
    list(input) {
      const candidates = allConversations(state.current).filter((item) =>
        matchesFilters(item, input),
      );
      const counts = Object.fromEntries(
        INBOX_TABS.map((tab) => [
          tab,
          candidates.filter((item) => matchesTab(item, tab, DEMO_OPERATOR_ID)).length,
        ]),
      ) as InboxTabCounts;
      const items = candidates.filter((item) => matchesTab(item, input.tab, DEMO_OPERATOR_ID));
      return ok({ items, nextCursor: null, counts: input.cursor == null ? counts : null });
    },
    thread(conversationId) {
      const names = { ...state.current.fixtures.names, ...state.current.demo?.names };
      return ok({
        items: [...threadOf(state.current, conversationId)].reverse(),
        nextCursor: null,
        names,
      });
    },
    markSeen(conversationId) {
      if (conversationId === DEMO_CONVERSATION_ID) {
        state.current.demoSeenInbound = inboundCount(state.current.demo?.thread ?? []);
      } else {
        state.current.seen.add(conversationId);
      }
      return ok(null);
    },
    reply(conversationId, input) {
      if (conversationId !== DEMO_CONVERSATION_ID || input.kind !== "text") return denied();
      return teamReply(input.body);
    },
    take: () => denied(),
    assign: () => denied(),
    returnToAgent: () => denied(),
    close: () => denied(),
    pauseAgent: () => denied(),
    approveDraft: () => denied(),
    discardDraft: () => denied(),
    addTag: () => denied(),
    removeTag: () => denied(),
    listAssignees: () =>
      ok(
        Object.entries(state.current.fixtures.names).map(([id, name]) => ({
          id,
          name,
          avatarUrl: null,
        })),
      ),
    listTags: () => ok(state.current.fixtures.tags),
    listTemplates: () => ok([]),
  };
}

/** Tells the inbox the demo conversation changed, the way Supabase Realtime would. */
function announce(snapshot: DemoInboxSnapshot, inserted: boolean): void {
  const { conversation, thread } = snapshot;
  emitDemoChange(
    "sendo_conversations",
    {
      id: conversation.id,
      tenant_id: conversation.tenantId,
      account_id: conversation.accountId,
      contact_id: conversation.contact.id,
      status: conversation.status,
      assigned_to: conversation.assignedTo,
      handoff_reason: conversation.handoffReason,
      last_inbound_at: conversation.lastInboundAt,
      last_activity_at: conversation.lastActivityAt,
      window_expires_at: conversation.window.expiresAt,
      unread_count: conversation.unreadCount,
      created_at: conversation.lastActivityAt,
      agent_paused: conversation.agentPaused,
      queue: conversation.queue,
      source: conversation.source,
    },
    inserted ? "INSERT" : "UPDATE",
  );
  // The newest message, then the newest inbound one (the inbox marks it seen when it is open).
  const last = thread.at(-1);
  const lastInbound = thread.findLast((message) => message.direction === "in");
  for (const message of new Set([last, lastInbound])) {
    if (message === undefined) continue;
    emitDemoChange(
      "sendo_messages",
      {
        id: message.id,
        tenant_id: DEMO_TENANT_ID,
        conversation_id: conversation.id,
        direction: message.direction,
        type: message.type,
        text: message.text,
        meta_message_id: message.metaMessageId,
        status: message.status,
        error: message.error,
        sender: message.sender,
        sender_ref: message.senderRef,
        sent_at: message.sentAt,
        created_at: message.createdAt,
        internal: message.internal,
        draft: message.draft,
      },
      "INSERT",
    );
  }
}

/**
 * The frame's mutable side, outside React: the inbox reads it through its actions (and refetches
 * when the realtime stand-in says the demo conversation changed).
 */
function createFrameStore(fixtures: InboxSnapshot, readOnlyMessage: string) {
  const state = {
    current: { fixtures, demo: null, seen: new Set(), demoSeenInbound: 0 } as FrameState,
  };
  const pending = new Map<number, (result: InboxActionResult<InboxMessageView>) => void>();
  let sequence = 0;

  const actions = createActions(
    state,
    (text) => {
      if (window.parent === window) return readOnly(readOnlyMessage);
      sequence += 1;
      const id = sequence;
      const message: FrameToHost = { source: "sendo-demo-frame", type: "team-reply", id, text };
      window.parent.postMessage(message, window.location.origin);
      return new Promise((resolve) => {
        pending.set(id, resolve);
      });
    },
    readOnlyMessage,
  );

  /** Handles messages from the host page; returns `true` once a snapshot arrived. */
  function receive(data: HostToFrame): boolean {
    if (data.type === "snapshot") {
      const inserted = state.current.demo === null;
      state.current.demo = data.snapshot;
      if (data.snapshot !== null) announce(data.snapshot, inserted);
      return true;
    }
    const resolve = pending.get(data.id);
    pending.delete(data.id);
    resolve?.(
      data.result.ok
        ? { ok: true, data: data.result.message }
        : { ok: false, code: "UNKNOWN", message: data.result.message },
    );
    return false;
  }

  return { actions, receive };
}

/**
 * The inbox inside `/demo/inbox?lang=…`. The frame's root layout can't read the query string, so
 * this sets the document language (and `lang` on its `<main>` for the server-rendered HTML).
 */
export function InboxFrame({ lang, fixtures }: { lang: Lang; fixtures: InboxSnapshot }) {
  const t = demoDictionary[lang];
  const [store] = useState(() => createFrameStore(fixtures, t.inbox.readOnly));
  const numbers = useMemo<InboxNumberView[]>(
    () => [
      {
        id: DEMO_ACCOUNT_ID,
        label: t.world.numberLabel,
        displayPhone: "+502 2200 7777",
        active: true,
      },
    ],
    [t],
  );
  const agentNames = useMemo(() => ({ [DEMO_AGENT_NAME]: t.world.agentName }), [t]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    // The host may hydrate after this frame: say "ready" until it answers with a snapshot.
    let answered = false;
    let tries = 0;
    const ready: FrameToHost = { source: "sendo-demo-frame", type: "ready" };
    const announceReady = () => {
      if (answered || window.parent === window || tries >= 40) return;
      tries += 1;
      window.parent.postMessage(ready, window.location.origin);
    };
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data: unknown = event.data;
      if (isHostMessage(data) && store.receive(data)) answered = true;
    }
    window.addEventListener("message", receive);
    announceReady();
    const timer = setInterval(announceReady, 250);
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", receive);
    };
  }, [store]);

  const initialPage = useMemo(() => {
    const items = allConversations({ fixtures, demo: null, seen: new Set(), demoSeenInbound: 0 });
    const counts = Object.fromEntries(
      INBOX_TABS.map((tab) => [
        tab,
        items.filter((item) => matchesTab(item, tab, DEMO_OPERATOR_ID)).length,
      ]),
    ) as InboxTabCounts;
    return {
      items: items.filter((item) => matchesTab(item, "open", DEMO_OPERATOR_ID)),
      nextCursor: null,
      counts,
    };
  }, [fixtures]);

  return (
    <main lang={lang} className="h-dvh">
      <SendoInbox
        locale={lang}
        realtime
        currentUser={{ id: DEMO_OPERATOR_ID, name: null }}
        tenantId={DEMO_TENANT_ID}
        actions={store.actions}
        permissions={{
          reassign: false,
          pauseAgent: false,
          viewCosts: true,
          manageSnippets: false,
          manageTags: false,
        }}
        numbers={numbers}
        tags={fixtures.tags}
        agentNames={agentNames}
        initialPage={initialPage}
        initialTab="open"
      />
      <Toaster position="top-center" />
    </main>
  );
}
