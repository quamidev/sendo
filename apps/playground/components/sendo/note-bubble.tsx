"use client";

import { NotebookPenIcon } from "lucide-react";
import { personName, useInboxPeople } from "./people";
import { useInboxLocale, useInboxStrings } from "./strings-context";
import type { InboxMessageView } from "./types";
import { DEFAULT_INBOX_TIME_ZONE, formatClock } from "./utils";

export interface NoteBubbleProps {
  message: InboxMessageView;
  timeZone?: string;
}

/** An internal note (AC-IB-3): full width, dashed, never sent and never seen by the agent. */
export function NoteBubble({ message, timeZone = DEFAULT_INBOX_TIME_ZONE }: NoteBubbleProps) {
  const strings = useInboxStrings();
  const { formatLocale } = useInboxLocale();
  const people = useInboxPeople();
  const time = message.createdAt;
  return (
    <div className="mt-2 flex w-full flex-col" data-kind="note">
      <span className="mx-1 mb-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <NotebookPenIcon className="size-3 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {strings.noteLabel(personName(message.senderRef, people, strings))}
        </span>
        <span aria-hidden>·</span>
        <span>{strings.noteAudience}</span>
        <time dateTime={time} className="ml-auto tabular-nums" suppressHydrationWarning>
          {formatClock(time, formatLocale, timeZone)}
        </time>
      </span>
      <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground dark:border-amber-800 dark:bg-amber-950/40">
        {message.text}
      </p>
    </div>
  );
}
