"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { InlineMenu, InlineMenuItem } from "./inline-menu";
import { useInboxStrings } from "./strings";
import { TAG_DOT_CLASS, TagChip } from "./tag-chip";
import type { InboxTagView } from "./types";

export interface TagPickerProps {
  /** The conversation's tags. */
  tags: readonly InboxTagView[];
  /** The tenant's catalog; the menu offers the tags the conversation doesn't have yet. */
  catalog: readonly InboxTagView[];
  /** Resolve `true` when the change was saved. */
  onAdd: (tagId: string) => Promise<boolean>;
  onRemove: (tagId: string) => Promise<boolean>;
  className?: string;
}

/** Tags of a conversation in the context panel (AC-TG-2): × removes one, "+ Etiqueta" adds. */
export function TagPicker({ tags, catalog, onAdd, onRemove, className }: TagPickerProps) {
  const strings = useInboxStrings();
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const current = new Set(tags.map((tag) => tag.id));
  const available = catalog.filter((tag) => !current.has(tag.id));

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  async function add(tagId: string) {
    setPending(true);
    const saved = await onAdd(tagId);
    setPending(false);
    if (saved) close();
  }

  async function remove(tagId: string) {
    setPending(true);
    await onRemove(tagId);
    setPending(false);
    // The chip that had focus is gone.
    trigger.current?.focus();
  }

  return (
    <div className={cn("flex flex-col", className)} data-slot="tag-picker">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            onRemove={
              pending
                ? undefined
                : () => {
                    void remove(tag.id);
                  }
            }
          />
        ))}
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-haspopup="menu"
          disabled={pending && !open}
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="inline-flex h-6 shrink-0 items-center rounded-full border border-dashed px-2 text-xs whitespace-nowrap text-muted-foreground outline-none transition-[color,background-color,border-color] duration-[var(--sendo-dur-fast)] hover:border-ring hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/70 disabled:opacity-50 aria-expanded:border-ring aria-expanded:text-foreground"
        >
          {strings.tagAdd}
        </button>
      </div>
      <InlineMenu id={menuId} label={strings.sectionTags} open={open} onClose={close}>
        {available.length === 0 ? (
          <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">
            {catalog.length === 0 ? strings.tagsCatalogEmpty : strings.tagMenuEmpty}
          </p>
        ) : (
          available.map((tag) => (
            <InlineMenuItem
              key={tag.id}
              disabled={pending}
              title={tag.name}
              onSelect={() => {
                void add(tag.id);
              }}
            >
              <span
                className={cn("size-2 shrink-0 rounded-full", TAG_DOT_CLASS[tag.color])}
                aria-hidden
              />
              <span className="min-w-0 truncate">{tag.name}</span>
            </InlineMenuItem>
          ))
        )}
      </InlineMenu>
    </div>
  );
}
