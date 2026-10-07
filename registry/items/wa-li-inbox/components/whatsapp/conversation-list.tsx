"use client";

import type { ConversationStatus } from "@quami/wa-li";
import { InboxIcon, LoaderIcon, UserCheckIcon, UserIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useInboxStrings, type InboxStrings } from "./strings";
import type { InboxConversationView, InboxFilter } from "./types";
import { formatRelative, initials, useNow } from "./utils";

const FILTERS: { value: InboxFilter; label: (strings: InboxStrings) => string }[] = [
  { value: "human", label: (strings) => strings.filterHuman },
  { value: "agent", label: (strings) => strings.filterAgent },
  { value: "closed", label: (strings) => strings.filterClosed },
  { value: "all", label: (strings) => strings.filterAll },
];

function isFilter(value: string): value is InboxFilter {
  return FILTERS.some((filter) => filter.value === value);
}

export function ConversationStatusBadge({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}) {
  const strings = useInboxStrings();
  const label: Record<ConversationStatus, string> = {
    human: strings.statusHuman,
    agent: strings.statusAgent,
    closed: strings.statusClosed,
  };
  return (
    <Badge
      variant={status === "human" ? "default" : status === "agent" ? "secondary" : "outline"}
      className={cn("shrink-0", className)}
      data-status={status}
    >
      {label[status]}
    </Badge>
  );
}

function previewText(conversation: InboxConversationView, strings: InboxStrings): string {
  const preview = conversation.lastMessagePreview;
  if (preview === null) return strings.noMessagesPreview;
  const text =
    preview.text ?? (preview.type === "text" ? "" : strings.messageTypeLabel(preview.type));
  return preview.direction === "out" && preview.sender === "human"
    ? `${strings.previewYou} ${text}`
    : text;
}

interface ConversationRowProps {
  conversation: InboxConversationView;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
}

function ConversationRow({ conversation, selected, now, onSelect }: ConversationRowProps) {
  const strings = useInboxStrings();
  const { contact, unreadCount } = conversation;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onSelect(conversation.id);
        }}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full min-w-0 items-start gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 active:bg-accent",
        )}
        data-conversation-id={conversation.id}
      >
        <Avatar className="mt-0.5 size-9 shrink-0">
          <AvatarFallback className="text-xs font-medium">
            {initials(contact.displayName) ?? <UserIcon className="size-4" aria-hidden />}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                unreadCount > 0 ? "font-semibold" : "font-medium",
              )}
              title={contact.displayName}
            >
              {contact.displayName}
            </span>
            <time
              dateTime={conversation.lastActivityAt}
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              suppressHydrationWarning
            >
              {formatRelative(conversation.lastActivityAt, now)}
            </time>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <ConversationStatusBadge status={conversation.status} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {previewText(conversation, strings)}
            </span>
            {unreadCount > 0 && (
              <span
                className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums"
                aria-label={strings.unreadCount(unreadCount)}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export interface ConversationListProps {
  conversations: InboxConversationView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  assignedToMe: boolean;
  onAssignedToMeChange: (value: boolean) => void;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  className?: string;
}

/** Conversations sorted by last activity, with status tabs and the "assigned to me" toggle. */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  assignedToMe,
  onAssignedToMeChange,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  className,
}: ConversationListProps) {
  const strings = useInboxStrings();
  const now = useNow();
  const sorted = [...conversations].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );

  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-label={strings.inboxTitle}>
      <div className="flex flex-col gap-2 border-b p-3">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            if (isFilter(value)) onFilterChange(value);
          }}
        >
          <TabsList className="w-full" aria-label={strings.filtersLabel}>
            {FILTERS.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="transition-colors hover:bg-background/60 active:bg-background/80"
              >
                {item.label(strings)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          type="button"
          variant={assignedToMe ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={assignedToMe}
          onClick={() => {
            onAssignedToMeChange(!assignedToMe);
          }}
          className={cn(
            "self-start transition-colors",
            assignedToMe ? "active:bg-secondary/70" : "text-muted-foreground active:bg-accent/70",
          )}
        >
          <UserCheckIcon aria-hidden />
          {strings.assignedToMe}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status">
            <LoaderIcon className="size-4" aria-hidden />
            {strings.listLoading}
          </p>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
            <InboxIcon className="size-6" aria-hidden />
            <p>{strings.listEmpty}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5 p-2">
            {sorted.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
                now={now}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
        {hasMore && !loading && (
          <div className="flex justify-center p-2 pb-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="transition-colors active:bg-accent/70"
            >
              {loadingMore ? strings.loadingOlder : strings.loadMoreConversations}
            </Button>
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
