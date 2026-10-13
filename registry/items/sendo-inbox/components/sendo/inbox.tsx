"use client";

import type { InboxConversationCost } from "@quami/sendo";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MessagesSquareIcon, UnplugIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useSendoRealtime,
  type SendoConversationRow,
  type SendoMessageRow,
} from "@/hooks/use-sendo-realtime";
import { cn } from "@/lib/utils";
import { InboxAccessDenied } from "./access-denied";
import { AssignMenu } from "./assign-menu";
import { Composer, type ComposerSendResult } from "./composer";
import { ContextPanel } from "./context-panel";
import { ConversationList } from "./conversation-list";
import type { DraftActionResult } from "./draft-card";
import { InboxRail } from "./inbox-rail";
import { MotionSheet } from "./motion-sheet";
import { InboxPeopleContext, type InboxPeople } from "./people";
import { SnippetsManager, type SnippetsManagerActions } from "./snippets-manager";
import { InboxStringsContext, mergeStrings, type InboxStrings } from "./strings";
import { TagPicker } from "./tag-picker";
import { TagsManager, type TagsManagerActions } from "./tags-manager";
import { Thread, type ConversationAction, type ThreadMessage } from "./thread";
import { sidePanelMotionClass } from "./transitions";
import {
  matchesTab,
  mediaTypeForFile,
  NO_NAV_LINKS,
  NO_PERMISSIONS,
  type InboxActionResult,
  type InboxActions,
  type InboxConversationView,
  type InboxCurrentUser,
  type InboxListPage,
  type InboxMessageView,
  type InboxNavLinks,
  type InboxNumberView,
  type InboxPermissions,
  type InboxReplyInput,
  type InboxTab,
  type InboxTabCounts,
  type InboxTagView,
} from "./types";
import { DEFAULT_INBOX_TIME_ZONE, useIsDesktop, useMediaQuery, WIDE_QUERY } from "./utils";

export interface InboxProps {
  /** Overrides for any user-visible string (Spanish by default). */
  strings?: Partial<InboxStrings>;
  /** The signed-in operator (`senderRef` of their replies, "Asignadas a mí"). */
  currentUser: InboxCurrentUser;
  /** The operator's tenant; `null` for single-tenant apps. Used by the realtime filters. */
  tenantId: string | null;
  /** Browser Supabase client for live updates, or `null` to disable realtime. */
  realtimeClient: SupabaseClient | null;
  actions: InboxActions;
  /** What the operator's role allows (computed on the server with `can()`). */
  permissions?: InboxPermissions;
  /** The tenant's numbers (selector, context panel). */
  numbers?: InboxNumberView[];
  /** The tenant's tag catalog; loaded with `listTags` when omitted. */
  tags?: InboxTagView[];
  /** Rail links to the other installed Sendo screens. */
  nav?: InboxNavLinks;
  /** Agent name → display name (`recepcion` → "Recepción IA"). */
  agentNames?: Record<string, string>;
  /** First page of `initialTab`, loaded by the server page. */
  initialPage?: InboxListPage;
  initialTab?: InboxTab;
  /** IANA timezone for message times. Default `America/Guatemala`. */
  timeZone?: string;
  className?: string;
}

interface ThreadState {
  conversationId: string;
  /** Oldest first, drafts included. */
  messages: ThreadMessage[];
  /** Ids loaded as history; everything else was appended while open and plays the enter motion. */
  historyKeys: ReadonlySet<string>;
  nextCursor: string | null;
  loading: boolean;
  loadingOlder: boolean;
  /** Whole-conversation agent cost from the latest page (admins); `null` totals loaded pages. */
  cost: InboxConversationCost | null;
}

interface ListQuery {
  tab: InboxTab;
  accountId: string | null;
  tagIds: string[];
  search: string;
}

const OPTIMISTIC_PREFIX = "optimistic:";
const REFRESH_DEBOUNCE_MS = 250;
const SEARCH_DEBOUNCE_MS = 300;
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

