"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings";
import type { InboxSnippetView } from "./types";

/**
 * Picker enter/exit (MOTION.md #19): rises from the composer's bottom-left corner. It stays
 * mounted, so opening and closing are one CSS transition that retargets mid-flight.
 */
const pickerMotionClass =
  "sendo-motion-transform origin-bottom-left transition-[transform,opacity] duration-[var(--sendo-dur-menu)] ease-[var(--sendo-ease-out)]";

export function snippetOptionId(listId: string, index: number): string {
  return `${listId}-option-${String(index)}`;
}

export interface SnippetPickerProps {
  /** The listbox id (the composer's textarea points at it with `aria-controls`). */
  id: string;
  open: boolean;
  /** Search results, best match first; `null` while the first load runs. */
  results: readonly InboxSnippetView[] | null;
  loadFailed?: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (snippet: InboxSnippetView) => void;
  className?: string;
}

/**
 * The `/` snippet picker above the composer (AC-SN-2). The textarea keeps focus: arrows move the
 * active option (`aria-activedescendant`), Enter or Tab inserts it, Escape closes.
 */
export function SnippetPicker({
  id,
  open,
  results,
  loadFailed = false,
  activeIndex,
  onActiveIndexChange,
  onPick,
  className,
}: SnippetPickerProps) {
  const strings = useInboxStrings();

  useEffect(() => {
    if (!open) return;
    document.getElementById(snippetOptionId(id, activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [id, open, activeIndex]);

  return (
    <div
      className={cn(
        "absolute inset-x-3 bottom-full z-20 mb-1 flex max-h-[min(20rem,50dvh)] flex-col overflow-hidden rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-[0_16px_40px_-16px_rgb(0_0_0/0.25)] md:inset-x-4",
        pickerMotionClass,
        open
          ? "opacity-100"
          : "pointer-events-none opacity-0 [transform:translateY(6px)_scale(0.98)]",
        className,
      )}
      inert={!open}
      data-state={open ? "open" : "closed"}
      data-slot="snippet-picker"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-2 py-1.5 text-[11.5px] text-muted-foreground">
        <span>{strings.snippetPickerTitle}</span>
        <span className="hidden truncate md:inline">{strings.snippetPickerKeys}</span>
      </div>
      {results === null ? (
        <p
          className="px-2 py-2 text-[12.5px] text-muted-foreground"
          role={open ? "status" : undefined}
        >
          {loadFailed ? strings.loadFailed : strings.loadingOlder}
        </p>
      ) : results.length === 0 ? (
        <p
          className="px-2 py-2 text-[12.5px] text-muted-foreground"
          role={open ? "status" : undefined}
        >
          {strings.snippetPickerEmpty}
        </p>
      ) : null}
      <ul
        id={id}
        role="listbox"
        aria-label={strings.snippetPickerTitle}
        className="min-h-0 overflow-y-auto overscroll-contain"
      >
        {(results ?? []).map((snippet, index) => (
          <li
            key={snippet.id}
            id={snippetOptionId(id, index)}
            role="option"
            aria-selected={index === activeIndex}
            // Keep focus (and the caret) in the textarea.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onMouseMove={() => {
              if (index !== activeIndex) onActiveIndexChange(index);
            }}
            onClick={() => {
              onPick(snippet);
            }}
            className="cursor-pointer rounded-lg px-2.5 py-2 transition-colors duration-[var(--sendo-dur-fast)] aria-selected:bg-accent"
          >
            <span className="flex min-w-0 items-baseline gap-3">
              <b className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                /{snippet.shortcut}
              </b>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {snippet.visibility === "personal"
                  ? strings.snippetScopePersonal
                  : strings.snippetScopeTenant}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
              {snippet.body}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
