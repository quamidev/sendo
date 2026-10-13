"use client";

import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings";
import { remainingParts, useNow } from "./utils";

/** Below this the remaining time turns amber (AC-IB-7). */
export const WINDOW_WARNING_MS = 2 * 60 * 60_000;

export interface WindowIndicatorProps {
  status: { open: boolean; expiresAt: string | null };
  /** `compact` (list rows) uses the short "never opened" label. */
  variant?: "default" | "compact";
  className?: string;
}

export type WindowState = "open" | "closing" | "closed";
/** `never`: the contact never wrote, so the window never opened. */
export type WindowDisplayState = WindowState | "never";

/** Free-form messages are allowed unless `closed` (a window that never opened is closed too). */
export function windowState(status: WindowIndicatorProps["status"], now: number): WindowState {
  const display = windowDisplayState(status, now);
  return display === "never" ? "closed" : display;
}

export function windowDisplayState(
  status: WindowIndicatorProps["status"],
  now: number,
): WindowDisplayState {
  if (status.expiresAt === null) return "never";
  const remaining = new Date(status.expiresAt).getTime() - now;
  if (remaining <= 0) return "closed";
  return remaining <= WINDOW_WARNING_MS ? "closing" : "open";
}

/**
 * The 24-hour customer service window: remaining time (amber under 2 h), "Solo plantillas" once
 * closed, "El contacto no ha escrito" when it never opened. Only the colour changes.
 */
export function WindowIndicator({ status, variant = "default", className }: WindowIndicatorProps) {
  const strings = useInboxStrings();
  const now = useNow();
  const state = windowDisplayState(status, now);
  let label: string;
  if (state === "never") {
    label = variant === "compact" ? strings.windowNeverOpenedShort : strings.windowNeverOpened;
  } else if (state === "closed" || status.expiresAt === null) {
    label = strings.windowClosed;
  } else {
    const { hours, minutes } = remainingParts(status.expiresAt, now);
    label = strings.windowRemaining(hours, minutes);
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap tabular-nums transition-colors",
        state === "open" && "text-muted-foreground",
        state === "closing" && "text-amber-700 dark:text-amber-400",
        (state === "closed" || state === "never") && "text-muted-foreground",
        className,
      )}
      data-state={state}
      title={strings.windowLabel}
      suppressHydrationWarning
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full transition-colors",
          state === "open" && "bg-emerald-500",
          state === "closing" && "bg-amber-500",
          (state === "closed" || state === "never") && "bg-zinc-400",
        )}
        aria-hidden
      />
      <span suppressHydrationWarning>{label}</span>
    </span>
  );
}
