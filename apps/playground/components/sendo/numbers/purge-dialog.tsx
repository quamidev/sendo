"use client";

import { LoaderCircle, X } from "lucide-react";
import { useId, useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { pressClass } from "./connect-button";
import { useNumbersStrings } from "./strings-context";
import { phoneDigits, type NumberView } from "./types";

export interface PurgeDialogProps {
  number: NumberView | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves `true` when the history was deleted (the dialog closes). */
  onConfirm: (number: NumberView, confirmation: string) => Promise<boolean>;
}

/**
 * "Delete history" of a disconnected number (`allowPurge`): asks for the full number (digits
 * compared, so spaces and `+` don't matter) before `sendo.accounts.purge`. Same dialog motion as
 * the disconnect dialog (MOTION.md #5).
 */
export function PurgeDialog({ number, onOpenChange, onConfirm }: PurgeDialogProps) {
  const strings = useNumbersStrings();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [pending, setPending] = useState(false);
  const phone = number?.displayPhone ?? "";
  const expected = phoneDigits(phone);
  const typed = phoneDigits(value);

  function change(open: boolean) {
    if (pending) return;
    if (!open) {
      setValue("");
      setMismatch(false);
    }
    onOpenChange(open);
  }

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (number === null || pending) return;
    if (typed !== expected) {
      setMismatch(true);
      return;
    }
    setPending(true);
    const done = await onConfirm(number, value.trim());
    setPending(false);
    if (done) {
      setValue("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={number !== null} onOpenChange={change}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]"
      >
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="break-words [overflow-wrap:anywhere]">
              {strings.purgeTitle(number?.label ?? phone)}
            </DialogTitle>
            <DialogDescription>{strings.purgeDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium [overflow-wrap:anywhere]">
              {strings.purgeConfirmLabel(phone)}
            </label>
            <Input
              id={inputId}
              inputMode="tel"
              autoComplete="off"
              maxLength={32}
              value={value}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setValue(event.target.value.replace(/[^\d\s+()-]/g, ""));
                setMismatch(false);
              }}
              className="font-mono tabular-nums"
              autoFocus
            />
            {mismatch ? (
              <p id={`${inputId}-error`} className="text-destructive text-sm">
                {strings.purgeMismatch}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className={pressClass}
              disabled={pending}
              onClick={() => {
                change(false);
              }}
            >
              {strings.cancel}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              className={pressClass}
              disabled={pending || typed.length !== expected.length}
            >
              {pending ? (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : null}
              {pending ? strings.purging : strings.purgeConfirm}
            </Button>
          </DialogFooter>
        </form>
        <DialogClose className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <X aria-hidden />
          <span className="sr-only">{strings.close}</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
