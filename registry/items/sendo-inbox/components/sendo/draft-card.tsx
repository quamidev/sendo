"use client";

import { BotIcon, CheckIcon, LoaderIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { agentName, useInboxPeople } from "./people";
import { useInboxStrings } from "./strings";
import { draftMotionClass, enterBubbleClass, leaveDraftClass, pressClass } from "./transitions";
import type { InboxMessageView } from "./types";
import { formatCostCents, useNow } from "./utils";
import { windowState } from "./window-indicator";

export type DraftActionResult = "ok" | "window_closed" | "failed";

/** Matches `--sendo-dur-menu`: the card is removed once its leave transition ran. */
export const DRAFT_LEAVE_MS = 200;

export interface DraftCardProps {
  draft: InboxMessageView;
  window: { open: boolean; expiresAt: string | null };
  /** The number is disconnected: nothing can be sent. */
  disconnected?: boolean;
  /** Admins see tokens and cost. */
  showUsage?: boolean;
  /** Arrived while the thread was open: rises in. */
  entering?: boolean;
  /** `text` is set when the operator edited the draft. */
  onApprove: (text: string | undefined) => Promise<DraftActionResult>;
  onDiscard: () => Promise<DraftActionResult>;
  /** Called after the leave transition of an approved or discarded draft. */
  onLeft: () => void;
}

/**
 * An agent reply waiting for approval (AC-IB-4, Flow E): **Descartar**, **Editar**,
 * **Aprobar y enviar**. Closed window → "La ventana cerró; usa una plantilla".
 */
export function DraftCard({
  draft,
  window,
  disconnected = false,
  showUsage = false,
  entering = false,
  onApprove,
  onDiscard,
  onLeft,
}: DraftCardProps) {
  const strings = useInboxStrings();
  const people = useInboxPeople();
  const now = useNow();
  const editorId = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text ?? "");
  const [pending, setPending] = useState<"approve" | "discard" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [forcedClosed, setForcedClosed] = useState(false);
  const closed = forcedClosed || windowState(window, now) === "closed";

  const latestOnLeft = useRef(onLeft);
  useEffect(() => {
    latestOnLeft.current = onLeft;
  }, [onLeft]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      latestOnLeft.current();
    }, DRAFT_LEAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving]);

  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);

  const agent = agentName(draft.senderRef, people, strings);
  const edited = editing && text.trim() !== (draft.text ?? "").trim();
  const busy = pending !== null || leaving;
  const canSend = !closed && !disconnected && !busy && text.trim() !== "";
  const usage =
    showUsage && (draft.tokensIn !== null || draft.costCents !== null)
      ? strings.draftUsage(
          draft.tokensIn,
          draft.tokensOut,
          draft.costCents === null ? null : formatCostCents(draft.costCents),
        )
      : null;

  async function run(kind: "approve" | "discard") {
    if (busy) return;
    setPending(kind);
    const result =
      kind === "approve" ? await onApprove(edited ? text.trim() : undefined) : await onDiscard();
    setPending(null);
    if (result === "ok") setLeaving(true);
    else if (result === "window_closed") setForcedClosed(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
      setText(draft.text ?? "");
    }
  }

  return (
    <section
      aria-label={strings.draftTitle(agent)}
      data-slot="draft-card"
      data-state={leaving ? "leaving" : closed ? "window-closed" : "pending"}
      data-motion={entering ? "enter" : undefined}
      className={cn(
        "mt-3 mb-1 ml-auto w-full max-w-[560px] overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50/70 to-background shadow-[0_6px_22px_-12px_rgba(43,89,195,0.35)] dark:border-blue-900 dark:from-blue-950/40 md:w-[82%]",
        draftMotionClass,
        entering && enterBubbleClass,
        leaving && leaveDraftClass,
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-dashed border-blue-200 px-3 py-2 text-[13px] text-blue-800 dark:border-blue-900 dark:text-blue-300">
        <BotIcon className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          <b className="font-semibold">{strings.draftTitle(agent)}</b> · {strings.draftAwaiting}
        </span>
        {draft.handoffAfterDraft && (
          <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {strings.draftBeforeHandoff}
          </span>
        )}
        {usage !== null && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{usage}</span>
        )}
      </header>
      {editing ? (
        <div className="p-2">
          <label htmlFor={editorId} className="sr-only">
            {strings.draftEditLabel}
          </label>
          <Textarea
            ref={editor}
            id={editorId}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={onKeyDown}
            disabled={busy}
            rows={3}
            className="max-h-60 min-h-20 resize-none bg-background text-sm leading-relaxed"
          />
        </div>
      ) : (
        <p className="px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap">
          {draft.text}
        </p>
      )}
      {(closed || disconnected) && (
        <p className="mx-3 mb-1 text-xs text-amber-800 dark:text-amber-300" role="status">
          {disconnected ? strings.draftDisconnected : strings.draftWindowClosed}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 px-3 pt-1 pb-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void run("discard");
          }}
          className={cn("active:bg-accent/70", pressClass)}
        >
          {pending === "discard" && <LoaderIcon aria-hidden />}
          {strings.draftDiscard}
        </Button>
        {editing ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setText(draft.text ?? "");
            }}
            className={cn("active:bg-accent/70", pressClass)}
          >
            {strings.draftCancelEdit}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || closed || disconnected}
            onClick={() => {
              setEditing(true);
            }}
            className={cn("active:bg-accent/70", pressClass)}
          >
            {strings.draftEdit}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          disabled={!canSend}
          onClick={() => {
            void run("approve");
          }}
          className={cn("active:bg-primary/80", pressClass)}
        >
          {pending === "approve" ? <LoaderIcon aria-hidden /> : <CheckIcon aria-hidden />}
          {edited ? strings.draftSendEdited : strings.draftApprove}
        </Button>
      </div>
    </section>
  );
}
