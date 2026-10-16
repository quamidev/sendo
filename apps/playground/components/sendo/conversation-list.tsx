"use client";

import type { ConversationStatus } from "@quami/sendo";
import {
  BotIcon,
  InboxIcon,
  LoaderIcon,
  PauseIcon,
  SearchIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AssigneeAvatar, ContactAvatar } from "./assignee-avatar";
import { personName, useInboxPeople } from "./people";
import type { InboxStrings } from "./strings";
import { useInboxFormat, useInboxLocale, useInboxStrings } from "./strings-context";
import { TagChip, TagFilterChip } from "./tag-chip";
import { CrossFade, enterRowClass } from "./transitions";
import {
  INBOX_TABS,
  type InboxConversationView,
  type InboxNumberView,
  type InboxTab,
  type InboxTabCounts,
  type InboxTagView,
} from "./types";
import { DEFAULT_INBOX_TIME_ZONE, formatListTime, useNow } from "./utils";
import { WindowIndicator } from "./window-indicator";

/** Tags shown on a row before "+N". */
const ROW_TAG_LIMIT = 2;
const ALL_NUMBERS = "__all__";
const SHOW_DISCONNECTED = "__disconnected__";
/** Horizontal rows that scroll (tabs, tag filters) fade out at the right edge. */
const scrollRowClass =
  "-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]";

function tabLabel(tab: InboxTab, strings: InboxStrings): string {
  switch (tab) {
    case "open":
      return strings.tabOpen;
    case "mine":
      return strings.tabMine;
    case "agent":
      return strings.tabAgent;
    case "human":
      return strings.tabHuman;
    case "closed":
      return strings.tabClosed;
  }
}

export function ConversationStatusBadge({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}) {
  const strings = useInboxStrings();
  return (
    <CrossFade
      value={status}
      className={cn("justify-items-start", className)}
      render={(shown) => (
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap [&>svg]:size-3",
            shown === "agent" && "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
            shown === "human" &&
              "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
            shown === "closed" && "bg-muted text-muted-foreground",
          )}
          data-status={shown}
        >
          {shown === "agent" && <BotIcon aria-hidden />}
          {shown === "human" && <UserIcon aria-hidden />}
          {shown === "agent"
            ? strings.statusAgent
            : shown === "human"
              ? strings.statusHuman
              : strings.statusClosed}
        </span>
      )}
    />
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
  /** Badge of a conversation whose number is disconnected (read-only); `null` when connected. */
  disconnectedLabel: string | null;
  selected: boolean;
  /** Arrived after mount (realtime / refresh): plays the enter motion. */
  entering: boolean;
  now: number;
  timeZone: string;
  onSelect: (id: string) => void;
}

