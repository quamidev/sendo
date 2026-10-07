"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MessagesSquareIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useWhatsAppRealtime,
  type WaConversationRow,
  type WaMessageRow,
} from "@/hooks/use-whatsapp-realtime";
import { cn } from "@/lib/utils";
import { Composer, type ComposerSendResult } from "./composer";
import { ConversationList } from "./conversation-list";
import { InboxStringsContext, mergeStrings, type InboxStrings } from "./strings";
import { Thread, type ConversationAction, type ThreadMessage } from "./thread";
import type {
  InboxActions,
  InboxConversationPatch,
  InboxConversationView,
  InboxFilter,
  InboxMessageView,
  InboxReplyInput,
} from "./types";
import { mediaTypeForFile } from "./types";
import { DEFAULT_INBOX_TIME_ZONE } from "./utils";

export interface InboxProps {
  /** Overrides for any user-visible string (Spanish by default). */
  strings?: Partial<InboxStrings>;
  /** The signed-in operator (`senderRef` of their replies, "Asignadas a mí"). */
  currentUserId: string;
  /** The operator's tenant; `null` for single-tenant apps. Used by the realtime filters. */
  tenantId: string | null;
  /** Browser Supabase client for live updates, or `null` to disable realtime. */
  realtimeClient: SupabaseClient | null;
  actions: InboxActions;
  /** First page of the initial filter, loaded by the server page. */
  initialConversations?: InboxConversationView[];
  initialNextCursor?: string | null;
  initialFilter?: InboxFilter;
  /** IANA timezone for message times. Default `America/Guatemala`. */
  timeZone?: string;
  className?: string;
}

interface ThreadState {
  conversationId: string;
  /** Oldest first. */
  messages: ThreadMessage[];
  /** Ids loaded as history; everything else was appended while open and plays the enter motion. */
  historyKeys: ReadonlySet<string>;
  nextCursor: string | null;
  loading: boolean;
  loadingOlder: boolean;
}

const OPTIMISTIC_PREFIX = "optimistic:";
const REFRESH_DEBOUNCE_MS = 250;
/** After this the enter class is dropped, so a row hidden and shown again (mobile) doesn't replay it. */
const ENTER_CLEANUP_MS = 600;
const NO_IDS: ReadonlySet<string> = new Set();

function byCreatedAt(a: InboxMessageView, b: InboxMessageView): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

/** Union by id (incoming wins, keeping the React key of the message it replaces), oldest first. */
function mergeMessages(current: ThreadMessage[], incoming: ThreadMessage[]): ThreadMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const clientKey = message.clientKey ?? byId.get(message.id)?.clientKey;
    byId.set(message.id, clientKey === undefined ? message : { ...message, clientKey });
  }
  return [...byId.values()].sort(byCreatedAt);
}

function matchesFilter(
  conversation: Pick<InboxConversationView, "status" | "assignedTo">,
  filter: InboxFilter,
  assignedToMe: boolean,
  currentUserId: string,
): boolean {
  if (filter !== "all" && conversation.status !== filter) return false;
  return !assignedToMe || conversation.assignedTo === currentUserId;
}

function patchFromRow(row: WaConversationRow): InboxConversationPatch &
  Pick<InboxConversationView, "lastInboundAt"> & {
    windowExpiresAt: string | null;
  } {
  return {
    id: row.id,
    status: row.status,
    assignedTo: row.assigned_to,
    handoffReason: row.handoff_reason,
    unreadCount: row.unread_count,
    lastActivityAt: row.last_activity_at,
    lastInboundAt: row.last_inbound_at,
    windowExpiresAt: row.window_expires_at,
  };
}

function applyPatch(
  conversation: InboxConversationView,
  patch: InboxConversationPatch & {
    windowExpiresAt?: string | null;
    lastInboundAt?: string | null;
  },
): InboxConversationView {
  const { windowExpiresAt, ...fields } = patch;
  const next: InboxConversationView = { ...conversation, ...fields };
  if (windowExpiresAt !== undefined) {
    next.window = {
      open: windowExpiresAt !== null && new Date(windowExpiresAt).getTime() > Date.now(),
      expiresAt: windowExpiresAt,
    };
  }
  return next;
}

