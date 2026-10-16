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
import { lastDigits, type NumberView } from "./types";

export interface DisconnectDialogProps {
  number: NumberView | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves `true` when the number was disconnected (the dialog closes). */
  onConfirm: (number: NumberView, confirmation: string) => Promise<boolean>;
}

/** Asks for the last 4 digits before disconnecting; explains that history stays readable. */
export function DisconnectDialog({ number, onOpenChange, onConfirm }: DisconnectDialogProps) {
  const strings = useNumbersStrings();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [pending, setPending] = useState(false);
  const digits = number === null ? "" : lastDigits(number.displayPhone);
  const phone = number?.label ?? number?.displayPhone ?? "";

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
    if (value.trim() !== digits) {
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
              {strings.disconnectTitle(phone)}
            </DialogTitle>
            <DialogDescription>{strings.disconnectDescription}</DialogDescription>
            <p className="text-sm text-muted-foreground">{strings.disconnectExportHint}</p>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              {strings.disconnectConfirmLabel(digits)}
            </label>
            <Input
              id={inputId}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={value}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setValue(event.target.value.replace(/\D/g, "").slice(0, 4));
                setMismatch(false);
              }}
              className="font-mono tracking-[0.3em] tabular-nums"
              autoFocus
            />
            {mismatch ? (
              <p id={`${inputId}-error`} className="text-destructive text-sm">
                {strings.disconnectMismatch}
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
              disabled={pending || value.length !== 4}
            >
              {pending ? (
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : null}
              {pending ? strings.disconnecting : strings.disconnectConfirm}
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