function ConversationRow({
  conversation,
  disconnectedLabel,
  selected,
  entering,
  now,
  timeZone,
  onSelect,
}: ConversationRowProps) {
  const strings = useInboxStrings();
  const format = useInboxFormat();
  const { formatLocale } = useInboxLocale();
  const people = useInboxPeople();
  const { contact, unreadCount, assignee, tags } = conversation;
  const assigneeName =
    assignee === null ? null : (assignee.name ?? personName(assignee.id, people, strings));
  const hiddenTags = tags.length - ROW_TAG_LIMIT;

  return (
    <li
      className={entering ? enterRowClass : undefined}
      data-motion={entering ? "enter" : undefined}
    >
      <button
        type="button"
        onClick={() => {
          onSelect(conversation.id);
        }}
        aria-current={selected ? "true" : undefined}
        data-conversation-id={conversation.id}
        className={cn(
          "relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 rounded-xl p-2.5 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
          selected
            ? "bg-accent before:absolute before:top-3 before:bottom-3 before:-left-2 before:w-[3px] before:rounded-r before:bg-primary"
            : "hover:bg-accent/60 active:bg-accent",
        )}
      >
        <ContactAvatar
          id={contact.id}
          name={contact.displayName}
          channel={conversation.channel}
          className="mt-0.5 self-start"
        />
        <span className="flex min-w-0 flex-col">
          <span
            className={cn("truncate text-sm", unreadCount > 0 ? "font-semibold" : "font-medium")}
            title={contact.displayName}
          >
            {contact.displayName}
          </span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={contact.appRef ?? undefined}
          >
            {contact.appRef ?? strings.notLinked}
          </span>
          <span className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {previewText(conversation, strings)}
          </span>
          {(disconnectedLabel !== null ||
            conversation.hasPendingDraft ||
            conversation.agentPaused ||
            tags.length > 0) && (
            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
              {disconnectedLabel !== null && (
                <span
                  className="inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground"
                  data-disconnected
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-zinc-400" aria-hidden />
                  <span className="truncate">{disconnectedLabel}</span>
                </span>
              )}
              {conversation.hasPendingDraft && (
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-blue-50 px-1.5 text-[11px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <BotIcon className="size-3" aria-hidden />
                  {strings.flagDraft}
                </span>
              )}
              {conversation.agentPaused && (
                <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <PauseIcon className="size-3" aria-hidden />
                  {strings.flagPaused}
                </span>
              )}
              {tags.slice(0, ROW_TAG_LIMIT).map((tag) => (
                <TagChip key={tag.id} tag={tag} size="sm" className="max-w-28" />
              ))}
              {hiddenTags > 0 && (
                <span
                  className="text-[11px] text-muted-foreground tabular-nums"
                  title={format.list(tags.slice(ROW_TAG_LIMIT).map((tag) => tag.name))}
                >
                  {strings.moreTags(hiddenTags, format)}
                </span>
              )}
            </span>
          )}
        </span>
        <span className="flex flex-col items-end gap-1.5">
          <time
            dateTime={conversation.lastActivityAt}
            className="text-[11px] whitespace-nowrap text-muted-foreground tabular-nums"
            suppressHydrationWarning
          >
            {formatListTime(
              conversation.lastActivityAt,
              now,
              strings.timeYesterday,
              formatLocale,
              timeZone,
            )}
          </time>
          {unreadCount > 0 && (
            <span
              className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white tabular-nums"
              aria-label={strings.unreadCount(unreadCount, format)}
            >
              {unreadCount > 99 ? `${format.number(99)}+` : format.number(unreadCount)}
            </span>
          )}
          {assignee !== null && (
            <span title={assigneeName === null ? undefined : strings.assignedTo(assigneeName)}>
              <AssigneeAvatar
                id={assignee.id}
                name={assigneeName}
                avatarUrl={assignee.avatarUrl}
                size="xs"
              />
            </span>
          )}
          <WindowIndicator status={conversation.window} variant="compact" />
        </span>
      </button>
    </li>
  );
}

export interface ConversationListProps {
  conversations: InboxConversationView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Rows that arrived after mount; only these play the enter motion. */
  enteringIds?: ReadonlySet<string>;
  tab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  counts: InboxTabCounts | null;
  numbers: InboxNumberView[];
  /** The selected number, or `null` for every active number (or every number, see below). */
  accountId: string | null;
  /** "Show disconnected": with `accountId === null`, also conversations of disconnected numbers. */
  includeInactiveAccounts: boolean;
  onAccountChange: (accountId: string | null, includeInactiveAccounts: boolean) => void;
  search: string;
  onSearchChange: (search: string) => void;
  /** The tenant's tag catalog (filter chips). */
  tags: InboxTagView[];
  tagIds: string[];
  onTagIdsChange: (tagIds: string[]) => void;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  timeZone?: string;
  className?: string;
}

/**
 * The number filter: "All active numbers" (default), one number, or "Show disconnected" (every
 * number, connected or not). Disconnected numbers come last, after a separator.
 */
function NumberSelect({
  numbers,
  accountId,
  includeInactiveAccounts,
  onAccountChange,
}: Pick<
  ConversationListProps,
  "numbers" | "accountId" | "includeInactiveAccounts" | "onAccountChange"
>) {
  const strings = useInboxStrings();
  if (numbers.length === 0) return null;
  const active = numbers.filter((number) => number.active);
  const disconnected = numbers.filter((number) => !number.active);
  const only = numbers.length === 1 && disconnected.length === 0 ? numbers[0] : undefined;
  if (only !== undefined) {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-lg border px-2 py-1 text-xs text-muted-foreground"
        title={only.displayPhone}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            only.active ? "bg-emerald-500" : "bg-zinc-400",
          )}
          aria-hidden
        />
        <span className="truncate">
          {only.active ? only.label : strings.numberDisconnected(only.label)}
        </span>
      </span>
    );
  }
  const value = accountId ?? (includeInactiveAccounts ? SHOW_DISCONNECTED : ALL_NUMBERS);
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === ALL_NUMBERS) onAccountChange(null, false);
        else if (next === SHOW_DISCONNECTED) onAccountChange(null, true);
        else onAccountChange(next, false);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={strings.numberLabel}
        className="h-7 max-w-48 min-w-0 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-[color,background-color,border-color] hover:bg-accent active:bg-accent/70"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={ALL_NUMBERS}>{strings.numberAllActive}</SelectItem>
        {active.map((number) => (
          <SelectItem key={number.id} value={number.id}>
            {number.label}
          </SelectItem>
        ))}
        {disconnected.length > 0 && (
          <>
            <SelectSeparator />
            <SelectItem value={SHOW_DISCONNECTED}>{strings.numberShowDisconnected}</SelectItem>
            {disconnected.map((number) => (
              <SelectItem key={number.id} value={number.id}>
                {strings.numberDisconnected(number.label)}
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}

/**
 * The conversation list (mockup option A): number selector, search, status tabs with counts and
 * tag filter chips (any-match, server-side), then rows sorted by last activity.
 */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  enteringIds,
  tab,
  onTabChange,
  counts,
  numbers,
  accountId,
  includeInactiveAccounts,
  onAccountChange,
  search,
  onSearchChange,
  tags,
  tagIds,
  onTagIdsChange,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  timeZone = DEFAULT_INBOX_TIME_ZONE,
  className,
}: ConversationListProps) {
  const strings = useInboxStrings();
  const format = useInboxFormat();
  const now = useNow();
  const searchId = useId();
  const sorted = [...conversations].sort(
    (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
  );
  const filtered = search.trim() !== "" || tagIds.length > 0 || accountId !== null;
  const numberLabels = new Map(numbers.map((number) => [number.id, number.label]));
  const disconnectedLabel = (conversation: InboxConversationView): string | null => {
    if (conversation.accountActive) return null;
    const label = numberLabels.get(conversation.accountId);
    return label === undefined ? strings.flagDisconnected : strings.numberDisconnected(label);
  };

  return (
    <section
      className={cn("flex min-h-0 flex-col bg-background", className)}
      aria-label={strings.inboxTitle}
    >
      <div className="flex flex-col gap-2.5 px-4 pt-4 pb-2.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h1 className="text-[17px] font-semibold tracking-tight">{strings.inboxTitle}</h1>
          <NumberSelect
            numbers={numbers}
            accountId={accountId}
            includeInactiveAccounts={includeInactiveAccounts}
            onAccountChange={onAccountChange}
          />
        </div>
        <div className="flex h-9 items-center gap-2 rounded-lg border px-2.5 text-muted-foreground transition-[border-color] duration-[var(--sendo-dur-fast)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20 hover:border-ring">
          <SearchIcon className="size-4 shrink-0" aria-hidden />
          <label htmlFor={searchId} className="sr-only">
            {strings.searchLabel}
          </label>
          <input
            id={searchId}
            type="search"
            value={search}
            placeholder={strings.searchPlaceholder}
            onChange={(event) => {
              onSearchChange(event.target.value);
            }}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {search !== "" && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
              }}
              className="grid size-5 shrink-0 place-items-center rounded-full transition-colors hover:bg-accent hover:text-foreground active:bg-accent/70"
              aria-label={strings.searchClear}
            >
              <XIcon className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <div role="tablist" aria-label={strings.tabsLabel} className={cn(scrollRowClass, "gap-1")}>
          {INBOX_TABS.map((value) => {
            const active = value === tab;
            const count = counts?.[value];
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (!active) onTabChange(value);
                }}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] whitespace-nowrap outline-none transition-[color,background-color] duration-[var(--sendo-dur-fast)] focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/70",
                )}
              >
                {tabLabel(value, strings)}
                {count !== undefined && (
                  <span className="tabular-nums opacity-60">
                    {count > 999 ? `${format.number(999)}+` : format.number(count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {tags.length > 0 && (
          <div
            role="group"
            aria-label={strings.tagFilterLabel}
            className={cn(scrollRowClass, "gap-1.5 pb-0.5")}
          >
            {tags.map((tag) => (
              <TagFilterChip
                key={tag.id}
                tag={tag}
                pressed={tagIds.includes(tag.id)}
                onPressedChange={(pressed) => {
                  onTagIdsChange(
                    pressed ? [...tagIds, tag.id] : tagIds.filter((id) => id !== tag.id),
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status">
            <LoaderIcon className="size-4" aria-hidden />
            {strings.listLoading}
          </p>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-foreground">
            <InboxIcon className="size-6" aria-hidden />
            <p>{filtered ? strings.listEmptyFiltered : strings.listEmpty}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5 px-2 pt-1 pb-3">
            {sorted.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                disconnectedLabel={disconnectedLabel(conversation)}
                selected={conversation.id === selectedId}
                entering={enteringIds?.has(conversation.id) === true}
                now={now}
                timeZone={timeZone}
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
      </div>
    </section>
  );
}