/** What a realtime `sendo_conversations` row tells us without a refetch. */
function applyRow(
  conversation: InboxConversationView,
  row: SendoConversationRow,
): InboxConversationView {
  const expiresAt = row.window_expires_at;
  const agentPaused = row.agent_paused ?? conversation.agentPaused;
  return {
    ...conversation,
    status: row.status,
    assignedTo: row.assigned_to,
    assignee:
      row.assigned_to === null
        ? null
        : conversation.assignee?.id === row.assigned_to
          ? conversation.assignee
          : { id: row.assigned_to, name: null, avatarUrl: null },
    handoffReason: row.handoff_reason,
    handoff: row.status === "human" ? conversation.handoff : null,
    unreadCount: row.unread_count,
    lastActivityAt: row.last_activity_at,
    lastInboundAt: row.last_inbound_at,
    window: {
      open: expiresAt !== null && new Date(expiresAt).getTime() > Date.now(),
      expiresAt,
    },
    agentPaused: agentPaused || conversation.agentPausedOn === "account",
    agentPausedOn: agentPaused
      ? "conversation"
      : conversation.agentPausedOn === "account"
        ? "account"
        : null,
    queue: row.queue === undefined ? conversation.queue : row.queue,
    source: row.source === undefined ? conversation.source : row.source,
  };
}

/** The snippets manager needs the three snippet actions (everyone manages personal snippets). */
function snippetsManagerActions(actions: InboxActions): SnippetsManagerActions | null {
  if (
    actions.listSnippets === undefined ||
    actions.upsertSnippet === undefined ||
    actions.deleteSnippet === undefined
  ) {
    return null;
  }
  return {
    listSnippets: actions.listSnippets.bind(actions),
    upsertSnippet: actions.upsertSnippet.bind(actions),
    deleteSnippet: actions.deleteSnippet.bind(actions),
  };
}

function tagsManagerActions(actions: InboxActions): TagsManagerActions | null {
  if (
    actions.upsertTag === undefined ||
    actions.deleteTag === undefined ||
    actions.tagUsage === undefined
  ) {
    return null;
  }
  return {
    upsertTag: actions.upsertTag.bind(actions),
    deleteTag: actions.deleteTag.bind(actions),
    tagUsage: actions.tagUsage.bind(actions),
  };
}

/**
 * The team inbox (mockup option A): icon rail, conversation list, thread and the 300 px context
 * panel. Below 1180 px the panel opens from the thread header (side panel on tablets, a sheet on
 * phones); on phones the list and the thread alternate.
 */
