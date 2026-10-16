"use client";

import {
  ArrowLeftIcon,
  BotIcon,
  CheckIcon,
  LoaderIcon,
  MessageCircleIcon,
  PanelRightIcon,
  UserIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "./assignee-avatar";
import { ConversationStatusBadge } from "./conversation-list";
import { DraftCard, type DraftActionResult } from "./draft-card";
import { bubbleKind, MessageBubble } from "./message-bubble";
import { NoteBubble } from "./note-bubble";
import { useInboxLocale, useInboxStrings } from "./strings-context";
import { DaySeparator, SystemLine } from "./system-line";
import { ThreadBanners } from "./thread-banners";
import { enterBubbleClass, pressClass } from "./transitions";
import type { InboxConversationView, InboxMessageView, InboxPermissions } from "./types";
import { DEFAULT_INBOX_TIME_ZONE, dayKey, formatDayLabel, useNow } from "./utils";
import { WindowIndicator } from "./window-indicator";

export type ConversationAction = "take" | "returnToAgent" | "close" | "pause" | "resume";

/** A message plus the React key it keeps when an optimistic message is replaced by the stored one. */
export type ThreadMessage = InboxMessageView & { clientKey?: string };

export function messageKey(message: ThreadMessage): string {
  return message.clientKey ?? message.id;
}

/** Starts a new sender group after this gap even when the sender is the same. */
const GROUP_GAP_MS = 10 * 60_000;
/** Within this distance from the bottom, new messages keep the thread pinned to the bottom. */
const PIN_THRESHOLD_PX = 120;

/** The pending draft: the newest `draft` message (a newer turn replaces older ones). */
export function pendingDraft(messages: readonly ThreadMessage[]): ThreadMessage | null {
  let found: ThreadMessage | null = null;
  for (const message of messages) if (message.draft) found = message;
  return found;
}

/** `by` of the newest pause line (who paused the agent), if it is in the loaded page. */
export function lastPausedBy(messages: readonly InboxMessageView[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = messages[index]?.systemLine;
    if (line?.event === "agent_paused") return line.by;
    if (line?.event === "agent_resumed") return null;
  }
  return null;
}

export interface ThreadProps {
  conversation: InboxConversationView;
  /** Oldest first, drafts included (the pending one is drawn as a card at the bottom). */
  messages: ThreadMessage[];
  /**
   * Keys of messages loaded as history (first page, older pages). Any other message was appended
   * while the thread was open and enters with a short fade and rise. Omit to disable the motion.
   */
  historyKeys?: ReadonlySet<string>;
  currentUserId: string;
  permissions: Pick<InboxPermissions, "pauseAgent" | "viewCosts">;
  loading?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Change it to jump to the newest message (thread opened, own message sent). */
  scrollToBottomKey?: number;
  onBack?: () => void;
  onAction?: (action: ConversationAction) => void;
  pendingAction?: ConversationAction | null;
  onApproveDraft?: (
    draft: InboxMessageView,
    text: string | undefined,
  ) => Promise<DraftActionResult>;
  onDiscardDraft?: (draft: InboxMessageView) => Promise<DraftActionResult>;
  /** The approved / discarded draft finished leaving. */
  onDraftLeft?: (draft: InboxMessageView) => void;
  /** Below 1180 px: opens the context panel. */
  onOpenDetails?: () => void;
  detailsOpen?: boolean;
  composer?: ReactNode;
  timeZone?: string;
  className?: string;
}

type GroupKey = string;

function groupKey(message: InboxMessageView): GroupKey {
  return `${bubbleKind(message)}:${message.senderRef ?? ""}`;
}

function startsGroup(previous: InboxMessageView | undefined, message: InboxMessageView): boolean {
  if (previous === undefined || previous.internal) return true;
  if (groupKey(previous) !== groupKey(message)) return true;
  return (
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > GROUP_GAP_MS
  );
}

function ThreadHeader({
  conversation,
  currentUserId,
  permissions,
  onBack,
  onAction,
  pendingAction,
  onOpenDetails,
  detailsOpen,
}: Pick<
  ThreadProps,
  | "conversation"
  | "currentUserId"
  | "permissions"
  | "onBack"
  | "onAction"
  | "pendingAction"
  | "onOpenDetails"
  | "detailsOpen"
>) {
  const strings = useInboxStrings();
  const { contact, status, assignedTo } = conversation;
  const canTake = status !== "closed" && !(status === "human" && assignedTo === currentUserId);
  const busy = pendingAction !== null && pendingAction !== undefined;
  const pausedOnAccount = conversation.agentPausedOn === "account";

  function actionButton(
    action: ConversationAction,
    label: string,
    icon: ReactNode,
    variant: "default" | "outline" | "ghost",
  ) {
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={busy}
        onClick={() => onAction?.(action)}
        className={cn(
          variant === "default" ? "active:bg-primary/80" : "active:bg-accent/70",
          pressClass,
        )}
      >
        {pendingAction === action ? <LoaderIcon aria-hidden /> : icon}
        {label}
      </Button>
    );
  }

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2.5 md:px-4">
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        {onBack !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-1 shrink-0 transition-colors active:bg-accent/70 md:hidden"
            aria-label={strings.back}
            onClick={onBack}
          >
            <ArrowLeftIcon aria-hidden />
          </Button>
        )}
        <ContactAvatar id={contact.id} name={contact.displayName} channel={conversation.channel} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-[15px] font-semibold" title={contact.displayName}>
            {contact.displayName}
          </h2>
          <div className="flex min-w-0 items-center gap-2 overflow-hidden text-xs text-muted-foreground">
            <ConversationStatusBadge status={status} />
            {(contact.appRef ?? contact.phone) !== null && (
              <span className="min-w-0 truncate tabular-nums">
                {contact.appRef ?? contact.phone}
              </span>
            )}
            <WindowIndicator status={conversation.window} className="shrink-0" />
          </div>
        </div>
        {onOpenDetails !== undefined && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={strings.details}
            aria-expanded={detailsOpen}
            onClick={onOpenDetails}
            className={cn("active:bg-accent/70", detailsOpen === true && "bg-accent", pressClass)}
          >
            <PanelRightIcon aria-hidden />
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 max-md:w-full">
        {permissions.pauseAgent && status !== "closed" && (
          <label
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[12.5px] whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              (busy || pausedOnAccount) && "cursor-not-allowed opacity-60",
            )}
            title={pausedOnAccount ? strings.pausedOnNumber : strings.pauseAgentHint}
          >
            <Switch
              checked={conversation.agentPaused}
              disabled={busy || pausedOnAccount}
              onCheckedChange={(checked) => onAction?.(checked ? "pause" : "resume")}
              className="transition-[background-color,box-shadow] data-[state=checked]:bg-amber-500"
            />
            <span className="max-sm:sr-only">
              {conversation.agentPaused ? strings.agentPausedSwitch : strings.pauseAgent}
            </span>
          </label>
        )}
        {status === "human" &&
          actionButton("returnToAgent", strings.returnToAgent, <BotIcon aria-hidden />, "outline")}
        {canTake && actionButton("take", strings.take, <UserIcon aria-hidden />, "default")}
        {status !== "closed" &&
          actionButton("close", strings.close, <CheckIcon aria-hidden />, "ghost")}
      </div>
    </header>
  );
}

