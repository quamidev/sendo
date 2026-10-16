"use client";

import type { InboxSystemLine, SystemEventName } from "@quami/sendo";
import {
  BotIcon,
  CheckIcon,
  ChevronsUpIcon,
  InfoIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  SignpostIcon,
  SlidersHorizontalIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { actorName, useInboxPeople, type InboxPeople } from "./people";
import type { InboxStrings, InboxSystemEventNames } from "./strings";
import { useInboxFormat, useInboxLocale, useInboxStrings } from "./strings-context";
import type { InboxMessageView } from "./types";
import { DEFAULT_INBOX_TIME_ZONE, formatClock } from "./utils";

/** One icon per `SystemEventName` (the type flags a new event without one). */
const EVENT_ICON: Record<SystemEventName, ReactNode> = {
  handoff: <UserIcon aria-hidden />,
  assigned: <UserIcon aria-hidden />,
  unassigned: <UserIcon aria-hidden />,
  returned: <BotIcon aria-hidden />,
  closed: <CheckIcon aria-hidden />,
  agent_paused: <PauseIcon aria-hidden />,
  agent_resumed: <PlayIcon aria-hidden />,
  routed: <SignpostIcon aria-hidden />,
  after_hours: <MoonIcon aria-hidden />,
  escalated: <ChevronsUpIcon aria-hidden />,
};

function iconOf(line: InboxSystemLine | null): ReactNode {
  const icons: Partial<Record<string, ReactNode>> = EVENT_ICON;
  const icon = line?.event == null ? undefined : icons[line.event];
  if (icon !== undefined) return icon;
  if (line?.kind === "rule") return <SlidersHorizontalIcon aria-hidden />;
  return <InfoIcon aria-hidden />;
}

function param(line: InboxSystemLine, key: string): string | null {
  const value = line.params[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Display names for `strings.systemEvent`: today's name of a team member (or the one stored with
 * the line), the agent's display name, "Sendo", the phone app.
 */
export function systemEventNames(
  line: InboxSystemLine,
  people: InboxPeople,
  strings: InboxStrings,
): InboxSystemEventNames {
  const by = line.by;
  const isUser = by !== null && !/^(agent:|rule:)|^(system|business_app)$/.test(by);
  const byName =
    by === null
      ? null
      : isUser
        ? (people.names[by] ?? param(line, "byName"))
        : actorName(by, people, strings);
  const assignedTo = param(line, "assignedTo");
  const assignee =
    assignedTo === null
      ? null
      : (people.names[assignedTo] ?? param(line, "assignedToName") ?? strings.actorPerson);
  return { by: byName, assignee };
}

export interface SystemLineProps {
  message: InboxMessageView;
  timeZone?: string;
}

/** What happened to the conversation (handoff, assignment, pause, rules), centred in the thread. */
export function SystemLine({ message, timeZone = DEFAULT_INBOX_TIME_ZONE }: SystemLineProps) {
  const strings = useInboxStrings();
  const format = useInboxFormat();
  const { formatLocale } = useInboxLocale();
  const people = useInboxPeople();
  const line = message.systemLine;
  // Unknown and legacy events (`null`) keep the text stored with the line.
  const text =
    (line === null
      ? null
      : strings.systemEvent(line, systemEventNames(line, people, strings), format)) ?? message.text;
  return (
    <p
      className="mx-auto my-2 flex max-w-[85%] items-start justify-center gap-1.5 text-center text-xs text-pretty text-muted-foreground [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0"
      data-kind={line?.kind ?? "system"}
      data-event={line?.event ?? undefined}
      title={formatClock(message.createdAt, formatLocale, timeZone)}
    >
      {iconOf(line)}
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

/** `dayToday`, `dayYesterday` or the full date between messages of different days. */
export function DaySeparator({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("my-2 flex justify-center", className)} role="separator">
      <span className="rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