export function Inbox({
  strings: overrides,
  currentUser,
  tenantId,
  realtimeClient,
  actions,
  permissions = NO_PERMISSIONS,
  numbers = [],
  tags: initialTags,
  nav = NO_NAV_LINKS,
  agentNames,
  initialPage,
  initialTab = "open",
  timeZone = DEFAULT_INBOX_TIME_ZONE,
  className,
}: InboxProps) {
  const strings = useMemo(() => mergeStrings(overrides), [overrides]);
  const isDesktop = useIsDesktop();
  const isWide = useMediaQuery(WIDE_QUERY);
  const [query, setQuery] = useState<ListQuery>({
    tab: initialTab,
    accountId: null,
    tagIds: [],
    search: "",
  });
  const [searchInput, setSearchInput] = useState("");
  const [conversations, setConversations] = useState<InboxConversationView[]>(
    initialPage?.items ?? [],
  );
  const [counts, setCounts] = useState<InboxTabCounts | null>(initialPage?.counts ?? null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage?.nextCursor ?? null);
  const [listLoading, setListLoading] = useState(initialPage === undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [denied, setDenied] = useState(false);
  const [catalog, setCatalog] = useState<InboxTagView[]>(initialTags ?? []);
  const [selected, setSelected] = useState<InboxConversationView | null>(null);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [scrollKey, setScrollKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<ConversationAction | null>(null);
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(NO_IDS);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  // Latest values for async callbacks (responses for a conversation that is no longer open are dropped).
  const selectedId = useRef<string | null>(null);
  const listQuery = useRef<ListQuery>(query);
  const optimisticSeq = useRef(0);
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listedIds = useRef<ReadonlySet<string>>(NO_IDS);
  /** Polling: newest inbound message id per conversation already marked seen. */
  const seenInbound = useRef(new Map<string, string | null>());
  /** Approved drafts wait here until their card finished leaving. */
  const approved = useRef(new Map<string, InboxMessageView>());
  const currentUserId = currentUser.id;

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

  const learnNames = useCallback((incoming: Record<string, string>) => {
    if (Object.keys(incoming).length === 0) return;
    setNames((current) => ({ ...current, ...incoming }));
  }, []);

  const loadList = useCallback(
    async (next: ListQuery, opts: { silent?: boolean } = {}) => {
      listQuery.current = next;
      if (opts.silent !== true) setListLoading(true);
      const result = await actions.list({ ...next, cursor: null });
      if (listQuery.current !== next) return;
      setListLoading(false);
      if (!result.ok) {
        if (result.code === "FORBIDDEN") setDenied(true);
        else if (opts.silent !== true) fail(strings.loadFailed, result.message);
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
      if (result.data.counts !== null) setCounts(result.data.counts);
    },
    [actions, fail, strings.loadFailed],
  );

  const scheduleListRefresh = useCallback(() => {
    if (listTimer.current !== null) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => {
      void loadList(listQuery.current, { silent: true });
    }, REFRESH_DEBOUNCE_MS);
  }, [loadList]);

  // Without a server-loaded page, the first page (and the tag catalog) is fetched on mount.
  useEffect(() => {
    if (initialPage !== undefined) return;
    void loadList(listQuery.current);
  }, [initialPage, loadList]);

  useEffect(() => {
    if (initialTags !== undefined) return;
    let active = true;
    void actions.listTags().then((result) => {
      if (active && result.ok) setCatalog(result.data);
    });
    return () => {
      active = false;
    };
  }, [actions, initialTags]);

  useEffect(
    () => () => {
      for (const timer of [listTimer, threadTimer, searchTimer]) {
        if (timer.current !== null) clearTimeout(timer.current);
      }
    },
    [],
  );

  function changeQuery(patch: Partial<ListQuery>) {
    const next = { ...listQuery.current, ...patch };
    setQuery(next);
    void loadList(next);
  }

  function changeSearch(value: string) {
    setSearchInput(value);
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => {
        changeQuery({ search: value.trim() });
      },
      value === "" ? 0 : SEARCH_DEBOUNCE_MS,
    );
  }

  async function loadMore() {
    if (nextCursor === null || loadingMore) return;
    const current = listQuery.current;
    setLoadingMore(true);
    const result = await actions.list({ ...current, cursor: nextCursor });
    setLoadingMore(false);
    if (listQuery.current !== current) return;
    if (!result.ok) {
      fail(strings.loadFailed, result.message);
      return;
    }
    setConversations((items) => {
      const known = new Set(items.map((item) => item.id));
      return [...items, ...result.data.items.filter((item) => !known.has(item.id))];
    });
    setNextCursor(result.data.nextCursor);
  }

  /** Replaces a conversation everywhere; it leaves the list when it no longer matches the tab. */
  const updateConversation = useCallback(
    (id: string, update: (conversation: InboxConversationView) => InboxConversationView) => {
      setConversations((current) =>
        current
          .map((item) => (item.id === id ? update(item) : item))
          .filter(
            (item) =>
              item.id !== id ||
              item.id === selectedId.current ||
              matchesTab(item, listQuery.current.tab, currentUserId),
          ),
      );
      setSelected((current) => (current !== null && current.id === id ? update(current) : current));
    },
    [currentUserId],
  );

  const closeConversation = useCallback(() => {
    selectedId.current = null;
    setSelected(null);
    setThread(null);
    setDetailsOpen(false);
  }, []);

  /** Reassigned away or deleted: the conversation leaves the list and the thread closes. */
  const dropConversation = useCallback(
    (id: string) => {
      setConversations((current) => current.filter((item) => item.id !== id));
      if (selectedId.current === id) {
        closeConversation();
        toast.error(strings.forbiddenConversation);
      }
      scheduleListRefresh();
    },
    [closeConversation, scheduleListRefresh, strings.forbiddenConversation],
  );

  /** Refetches the newest page of the open thread; returns it (oldest first) or `null`. */
  const refreshThread = useCallback(
    async (conversationId: string): Promise<InboxMessageView[] | null> => {
      const result = await actions.thread(conversationId);
      if (selectedId.current !== conversationId) return null;
      if (!result.ok) {
        if (result.code === "FORBIDDEN" || result.code === "NOT_FOUND") {
          dropConversation(conversationId);
        }
        return null;
      }
      learnNames(result.data.names);
      const latest = [...result.data.items].reverse();
      const latestIds = new Set(latest.map((message) => message.id));
      const oldest = latest[0]?.createdAt;
      setThread((current) =>
        current === null || current.conversationId !== conversationId
          ? current
          : {
              ...current,
              cost: result.data.cost ?? current.cost,
              messages: mergeMessages(
                current.messages.filter(
                  (message) =>
                    !message.id.startsWith(OPTIMISTIC_PREFIX) &&
                    // Drafts and messages inside the refreshed page that are gone (discarded,
                    // replaced, approved) drop out.
                    (latestIds.has(message.id) ||
                      (oldest !== undefined && message.createdAt < oldest)),
                ),
                latest,
              ).concat(
                current.messages.filter((message) => message.id.startsWith(OPTIMISTIC_PREFIX)),
              ),
            },
      );
      return latest;
    },
    [actions, dropConversation, learnNames],
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
      cost: null,
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
      if (result.code === "FORBIDDEN" || result.code === "NOT_FOUND") dropConversation(id);
      else fail(strings.loadFailed, result.message);
      return;
    }
    learnNames(result.data.names);
    setThread({
      conversationId: id,
      messages: [...result.data.items].reverse(),
      historyKeys: new Set(result.data.items.map((message) => message.id)),
      nextCursor: result.data.nextCursor,
      loading: false,
      loadingOlder: false,
      cost: result.data.cost ?? null,
    });
    setScrollKey((key) => key + 1);
    const inbound = result.data.items.find((message) => message.direction === "in");
    seenInbound.current.set(id, inbound?.id ?? null);
    void actions.markSeen(id);
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
    learnNames(result.data.names);
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

  /** Handles errors every conversation action shares. Returns `true` when it succeeded. */
  function settle<T>(
    id: string,
    result: InboxActionResult<T>,
    failMessage: string,
  ): result is { ok: true; data: T } {
    if (result.ok) return true;
    if (result.code === "FORBIDDEN" || result.code === "NOT_FOUND") dropConversation(id);
    else if (result.code === "ACCOUNT_INACTIVE") {
      updateConversation(id, (item) => ({ ...item, accountActive: false }));
      fail(strings.disconnectedTitle, strings.disconnectedHint);
    } else fail(failMessage, result.message);
    return false;
  }

  async function runAction(action: ConversationAction) {
    if (selected === null || pendingAction !== null) return;
    const id = selected.id;
    setPendingAction(action);
    const result =
      action === "pause" || action === "resume"
        ? await actions.pauseAgent(id, action === "pause")
        : await actions[action](id);
    setPendingAction(null);
    if (!settle(id, result, strings.actionFailed)) return;
    updateConversation(id, () => ({ ...result.data, unreadCount: 0 }));
    if (selectedId.current === id) void refreshThread(id);
    scheduleListRefresh();
  }

  async function changeTag(tagId: string, add: boolean): Promise<boolean> {
    if (selected === null) return false;
    const id = selected.id;
    const result = add ? await actions.addTag(id, tagId) : await actions.removeTag(id, tagId);
    if (!settle(id, result, strings.actionFailed)) return false;
    updateConversation(id, (item) => ({ ...item, tags: result.data }));
    return true;
  }

  async function assignTo(userId: string | null): Promise<boolean> {
    if (selected === null) return false;
    const id = selected.id;
    const result = await actions.assign(id, userId);
    if (!settle(id, result, strings.actionFailed)) return false;
    updateConversation(id, () => ({ ...result.data, unreadCount: 0 }));
    if (selectedId.current === id) void refreshThread(id);
    scheduleListRefresh();
    return true;
  }

  /** The catalog changed in the tags manager: chips, filters and rows follow. */
  function tagSaved(tag: InboxTagView) {
    setCatalog((current) =>
      [...current.filter((item) => item.id !== tag.id), tag].sort((a, b) =>
        a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
      ),
    );
    const rename = (item: InboxConversationView) =>
      item.tags.some((each) => each.id === tag.id)
        ? { ...item, tags: item.tags.map((each) => (each.id === tag.id ? tag : each)) }
        : item;
    setConversations((current) => current.map(rename));
    setSelected((current) => (current === null ? current : rename(current)));
  }

  function tagDeleted(tagId: string) {
    setCatalog((current) => current.filter((item) => item.id !== tagId));
    const drop = (item: InboxConversationView) =>
      item.tags.some((each) => each.id === tagId)
        ? { ...item, tags: item.tags.filter((each) => each.id !== tagId) }
        : item;
    setConversations((current) => current.map(drop));
    setSelected((current) => (current === null ? current : drop(current)));
    if (listQuery.current.tagIds.includes(tagId)) {
      changeQuery({ tagIds: listQuery.current.tagIds.filter((id) => id !== tagId) });
    }
  }

  async function approveDraft(
    draft: InboxMessageView,
    text: string | undefined,
  ): Promise<DraftActionResult> {
    const id = draft.conversationId;
    const result = await actions.approveDraft(draft.id, text);
    if (!result.ok && result.code === "WINDOW_CLOSED") return "window_closed";
    if (!result.ok && result.code === "NOT_FOUND") {
      // A newer turn replaced the draft (or someone else handled it): show what is there now.
      fail(strings.draftFailed, result.message);
      void refreshThread(id);
      return "failed";
    }
    if (!settle(id, result, strings.draftFailed)) return "failed";
    approved.current.set(draft.id, result.data);
    const sent = result.data;
    updateConversation(id, (item) => ({
      ...item,
      hasPendingDraft: false,
      lastActivityAt: sent.sentAt ?? sent.createdAt,
      lastMessagePreview: {
        text: sent.text,
        direction: sent.direction,
        sender: sent.sender,
        type: sent.type,
        status: sent.status,
        at: sent.sentAt ?? sent.createdAt,
      },
    }));
    return "ok";
  }

  async function discardDraft(draft: InboxMessageView): Promise<DraftActionResult> {
    const id = draft.conversationId;
    const result = await actions.discardDraft(draft.id);
    if (!result.ok && result.code === "NOT_FOUND") {
      void refreshThread(id);
      return "ok";
    }
    if (!settle(id, result, strings.draftFailed)) return "failed";
    updateConversation(id, (item) => ({ ...item, hasPendingDraft: false }));
    return "ok";
  }

  function draftLeft(draft: InboxMessageView) {
    const sent = approved.current.get(draft.id);
    approved.current.delete(draft.id);
    setThread((current) => {
      if (current === null || current.conversationId !== draft.conversationId) return current;
      const rest = current.messages.filter((message) => message.id !== draft.id);
      return { ...current, messages: sent === undefined ? rest : mergeMessages(rest, [sent]) };
    });
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
      internal: false,
      systemLine: null,
      draft: false,
      handoffAfterDraft: false,
      approvedBy: null,
      edited: false,
      origin: null,
      source: null,
      tokensIn: null,
      tokensOut: null,
      costCents: null,
      transcription: null,
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

    const hadDraft = thread?.messages.some((message) => message.draft) ?? false;
    const result = await actions.reply(conversationId, input);
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    setThread((current) => {
      if (current === null || current.conversationId !== conversationId) return current;
      const rest = current.messages.filter((message) => message.id !== optimisticId);
      return {
        ...current,
        messages: result.ok
          ? // A person replied: the pending draft is stale and was discarded on the server.
            mergeMessages(
              rest.filter((message) => !message.draft),
              [{ ...result.data, clientKey: optimisticId }],
            )
          : rest,
      };
    });
    if (result.ok) {
      updateConversation(conversationId, (item) => ({
        ...item,
        unreadCount: 0,
        hasPendingDraft: false,
        lastActivityAt: result.data.createdAt,
        lastMessagePreview: {
          text: result.data.text,
          direction: result.data.direction,
          sender: result.data.sender,
          type: result.data.type,
          status: result.data.status,
          at: result.data.createdAt,
        },
      }));
      if (hadDraft) toast(strings.draftDiscardedByReply);
      return "sent";
    }
    if (result.code === "WINDOW_CLOSED") {
      updateConversation(conversationId, (item) => ({
        ...item,
        unreadCount: 0,
        window: { open: false, expiresAt: now },
      }));
      return "window_closed";
    }
    settle(conversationId, result, strings.sendFailed);
    void refreshThread(conversationId);
    return "failed";
  }

  /** Internal note (AC-IB-3): shown at once, replaced by the stored one; never sent. */
  async function saveNote(text: string): Promise<ComposerSendResult> {
    if (selected === null || actions.note === undefined) return "failed";
    const conversationId = selected.id;
    optimisticSeq.current += 1;
    const optimisticId = `${OPTIMISTIC_PREFIX}${String(optimisticSeq.current)}`;
    const now = new Date().toISOString();
    const optimistic: InboxMessageView = {
      id: optimisticId,
      conversationId,
      direction: "out",
      type: "text",
      text,
      content: { body: text },
      sender: "human",
      senderRef: currentUserId,
      status: "sent",
      error: null,
      sentAt: now,
      createdAt: now,
      replyToMetaId: null,
      metaMessageId: null,
      internal: true,
      systemLine: null,
      draft: false,
      handoffAfterDraft: false,
      approvedBy: null,
      edited: false,
      origin: null,
      source: null,
      tokensIn: null,
      tokensOut: null,
      costCents: null,
      transcription: null,
    };
    setThread((current) =>
      current === null || current.conversationId !== conversationId
        ? current
        : { ...current, messages: [...current.messages, optimistic] },
    );
    setScrollKey((key) => key + 1);

    const result = await actions.note(conversationId, text);
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
    if (result.ok) return "sent";
    settle(conversationId, result, strings.noteFailed);
    return "failed";
  }

  const listTemplates = useCallback(() => {
    const id = selectedId.current;
    if (id === null) return Promise.resolve({ ok: true as const, data: [] });
    return actions.listTemplates(id);
  }, [actions]);

  const listConversationSnippets = useCallback(() => {
    const id = selectedId.current;
    if (actions.listSnippets === undefined || id === null) {
      return Promise.resolve({ ok: true as const, data: [] });
    }
    return actions.listSnippets(id);
  }, [actions]);

  const renderConversationSnippet = useCallback(
    (snippetId: string) => {
      const id = selectedId.current;
      if (actions.renderSnippet === undefined || id === null) {
        return Promise.resolve({
          ok: false as const,
          code: "NOT_FOUND" as const,
          message: "No conversation",
        });
      }
      return actions.renderSnippet(snippetId, id);
    },
    [actions],
  );

  const listAssignees = useCallback(() => {
    const id = selectedId.current;
    if (id === null) return Promise.resolve({ ok: true as const, data: [] });
    return actions.listAssignees(id);
  }, [actions]);

  const snippetsManager = useMemo(() => snippetsManagerActions(actions), [actions]);
  const tagsManager = useMemo(
    () => (permissions.manageTags ? tagsManagerActions(actions) : null),
    [actions, permissions.manageTags],
  );

  // Realtime: patch what we can right away, then refetch the list (previews, tags, assignees,
  // visibility: a conversation reassigned away from an agent disappears here).
  const onConversation = useCallback(
    (row: SendoConversationRow) => {
      updateConversation(row.id, (item) => applyRow(item, row));
      scheduleListRefresh();
    },
    [scheduleListRefresh, updateConversation],
  );

  const onMessage = useCallback(
    (row: SendoMessageRow) => {
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

  // Polling fallback (no realtime): the list every 10 s, the open thread every 3 s. New inbound
  // messages in the open thread are marked seen, as the realtime path does.
  const onPollList = useCallback(() => {
    void loadList(listQuery.current, { silent: true });
  }, [loadList]);

  const onPollThread = useCallback(
    (conversationId: string) => {
      void refreshThread(conversationId).then((latest) => {
        const inbound = [...(latest ?? [])].reverse().find((message) => message.direction === "in");
        if (inbound === undefined || seenInbound.current.get(conversationId) === inbound.id) return;
        seenInbound.current.set(conversationId, inbound.id);
        void actions.markSeen(conversationId);
      });
    },
    [actions, refreshThread],
  );

  useSendoRealtime({
    client: realtimeClient,
    tenantId,
    conversationId: selected?.id ?? null,
    onConversation,
    onMessage,
    onPollList,
    onPollThread,
  });

  const people = useMemo<InboxPeople>(() => {
    const known: Record<string, string> = { ...names };
    for (const item of conversations) {
      if (item.assignee?.name != null) known[item.assignee.id] = item.assignee.name;
    }
    if (currentUser.name !== null) known[currentUser.id] = currentUser.name;
    return {
      currentUserId: currentUser.id,
      currentUserName: currentUser.name,
      names: known,
      agentNames: agentNames ?? {},
    };
  }, [agentNames, conversations, currentUser.id, currentUser.name, names]);

  const threadOpen = selected !== null && thread !== null;
  const number =
    selected === null ? null : (numbers.find((item) => item.id === selected.accountId) ?? null);
  const latestThreadMessages = thread?.messages ?? [];
  const contextPanel =
    selected === null ? null : (
      <ContextPanel
        conversation={selected}
        number={number}
        messages={latestThreadMessages}
        cost={thread?.conversationId === selected.id ? thread.cost : null}
        showCost={permissions.viewCosts}
        assignmentSlot={
          permissions.reassign ? (
            <AssignMenu
              key={selected.id}
              conversation={selected}
              listAssignees={listAssignees}
              onAssign={assignTo}
            />
          ) : undefined
        }
        tagsSlot={
          <TagPicker
            key={selected.id}
            tags={selected.tags}
            catalog={catalog}
            onAdd={(tagId) => changeTag(tagId, true)}
            onRemove={(tagId) => changeTag(tagId, false)}
          />
        }
      />
    );
  const showSidePanel = isDesktop && !isWide;

  function closeOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") setDetailsOpen(false);
  }

  if (denied) return <InboxAccessDenied strings={overrides} className={className} />;

  return (
    <InboxStringsContext value={strings}>
      <InboxPeopleContext value={people}>
        <TooltipProvider delayDuration={300}>
          <div
            className={cn("flex h-full min-h-0 w-full overflow-hidden bg-background", className)}
            data-slot="sendo-inbox"
          >
            <InboxRail
              currentUser={currentUser}
              nav={nav}
              onOpenSnippets={
                snippetsManager === null
                  ? undefined
                  : () => {
                      setSnippetsOpen(true);
                    }
              }
              onOpenTags={
                tagsManager === null
                  ? undefined
                  : () => {
                      setTagsOpen(true);
                    }
              }
              className="hidden md:flex"
            />
            <ConversationList
              className={cn(
                "w-full md:w-[300px] md:shrink-0 md:border-r min-[1180px]:w-[340px]",
                threadOpen && "hidden md:flex",
              )}
              conversations={conversations}
              selectedId={selected?.id ?? null}
              enteringIds={enteringIds}
              onSelect={(id) => {
                void openConversation(id);
              }}
              tab={query.tab}
              onTabChange={(tab) => {
                changeQuery({ tab });
              }}
              counts={counts}
              numbers={numbers}
              accountId={query.accountId}
              onAccountChange={(accountId) => {
                changeQuery({ accountId });
              }}
              search={searchInput}
              onSearchChange={changeSearch}
              tags={catalog}
              tagIds={query.tagIds}
              onTagIdsChange={(tagIds) => {
                changeQuery({ tagIds });
              }}
              loading={listLoading}
              hasMore={nextCursor !== null}
              loadingMore={loadingMore}
              onLoadMore={() => {
                void loadMore();
              }}
              timeZone={timeZone}
            />
            <div className="relative flex min-w-0 flex-1 overflow-hidden">
              {threadOpen ? (
                <Thread
                  key={selected.id}
                  className="min-w-0 flex-1"
                  conversation={selected}
                  messages={thread.messages}
                  historyKeys={thread.historyKeys}
                  currentUserId={currentUserId}
                  permissions={permissions}
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
                  onApproveDraft={approveDraft}
                  onDiscardDraft={discardDraft}
                  onDraftLeft={draftLeft}
                  onOpenDetails={
                    isWide
                      ? undefined
                      : () => {
                          setDetailsOpen((open) => !open);
                        }
                  }
                  detailsOpen={detailsOpen}
                  timeZone={timeZone}
                  composer={
                    selected.accountActive ? (
                      <Composer
                        key={selected.id}
                        window={selected.window}
                        status={selected.status}
                        onSend={send}
                        onNote={actions.note === undefined ? undefined : saveNote}
                        listTemplates={listTemplates}
                        listSnippets={
                          actions.listSnippets === undefined ? undefined : listConversationSnippets
                        }
                        renderSnippet={
                          actions.renderSnippet === undefined
                            ? undefined
                            : renderConversationSnippet
                        }
                        disabled={thread.loading}
                      />
                    ) : (
                      <p
                        className="flex items-center gap-2 border-t bg-background p-3 text-sm text-muted-foreground md:p-4"
                        data-slot="composer"
                        data-mode="disconnected"
                      >
                        <UnplugIcon className="size-4 shrink-0" aria-hidden />
                        {strings.composerDisconnected}
                      </p>
                    )
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
              {showSidePanel && selected !== null && (
                <aside
                  aria-label={strings.detailsTitle}
                  inert={!detailsOpen}
                  onKeyDown={closeOnEscape}
                  data-state={detailsOpen ? "open" : "closed"}
                  className={cn(
                    "absolute inset-y-0 right-0 z-20 w-[300px] max-w-full overflow-y-auto border-l bg-background shadow-xl",
                    sidePanelMotionClass,
                    detailsOpen
                      ? "opacity-100"
                      : "pointer-events-none [transform:translateX(100%)] opacity-0",
                  )}
                >
                  <div className="sticky top-0 z-10 flex justify-end bg-background/90 px-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={strings.sheetClose}
                      onClick={() => {
                        setDetailsOpen(false);
                      }}
                      className="transition-colors active:bg-accent/70"
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </div>
                  {contextPanel}
                </aside>
              )}
            </div>
            {isWide && selected !== null && (
              <aside
                aria-label={strings.detailsTitle}
                className="w-[300px] shrink-0 overflow-y-auto border-l bg-background"
              >
                {contextPanel}
              </aside>
            )}
          </div>
          {!isDesktop && selected !== null && (
            <MotionSheet
              open={detailsOpen}
              onOpenChange={setDetailsOpen}
              title={strings.detailsTitle}
              hideTitle
            >
              {contextPanel}
            </MotionSheet>
          )}
          {snippetsManager !== null && (
            <SnippetsManager
              open={snippetsOpen}
              onOpenChange={setSnippetsOpen}
              actions={snippetsManager}
              canManageTenant={permissions.manageSnippets}
              numbers={numbers}
            />
          )}
          {tagsManager !== null && (
            <TagsManager
              open={tagsOpen}
              onOpenChange={setTagsOpen}
              catalog={catalog}
              actions={tagsManager}
              onSaved={tagSaved}
              onDeleted={tagDeleted}
            />
          )}
        </TooltipProvider>
      </InboxPeopleContext>
    </InboxStringsContext>
  );
}
