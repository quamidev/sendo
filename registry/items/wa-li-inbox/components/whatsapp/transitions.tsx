"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Recipes from MOTION.md. Only `transform` and `opacity` move (plus colour on press);
// `wa-motion-transform` drops the transform under `prefers-reduced-motion` (motion.css),
// so reduced motion keeps the fades and removes the movement.

/** A conversation row that arrived after mount (realtime / refresh). */
export const enterRowClass =
  "wa-motion-transform transition-[transform,opacity] duration-[var(--wa-dur-menu)] ease-[var(--wa-ease-out)] starting:opacity-0 starting:[transform:translateY(4px)]";

/** A message bubble appended after the thread loaded (sent or received, never history). */
export const enterBubbleClass =
  "wa-motion-transform transition-[transform,opacity] duration-[var(--wa-dur-menu)] ease-[var(--wa-ease-out)] starting:opacity-0 starting:[transform:translateY(6px)]";

/** Composer ↔ template picker: the incoming one fades in place. */
export const swapInClass =
  "transition-[opacity] duration-[var(--wa-dur-menu)] ease-[var(--wa-ease-out)] starting:opacity-0";

/** Press feedback that starts on pointer-down; a CSS transition, so release retargets mid-flight. */
export const pressClass =
  "wa-motion-transform transition-[transform,color,background-color,border-color] duration-[var(--wa-dur-press)] ease-[var(--wa-ease-out)] active:[transform:scale(0.97)]";

const fadeLayerClass =
  "col-start-1 row-start-1 transition-[opacity] duration-[var(--wa-dur-fast)] ease-[var(--wa-ease-out)]";

/** Longer than `--wa-dur-fast`, so the outgoing layer is gone only after it faded. */
const LEAVE_CLEANUP_MS = 300;

export interface CrossFadeProps<T extends string> {
  value: T;
  render: (value: T) => ReactNode;
  className?: string;
}

/**
 * Cross-fades between states in place (status badge, delivery ticks). Nothing animates on mount;
 * only a later change of `value` fades the old state out and the new one in, both stacked in one
 * grid cell so nothing moves.
 */
export function CrossFade<T extends string>({ value, render, className }: CrossFadeProps<T>) {
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<T | null>(null);

  if (value !== shown) {
    setLeaving(shown);
    setShown(value);
  }

  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => {
      setLeaving(null);
    }, LEAVE_CLEANUP_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving]);

  const changing = leaving !== null && leaving !== value;
  return (
    <span className={cn("inline-grid shrink-0 items-center", className)} data-slot="cross-fade">
      {changing && (
        <span
          key={`out:${leaving}`}
          className={cn(fadeLayerClass, "pointer-events-none opacity-0 starting:opacity-100")}
          aria-hidden
          inert
        >
          {render(leaving)}
        </span>
      )}
      <span
        key={`in:${value}`}
        className={cn(fadeLayerClass, changing && "starting:opacity-0")}
        data-motion={changing ? "enter" : undefined}
      >
        {render(value)}
      </span>
    </span>
  );
}
