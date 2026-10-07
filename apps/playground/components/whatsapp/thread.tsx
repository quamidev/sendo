"use client";

import {
  ArrowLeftIcon,
  BotIcon,
  CheckIcon,
  LoaderIcon,
  MessageCircleIcon,
  UserIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConversationStatusBadge } from "./conversation-list";
import { MessageBubble } from "./message-bubble";
import { useInboxStrings } from "./strings";
import type { InboxConversationView, InboxMessageView } from "./types";
import { DEFAULT_INBOX_TIME_ZONE, initials } from "./utils";
import { WindowIndicator } from "./window-indicator";

export type ConversationAction = "take" | "returnToAgent" | "close";

/** Starts a new sender group after this gap even when the sender is the same. */
const GROUP_GAP_MS = 10 * 60_000;
/** Within this distance from the bottom, new messages keep the thread pinned to the bottom. */
const PIN_THRESHOLD_PX = 120;

export interface ThreadProps {
  conversation: InboxConversationView;
  /** Oldest first. */
  messages: InboxMessageView[];
  currentUserId: string;
  loading?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  /** Change it to jump to the newest message (thread opened, own message sent). */
  scrollToBottomKey?: number;
  onBack?: () => void;
  onAction?: (action: ConversationAction) => void;
  pendingAction?: ConversationAction | null;
  composer?: ReactNode;
  timeZone?: string;
  className?: string;
}

function startsGroup(previous: InboxMessageView | undefined, message: InboxMessageView): boolean {
  if (previous === undefined) return true;
  if (previous.sender !== message.sender || previous.senderRef !== message.senderRef) return true;
  return (
    new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > GROUP_GAP_MS
  );
}

function ThreadHeader({
  conversation,
  currentUserId,
  onBack,
  onAction,
  pendingAction,
}: Pick<ThreadProps, "conversation" | "currentUserId" | "onBack" | "onAction" | "pendingAction">) {
  const strings = useInboxStrings();
  const { contact, status, assignedTo } = conversation;
  const canTake = !(status === "human" && assignedTo === currentUserId);
  const busy = pendingAction !== null && pendingAction !== undefined;

  function actionButton(
    action: ConversationAction,
    label: string,
    icon: ReactNode,
    variant: "default" | "outline",
  ) {
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={busy}
        onClick={() => onAction?.(action)}
        className={cn(
          "transition-colors",
          variant === "default" ? "active:bg-primary/80" : "active:bg-accent/70",
        )}
      >
        {pendingAction === action ? <LoaderIcon aria-hidden /> : icon}
        {label}
      </Button>
    );
  }

  return (
    <header className="flex flex-col gap-2 border-b p-3 md:flex-row md:items-center md:gap-3 md:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
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
        <Avatar className="size-9 shrink-0">
          <AvatarFallback className="text-xs font-medium">
            {initials(contact.displayName) ?? <UserIcon className="size-4" aria-hidden />}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold" title={contact.displayName}>
            {contact.displayName}
          </h2>
          {contact.displayName !== contact.phone && (
            <p className="truncate text-xs text-muted-foreground tabular-nums">{contact.phone}</p>
          )}
        </div>
        <ConversationStatusBadge status={status} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <WindowIndicator status={conversation.window} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canTake &&
            actionButton("take", strings.take, <UserRoundPlusIcon aria-hidden />, "default")}
          {status === "human" &&
            actionButton(
              "returnToAgent",
              strings.returnToAgent,
              <BotIcon aria-hidden />,
              "outline",
            )}
          {status !== "closed" &&
            actionButton("close", strings.close, <CheckIcon aria-hidden />, "outline")}
        </div>
      </div>
    </header>
  );
}

/** Messages of one conversation (oldest at the top), its header actions and the composer slot. */
export function Thread({
  conversation,
  messages,
  currentUserId,
  loading = false,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  scrollToBottomKey = 0,
  onBack,
  onAction,
  pendingAction = null,
  composer,
  timeZone = DEFAULT_INBOX_TIME_ZONE,
  className,
}: ThreadProps) {
  const strings = useInboxStrings();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);
  const firstId = messages[0]?.id;
  const lastId = messages.at(-1)?.id;

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

  // A new message at the bottom: follow it only when the reader is already at the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lastId]);

  function loadOlder() {
    const element = scroller.current;
    if (element !== null) restoreFromBottom.current = element.scrollHeight - element.scrollTop;
    onLoadOlder?.();
  }

  return (
    <section
      className={cn("flex min-h-0 min-w-0 flex-col", className)}
      aria-label={conversation.contact.displayName}
    >
      <ThreadHeader
        conversation={conversation}
        currentUserId={currentUserId}
        onBack={onBack}
        onAction={onAction}
        pendingAction={pendingAction}
      />
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/30"
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
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <MessageCircleIcon className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{strings.threadEmpty}</p>
            <p className="max-w-xs text-sm text-pretty text-muted-foreground">
              {strings.threadEmptyHint}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 p-3 md:p-4">
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
            {messages.map((message, index) => {
              const groupStart = startsGroup(messages[index - 1], message);
              return (
                <div key={message.id} className={cn(groupStart && index > 0 && "pt-2")}>
                  <MessageBubble message={message} showSender={groupStart} timeZone={timeZone} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {composer}
    </section>
  );
}
