"use client";

import { ClockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings";
import { formatCountdown, useNow } from "./utils";

/** Below this the countdown turns to the destructive colour. */
export const WINDOW_WARNING_MS = 60 * 60_000;

export interface WindowIndicatorProps {
  status: { open: boolean; expiresAt: string | null };
  className?: string;
}

export type WindowState = "open" | "closing" | "closed";

export function windowState(status: WindowIndicatorProps["status"], now: number): WindowState {
  if (status.expiresAt === null) return "closed";
  const remaining = new Date(status.expiresAt).getTime() - now;
  if (remaining <= 0) return "closed";
  return remaining <= WINDOW_WARNING_MS ? "closing" : "open";
}

/** The 24-hour customer service window with an `hh:mm` countdown. Only the colour changes. */
export function WindowIndicator({ status, className }: WindowIndicatorProps) {
  const strings = useInboxStrings();
  const now = useNow();
  const state = windowState(status, now);
  const label =
    state === "closed"
      ? status.expiresAt === null
        ? strings.windowNeverOpened
        : strings.windowClosed
      : strings.windowOpen(
          status.expiresAt === null ? "00:00" : formatCountdown(status.expiresAt, now),
        );

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums transition-colors",
        state === "open" && "border-border text-foreground",
        state === "closing" && "border-destructive/40 text-destructive",
        state === "closed" && "border-dashed text-muted-foreground",
        className,
      )}
      data-state={state}
      suppressHydrationWarning
    >
      <ClockIcon className="size-3.5 shrink-0" aria-hidden />
      <span suppressHydrationWarning>{label}</span>
    </span>
  );
}
