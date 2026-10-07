"use client";

import { PaperclipIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type SyntheticEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings";
import { TemplatePicker, type TemplateSendInput } from "./template-picker";
import type { InboxActionResult, InboxReplyInput, InboxTemplateView } from "./types";
import { useIsDesktop, useNow } from "./utils";
import { windowState } from "./window-indicator";

export type ComposerSendResult = "sent" | "window_closed" | "failed";

export interface ComposerProps {
  /** The conversation's 24-hour window. Closed → only the template picker. */
  window: { open: boolean; expiresAt: string | null };
  onSend: (input: InboxReplyInput) => Promise<ComposerSendResult>;
  listTemplates: () => Promise<InboxActionResult<InboxTemplateView[]>>;
  disabled?: boolean;
  className?: string;
}

function TemplateComposer({
  listTemplates,
  onSend,
  explain,
}: {
  listTemplates: ComposerProps["listTemplates"];
  onSend: ComposerProps["onSend"];
  explain: boolean;
}) {
  const strings = useInboxStrings();
  const isDesktop = useIsDesktop();
  const [templates, setTemplates] = useState<InboxTemplateView[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void listTemplates().then(
      (result) => {
        if (!active) return;
        if (result.ok) setTemplates(result.data);
        else setLoadFailed(true);
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [listTemplates]);

  async function send(input: TemplateSendInput): Promise<boolean> {
    const result = await onSend({ kind: "template", ...input });
    if (result === "sent") setSheetOpen(false);
    return result === "sent";
  }

  const picker = (
    <TemplatePicker templates={templates} loadFailed={loadFailed} onSend={send} hideExplanation />
  );

  return (
    <div className="flex flex-col gap-3" data-slot="composer" data-mode="template">
      <p
        className={cn("text-sm text-pretty", explain ? "text-foreground" : "text-muted-foreground")}
        role={explain ? "status" : undefined}
      >
        {strings.templateExplanation}
      </p>
      {isDesktop ? (
        picker
      ) : (
        <>
          <Button
            type="button"
            className="w-full transition-colors active:bg-primary/80"
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            <SendIcon aria-hidden />
            {strings.templateOpen}
          </Button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
              <SheetHeader>
                <SheetTitle>{strings.templateChoose}</SheetTitle>
                <SheetDescription>{strings.templateExplanation}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">{picker}</div>
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}

/** Text and attachments while the window is open; only the template picker once it closed. */
export function Composer({
  window,
  onSend,
  listTemplates,
  disabled = false,
  className,
}: ComposerProps) {
  const strings = useInboxStrings();
  const now = useNow();
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  // A send can fail with WINDOW_CLOSED before the countdown reaches zero (clock skew, Meta).
  const [forcedClosed, setForcedClosed] = useState(false);

  const closed = forcedClosed || windowState(window, now) === "closed";
  if (closed) {
    return (
      <div className={cn("border-t bg-background p-3 md:p-4", className)}>
        <TemplateComposer listTemplates={listTemplates} onSend={onSend} explain={forcedClosed} />
      </div>
    );
  }

  const canSend = !disabled && !sending && (text.trim() !== "" || file !== null);

  async function submit() {
    if (!canSend) return;
    const body = text.trim();
    const input: InboxReplyInput =
      file === null
        ? { kind: "text", body }
        : body === ""
          ? { kind: "media", file }
          : { kind: "media", file, caption: body };
    setSending(true);
    setText("");
    setFile(null);
    const result = await onSend(input);
    setSending(false);
    if (result === "sent") return;
    // Keep the draft so nothing typed is lost.
    setText(text);
    setFile(file);
    if (result === "window_closed") setForcedClosed(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  return (
    <form
      className={cn("flex flex-col gap-2 border-t bg-background p-3 md:p-4", className)}
      onSubmit={onSubmit}
      data-slot="composer"
      data-mode="text"
    >
      {file !== null && (
        <div className="flex max-w-full items-center gap-2 self-start rounded-md border bg-muted/50 py-1 pr-1 pl-2 text-xs">
          <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="max-w-56 truncate">{file.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="transition-colors active:bg-accent/70"
            aria-label={strings.removeAttachment}
            onClick={() => {
              setFile(null);
            }}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 transition-colors active:bg-accent/70"
          aria-label={strings.attach}
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          <PaperclipIcon aria-hidden />
        </Button>
        <label htmlFor={inputId} className="sr-only">
          {strings.composerLabel}
        </label>
        <Textarea
          id={inputId}
          value={text}
          placeholder={strings.composerPlaceholder}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-9 resize-none py-2"
        />
        <Button
          type="submit"
          size="icon"
          className="shrink-0 transition-colors active:bg-primary/80"
          aria-label={sending ? strings.sending : strings.send}
          disabled={!canSend}
        >
          <SendIcon aria-hidden />
        </Button>
      </div>
    </form>
  );
}
