"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ManagerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Toolbar under the header (the "Nueva …" button). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The admin catalogs (snippets, tags) in the host's shadcn `Dialog`: header, toolbar and a
 * scrolling body. Its enter/exit is the host's (`tw-animate-css`), with the item's ease-out and
 * no scale under reduced motion (MOTION.md #9).
 */
export function ManagerSheet({
  open,
  onOpenChange,
  title,
  description,
  actions,
  children,
  className,
}: ManagerSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 ease-[var(--sendo-ease-out)] motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1] sm:max-w-xl",
          className,
        )}
      >
        <DialogHeader className="shrink-0 gap-1 border-b px-5 pt-5 pr-12 pb-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-pretty">{description}</DialogDescription>
          {actions !== undefined && <div className="mt-3 flex justify-start">{actions}</div>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "¿Eliminar …?" in place of a row's actions. */
export function ConfirmRow({
  text,
  confirmLabel,
  cancelLabel,
  pending,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  // Focus the safe choice; the row's own buttons are gone while it asks.
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-[13px]"
      role="alert"
    >
      <p className="min-w-0 flex-1 basis-48 text-pretty">{text}</p>
      <div className="ml-auto flex shrink-0 gap-2">
        <button
          ref={cancel}
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md px-2.5 py-1 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/70 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="rounded-md bg-destructive px-2.5 py-1 text-white outline-none transition-colors hover:bg-destructive/90 focus-visible:ring-[3px] focus-visible:ring-destructive/40 active:bg-destructive/80 disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