/**
 * One conversation: header (status, pause switch, Devolver / Tomar / Cerrar), banners, messages
 * of every kind with day separators, the pending draft card and the composer slot.
 */
export function Thread({
  conversation,
  messages,
  historyKeys,
  currentUserId,
  permissions,
  loading = false,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  scrollToBottomKey = 0,
  onBack,
  onAction,
  pendingAction = null,
  onApproveDraft,
  onDiscardDraft,
  onDraftLeft,
  onOpenDetails,
  detailsOpen,
  composer,
  timeZone = DEFAULT_INBOX_TIME_ZONE,
  className,
}: ThreadProps) {
  const strings = useInboxStrings();
  const { formatLocale } = useInboxLocale();
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);
  const [leftDraftIds, setLeftDraftIds] = useState<ReadonlySet<string>>(() => new Set());
  const visible = messages.filter((message) => !message.draft);
  const draft = pendingDraft(messages);
  const shownDraft = draft !== null && !leftDraftIds.has(draft.id) ? draft : null;
  const firstId = visible[0]?.id;
  const bottomKey = `${visible.at(-1)?.id ?? ""}:${shownDraft?.id ?? ""}`;

  // Opening a thread or sending a message jumps to the newest message.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    element.scrollTop = element.scrollHeight;
    pinned.current = true;
  }, [scrollToBottomKey, loading]);

  // Older messages were prepended: keep the same message under the reader's eyes.
  useLayoutEffect(() => {
    const element = scroller.current;
    const fromBottom = restoreFromBottom.current;
    if (element === null || fromBottom === null) return;
    element.scrollTop = element.scrollHeight - fromBottom;
    restoreFromBottom.current = null;
  }, [firstId]);

  // Something new at the bottom: follow it only when the reader is already at the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [bottomKey]);

  function loadOlder() {
    const element = scroller.current;
    if (element !== null) restoreFromBottom.current = element.scrollHeight - element.scrollTop;
    onLoadOlder?.();
  }

  const timeline: ReactNode[] = [];
  let previousDay: string | null = null;
  visible.forEach((message, index) => {
    const day = dayKey(message.createdAt, timeZone);
    if (day !== previousDay) {
      timeline.push(
        <DaySeparator
          key={`day:${day}`}
          label={formatDayLabel(
            message.createdAt,
            now,
            { today: strings.dayToday, yesterday: strings.dayYesterday },
            formatLocale,
            timeZone,
          )}
        />,
      );
    }
    const key = messageKey(message);
    const entering = historyKeys !== undefined && !historyKeys.has(key);
    const previous = day === previousDay ? visible[index - 1] : undefined;
    previousDay = day;
    let content: ReactNode;
    if (message.systemLine !== null || (message.internal && message.sender === "system")) {
      content = <SystemLine message={message} timeZone={timeZone} />;
    } else if (message.internal) {
      content = <NoteBubble message={message} timeZone={timeZone} />;
    } else {
      content = (
        <MessageBubble
          message={message}
          showSender={startsGroup(previous, message)}
          showCost={permissions.viewCosts}
          timeZone={timeZone}
        />
      );
    }
    timeline.push(
      <div
        key={key}
        className={cn("flex flex-col", entering && enterBubbleClass)}
        data-motion={entering ? "enter" : undefined}
        data-message-id={message.id}
      >
        {content}
      </div>,
    );
  });

  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col bg-background", className)}
      aria-label={conversation.contact.displayName}
    >
      <ThreadHeader
        conversation={conversation}
        currentUserId={currentUserId}
        permissions={permissions}
        onBack={onBack}
        onAction={onAction}
        pendingAction={pendingAction}
        onOpenDetails={onOpenDetails}
        detailsOpen={detailsOpen}
      />
      <ThreadBanners
        conversation={conversation}
        pausedBy={lastPausedBy(visible)}
        canResume={permissions.pauseAgent}
        onResume={() => onAction?.("resume")}
        resuming={pendingAction === "resume"}
        timeZone={timeZone}
      />
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:18px_18px]"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < PIN_THRESHOLD_PX;
        }}
        role="log"
        aria-busy={loading}
      >
        {loading ? (
          <p
            className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderIcon className="size-4" aria-hidden />
            {strings.threadLoading}
          </p>
        ) : visible.length === 0 && shownDraft === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <MessageCircleIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{strings.threadEmpty}</p>
            <p className="max-w-xs text-sm text-pretty text-muted-foreground">
              {strings.threadEmptyHint}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-1 px-3 pt-4 pb-2 md:px-5">
            {hasOlder && (
              <div className="flex justify-center pb-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingOlder}
                  onClick={loadOlder}
                  className="transition-colors active:bg-accent/70"
                >
                  {loadingOlder ? <LoaderIcon aria-hidden /> : null}
                  {loadingOlder ? strings.loadingOlder : strings.loadOlder}
                </Button>
              </div>
            )}
            {timeline}
            {shownDraft !== null && (
              <DraftCard
                key={shownDraft.id}
                draft={shownDraft}
                window={conversation.window}
                disconnected={!conversation.accountActive}
                showUsage={permissions.viewCosts}
                entering={historyKeys !== undefined && !historyKeys.has(messageKey(shownDraft))}
                onApprove={(text) =>
                  onApproveDraft === undefined
                    ? Promise.resolve("failed")
                    : onApproveDraft(shownDraft, text)
                }
                onDiscard={() =>
                  onDiscardDraft === undefined
                    ? Promise.resolve("failed")
                    : onDiscardDraft(shownDraft)
                }
                onLeft={() => {
                  setLeftDraftIds((current) => new Set([...current, shownDraft.id]));
                  onDraftLeft?.(shownDraft);
                }}
              />
            )}
          </div>
        )}
      </div>
      {composer}
    </section>
  );
}
