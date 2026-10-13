"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Menu enter (MOTION.md #21): drops 4 px from its trigger and fades in; leaves instantly. */
const menuEnterClass =
  "sendo-motion-transform transition-[transform,opacity] duration-[var(--sendo-dur-menu)] ease-[var(--sendo-ease-out)] starting:opacity-0 starting:[transform:translateY(-4px)]";

const ITEM_SELECTOR = "[role^='menuitem']:not([disabled])";

export interface InlineMenuProps {
  id: string;
  label: string;
  open: boolean;
  /** Escape; the caller moves focus back to its trigger. */
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A small menu that opens in place under its trigger (tag picker, assign menu in the context
 * panel). Focus moves to the first item; arrows, Home and End move between items; Escape closes.
 */
export function InlineMenu({ id, label, open, onClose, children, className }: InlineMenuProps) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const items = [...(menu.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  if (!open) return null;
  return (
    <div
      ref={menu}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "mt-2 flex max-h-64 flex-col overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-sm",
        menuEnterClass,
        className,
      )}
      data-slot="inline-menu"
    >
      {children}
    </div>
  );
}

export interface InlineMenuItemProps {
  onSelect: () => void;
  disabled?: boolean;
  /** Marks the current choice (assign menu). */
  checked?: boolean;
  title?: string;
  children: ReactNode;
}

export function InlineMenuItem({
  onSelect,
  disabled = false,
  checked,
  title,
  children,
}: InlineMenuItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      tabIndex={-1}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className="flex w-full min-w-0 shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none transition-colors duration-[var(--sendo-dur-fast)] hover:bg-accent focus-visible:bg-accent active:bg-accent/70 disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}