/** Operator inbox: conversation list, thread, composer and take / return / close actions. */
export function Inbox({
  strings: overrides,
  currentUserId,
  tenantId,
  realtimeClient,
  actions,
  initialConversations,
  initialNextCursor = null,
  initialFilter = "human",
  timeZone = DEFAULT_INBOX_TIME_ZONE,
  className,
}: InboxProps) {
  const strings = useMemo(() => mergeStrings(overrides), [overrides]);
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [conversations, setConversations] = useState<InboxConversationView[]>(
    initialConversations ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [listLoading, setListLoading] = useState(initialConversations === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<InboxConversationView | null>(null);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [scrollKey, setScrollKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<ConversationAction | null>(null);
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(NO_IDS);

  // Latest values for async callbacks (responses for a conversation that is no longer open are dropped).
  const selectedId = useRef<string | null>(null);
  const listQuery = useRef({ filter, assignedToMe });
  const optimisticSeq = useRef(0);
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listedIds = useRef<ReadonlySet<string>>(NO_IDS);

  useEffect(() => {
    listedIds.current = new Set(conversations.map((item) => item.id));
  }, [conversations]);

  useEffect(() => {
    if (enteringIds.size === 0) return;
    const timer = setTimeout(() => {
      setEnteringIds(NO_IDS);
    }, ENTER_CLEANUP_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [enteringIds]);

  const fail = useCallback((message: string, description?: string) => {
    toast.error(message, description === undefined ? undefined : { description });
  }, []);

  const loadList = useCallback(
    async (
      query: { filter: InboxFilter; assignedToMe: boolean },
      opts: { silent?: boolean } = {},
    ) => {
      listQuery.current = query;
      if (opts.silent !== true) setListLoading(true);
      const result = await actions.list({ ...query, cursor: null });
      if (listQuery.current !== query) return;
      setListLoading(false);
      if (!result.ok) {
        if (opts.silent !== true) fail(strings.loadFailed, result.message);
        return;
      }
      // Only rows that arrive in the background (realtime refresh) play the enter motion.
      const arrived =
        opts.silent === true
          ? result.data.items.filter((item) => !listedIds.current.has(item.id))
          : [];
      if (arrived.length > 0) setEnteringIds(new Set(arrived.map((item) => item.id)));
      else if (opts.silent !== true) setEnteringIds(NO_IDS);
      setConversations(result.data.items);
      setNextCursor(result.data.nextCursor);
    },
    [actions, fail, strings.loadFailed],
  );

  // Without server-loaded conversations, the first page is fetched once on mount.
  useEffect(() => {
    if (initialConversations !== undefined) return;
    const query = listQuery.current;
    void actions.list({ ...query, cursor: null }).then((result) => {
      if (listQuery.current !== query) return;
      setListLoading(false);
      if (!result.ok) {
        fail(strings.loadFailed, result.message);
        return;
      }
      setConversations(result.data.items);
      setNextCursor(result.data.nextCursor);
    });
  }, [actions, fail, initialConversations, strings.loadFailed]);

  useEffect(
    () => () => {
      if (listTimer.current !== null) clearTimeout(listTimer.current);
      if (threadTimer.current !== null) clearTimeout(threadTimer.current);
    },
    [],
  );

  function changeFilter(next: InboxFilter) {
    setFilter(next);
    void loadList({ filter: next, assignedToMe });
  }

  function changeAssignedToMe(next: boolean) {
    setAssignedToMe(next);
    void loadList({ filter, assignedToMe: next });
  }

  async function loadMore() {
    if (nextCursor === null || loadingMore) return;
    const query = listQuery.current;
    setLoadingMore(true);
    const result = await actions.list({ ...query, cursor: nextCursor });
    setLoadingMore(false);
    if (listQuery.current !== query) return;
    if (!result.ok) {
      fail(strings.loadFailed, result.message);
      return;
    }
    setConversations((current) => {
      const known = new Set(current.map((item) => item.id));
      return [...current, ...result.data.items.filter((item) => !known.has(item.id))];
    });
    setNextCursor(result.data.nextCursor);
  }

  const patchConversation = useCallback(
    (patch: Parameters<typeof applyPatch>[1]) => {
      setConversations((current) => {
        const query = listQuery.current;
        return current
          .map((item) => (item.id === patch.id ? applyPatch(item, patch) : item))
          .filter(
            (item) =>
              item.id !== patch.id ||
              item.id === selectedId.current ||
              matchesFilter(item, query.filter, query.assignedToMe, currentUserId),
          );
      });
      setSelected((current) =>
        current !== null && current.id === patch.id ? applyPatch(current, patch) : current,
      );
    },
    [currentUserId],
  );

  const refreshThread = useCallback(
    async (conversationId: string) => {
      const result = await actions.thread(conversationId);
      if (!result.ok || selectedId.current !== conversationId) return;
      const latest = [...result.data.items].reverse();
      setThread((current) =>
        current === null || current.conversationId !== conversationId
          ? current
          : {
              ...current,
              messages: mergeMessages(
                current.messages.filter((message) => !message.id.startsWith(OPTIMISTIC_PREFIX)),
                latest,
              ).concat(
                current.messages.filter((message) => message.id.startsWith(OPTIMISTIC_PREFIX)),
              ),
            },
      );
    },
    [actions],
  );

  async function openConversation(id: string) {
    const conversation = conversations.find((item) => item.id === id) ?? null;
    if (conversation === null || selectedId.current === id) return;
    selectedId.current = id;
    setSelected({ ...conversation, unreadCount: 0 });
    setThread({
      conversationId: id,
      messages: [],
      historyKeys: NO_IDS,
      nextCursor: null,
      loading: true,
      loadingOlder: false,
    });
    if (conversation.unreadCount > 0) {
      setConversations((current) =>
        current.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)),
      );
    }

    const result = await actions.thread(id);
    if (selectedId.current !== id) return;
    if (!result.ok) {
      setThread((current) => (current === null ? current : { ...current, loading: false }));
      fail(strings.loadFailed, result.message);
      return;
    }
    setThread({
      conversationId: id,
      messages: [...result.data.items].reverse(),
      historyKeys: new Set(result.data.items.map((message) => message.id)),
      nextCursor: result.data.nextCursor,
      loading: false,
      loadingOlder: false,
    });
    setScrollKey((key) => key + 1);
    void actions.markSeen(id);
  }

  function closeConversation() {
    selectedId.current = null;
    setSelected(null);
    setThread(null);
  }

  async function loadOlder() {
    if (thread === null || thread.nextCursor === null || thread.loadingOlder) return;
    const { conversationId, nextCursor: cursor } = thread;
    setThread({ ...thread, loadingOlder: true });
    const result = await actions.thread(conversationId, cursor);
    if (selectedId.current !== conversationId) return;
    if (!result.ok) {
      setThread((current) => (current === null ? current : { ...current, loadingOlder: false }));
      fail(strings.loadFailed, result.message);
      return;
    }
    const older = [...result.data.items].reverse();
    setThread((current) =>
      current === null
        ? current
        : {
            ...current,
            messages: mergeMessages(current.messages, older),
            historyKeys: new Set([...current.historyKeys, ...older.map((message) => message.id)]),
            nextCursor: result.data.nextCursor,
            loadingOlder: false,
          },
    );
  }

  async function runAction(action: ConversationAction) {
    if (selected === null || pendingAction !== null) return;
    const id = selected.id;
    setPendingAction(action);
    const result = await actions[action](id);
    setPendingAction(null);
    if (!result.ok) {
      fail(strings.actionFailed, result.message);
      return;
    }
    patchConversation(result.data);
  }

  async function send(input: InboxReplyInput): Promise<ComposerSendResult> {
    if (selected === null) return "failed";
    const conversationId = selected.id;
    optimisticSeq.current += 1;
    const optimisticId = `${OPTIMISTIC_PREFIX}${String(optimisticSeq.current)}`;
    const now = new Date().toISOString();
    const objectUrl =
      input.kind === "media" && input.file.type.startsWith("image/")
        ? URL.createObjectURL(input.file)
        : null;
    const optimistic: InboxMessageView = {
      id: optimisticId,
      conversationId,
      direction: "out",
      type: input.kind === "media" ? mediaTypeForFile(input.file.type) : input.kind,
      text:
        input.kind === "text"
          ? input.body
          : input.kind === "media"
            ? (input.caption ?? null)
            : input.name,
      content: {},
      sender: "human",
      senderRef: currentUserId,
      status: "pending",
      error: null,
      sentAt: null,
      createdAt: now,
      replyToMetaId: null,
      metaMessageId: null,
      ...(input.kind === "media"
        ? {
            media: {
              url: objectUrl,
              mimeType: input.file.type,
              sizeBytes: input.file.size,
              downloadStatus: objectUrl === null ? "pending" : "done",
              filename: input.file.name,
            },
          }
        : {}),
    };
    setThread((current) =>
      current === null || current.conversationId !== conversationId
        ? current
        : { ...current, messages: [...current.messages, optimistic] },
    );
    setScrollKey((key) => key + 1);

    const result = await actions.reply(conversationId, input);
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    setThread((current) => {
      if (current === null || current.conversationId !== conversationId) return current;
      const rest = current.messages.filter((message) => message.id !== optimisticId);
      return {
        ...current,
        messages: result.ok
          ? mergeMessages(rest, [{ ...result.data, clientKey: optimisticId }])
          : rest,
      };
    });
    if (result.ok) {
      patchConversation({
        id: conversationId,
        status: selected.status,
        assignedTo: selected.assignedTo,
        handoffReason: selected.handoffReason,
        unreadCount: 0,
        lastActivityAt: result.data.createdAt,
      });
      return "sent";
    }
    if (result.code === "WINDOW_CLOSED") {
      patchConversation({ ...selected, unreadCount: 0, windowExpiresAt: now });
      return "window_closed";
    }
    fail(strings.sendFailed, result.message);
    void refreshThread(conversationId);
    return "failed";
  }

  const listTemplates = useCallback(() => {
    const id = selectedId.current;
    if (id === null) return Promise.resolve({ ok: true as const, data: [] });
    return actions.listTemplates(id);
  }, [actions]);

  // Realtime: patch what we can right away, then refetch to pick up previews and media URLs.
  const onConversation = useCallback(
    (row: WaConversationRow) => {
      patchConversation(patchFromRow(row));
      if (listTimer.current !== null) clearTimeout(listTimer.current);
      listTimer.current = setTimeout(() => {
        void loadList(listQuery.current, { silent: true });
      }, REFRESH_DEBOUNCE_MS);
    },
    [loadList, patchConversation],
  );

  const onMessage = useCallback(
    (row: WaMessageRow) => {
      const conversationId = row.conversation_id;
      if (conversationId === null || conversationId !== selectedId.current) return;
      setThread((current) => {
        if (current === null || current.conversationId !== conversationId) return current;
        return {
          ...current,
          messages: current.messages.map((message) =>
            message.id === row.id
              ? {
                  ...message,
                  status: row.status,
                  error: row.error,
                  sentAt: row.sent_at,
                  metaMessageId: row.meta_message_id,
                }
              : message,
          ),
        };
      });
      if (threadTimer.current !== null) clearTimeout(threadTimer.current);
      threadTimer.current = setTimeout(() => {
        void refreshThread(conversationId);
        if (row.direction === "in") void actions.markSeen(conversationId);
      }, REFRESH_DEBOUNCE_MS);
    },
    [actions, refreshThread],
  );

  useWhatsAppRealtime({
    client: realtimeClient,
    tenantId,
    conversationId: selected?.id ?? null,
    onConversation,
    onMessage,
  });

  const threadOpen = selected !== null && thread !== null;

  return (
    <InboxStringsContext value={strings}>
      <TooltipProvider delayDuration={300}>
        <div className={cn("flex h-full min-h-0 w-full overflow-hidden bg-background", className)}>
          <ConversationList
            className={cn(
              "w-full md:w-80 md:shrink-0 md:border-r lg:w-96",
              threadOpen && "hidden md:flex",
            )}
            conversations={conversations}
            selectedId={selected?.id ?? null}
            enteringIds={enteringIds}
            onSelect={(id) => {
              void openConversation(id);
            }}
            filter={filter}
            onFilterChange={changeFilter}
            assignedToMe={assignedToMe}
            onAssignedToMeChange={changeAssignedToMe}
            loading={listLoading}
            hasMore={nextCursor !== null}
            loadingMore={loadingMore}
            onLoadMore={() => {
              void loadMore();
            }}
          />
          {threadOpen ? (
            <Thread
              key={selected.id}
              className="min-w-0 flex-1"
              conversation={selected}
              messages={thread.messages}
              historyKeys={thread.historyKeys}
              currentUserId={currentUserId}
              loading={thread.loading}
              hasOlder={thread.nextCursor !== null}
              loadingOlder={thread.loadingOlder}
              onLoadOlder={() => {
                void loadOlder();
              }}
              scrollToBottomKey={scrollKey}
              onBack={closeConversation}
              onAction={(action) => {
                void runAction(action);
              }}
              pendingAction={pendingAction}
              timeZone={timeZone}
              composer={
                <Composer
                  key={selected.id}
                  window={selected.window}
                  onSend={send}
                  listTemplates={listTemplates}
                  disabled={thread.loading}
                />
              }
            />
          ) : (
            <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-muted/30 p-8 text-center md:flex">
              <MessagesSquareIcon className="size-8 text-muted-foreground" aria-hidden />
              <p className="max-w-xs text-sm text-pretty text-muted-foreground">
                {strings.selectConversation}
              </p>
            </div>
          )}
        </div>
      </TooltipProvider>
    </InboxStringsContext>
  );
}
