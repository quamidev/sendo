"use client";

import {
  BotIcon,
  CheckIcon,
  InfoIcon,
  PauseIcon,
  PlayIcon,
  QrCodeIcon,
  SlidersHorizontalIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { InboxMessageView } from "./types";
import { DEFAULT_INBOX_TIME_ZONE, formatClock } from "./utils";

const EVENT_ICON: Record<string, ReactNode> = {
  handoff: <UserIcon aria-hidden />,
  assigned: <UserIcon aria-hidden />,
  taken: <UserIcon aria-hidden />,
  unassigned: <UserIcon aria-hidden />,
  returned: <BotIcon aria-hidden />,
  closed: <CheckIcon aria-hidden />,
  agent_paused: <PauseIcon aria-hidden />,
  agent_resumed: <PlayIcon aria-hidden />,
  source: <QrCodeIcon aria-hidden />,
};

function iconOf(message: InboxMessageView): ReactNode {
  const line = message.systemLine;
  const event = line?.event ?? null;
  if (event !== null && event in EVENT_ICON) return EVENT_ICON[event];
  if (line?.kind === "rule") return <SlidersHorizontalIcon aria-hidden />;
  return <InfoIcon aria-hidden />;
}

export interface SystemLineProps {
  message: InboxMessageView;
  timeZone?: string;
}

/** What happened to the conversation (handoff, assignment, pause, rules), centred in the thread. */
export function SystemLine({ message, timeZone = DEFAULT_INBOX_TIME_ZONE }: SystemLineProps) {
  return (
    <p
      className="mx-auto my-2 flex max-w-[85%] items-start justify-center gap-1.5 text-center text-xs text-pretty text-muted-foreground [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0"
      data-kind={message.systemLine?.kind ?? "system"}
      data-event={message.systemLine?.event ?? undefined}
      title={formatClock(message.createdAt, timeZone)}
    >
      {iconOf(message)}
      <span className="min-w-0 break-words">{message.text}</span>
    </p>
  );
}

/** "Hoy", "Ayer", "Lunes 6 de octubre" between messages of different days. */
export function DaySeparator({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("my-2 flex justify-center", className)} role="separator">
      <span className="rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
