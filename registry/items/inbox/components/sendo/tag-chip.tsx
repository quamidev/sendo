"use client";

import type { TagColor } from "@quami/sendo";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings-context";
import type { InboxTagView } from "./types";

/** The fixed tag palette (`TAG_COLORS`) as dot colours. */
export const TAG_DOT_CLASS: Record<TagColor, string> = {
  gray: "bg-zinc-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-sky-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

const chipBase =
  "inline-flex h-6 max-w-40 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs whitespace-nowrap";

function Dot({ color }: { color: TagColor }) {
  return (
    <span className={cn("size-1.5 shrink-0 rounded-full", TAG_DOT_CLASS[color])} aria-hidden />
  );
}

function Name({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate">{children}</span>;
}

export interface TagChipProps {
  tag: InboxTagView;
  /** Smaller, for list rows. */
  size?: "sm" | "md";
  /** Shows an × that calls it (tag picker, SND-3.6). */
  onRemove?: () => void;
  className?: string;
}

/** A tag on a conversation. */
export function TagChip({ tag, size = "md", onRemove, className }: TagChipProps) {
  const strings = useInboxStrings();
  return (
    <span
      className={cn(
        chipBase,
        "border-border bg-background text-foreground/80",
        size === "sm" && "h-5 px-1.5 text-[11px]",
        className,
      )}
      title={tag.name}
      data-tag-id={tag.id}
    >
      <Dot color={tag.color} />
      <Name>{tag.name}</Name>
      {onRemove !== undefined && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-1 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent/70"
          aria-label={strings.tagRemove(tag.name)}
        >
          <XIcon className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

export interface TagFilterChipProps {
  tag: InboxTagView;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  className?: string;
}

/** A toggle in the list's tag filter (any-match, AC-TG-3). */
export function TagFilterChip({ tag, pressed, onPressedChange, className }: TagFilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => {
        onPressedChange(!pressed);
      }}
      title={tag.name}
      className={cn(
        chipBase,
        "outline-none transition-[color,background-color,border-color] duration-[var(--sendo-dur-fast)] focus-visible:ring-[3px] focus-visible:ring-ring/50",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground/80 hover:border-ring hover:bg-accent active:bg-accent/70",
        className,
      )}
    >
      <Dot color={tag.color} />
      <Name>{tag.name}</Name>
    </button>
  );
}
