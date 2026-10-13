"use client";

import { ArrowUpIcon, Building2Icon, RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";
import {
  DEMO_SESSION_LIMIT,
  DEMO_TEXT_MAX_LENGTH,
  type DemoFallbackReason,
  type DemoTurn,
} from "@/lib/demo/protocol";
import { demo as demoDictionary } from "@/lib/i18n/dictionaries/demo";
import type { Lang } from "@/lib/i18n/langs";

// The visitor's side of the demo: a WhatsApp-like chat with the building's number, in the page
// language (the agent greets in it, then follows the visitor's language).

const TIME_FORMATS: Record<Lang, Intl.DateTimeFormat> = {
  es: new Intl.DateTimeFormat("es-GT", { hour: "2-digit", minute: "2-digit", hour12: false }),
  en: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }),
};

function time(at: string, lang: Lang): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : TIME_FORMATS[lang].format(date);
}

function fill(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Plain text with its URLs as links (the fallback points at the code). */
function Linkified({ text }: { text: string }) {
  return text.split(URL_RE).map((part, index) =>
    index % 2 === 1 ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="rounded-sm [overflow-wrap:anywhere] text-[#027eb5] underline underline-offset-2 outline-none hover:text-[#02648f] focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:text-[#53bdeb] dark:hover:text-[#8ad3f4]"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** MOTION.md #1: messages added while the page is open fade and rise in (not the restored ones). */
const ENTER =
  "transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] starting:opacity-0 starting:[transform:translateY(6px)] motion-reduce:starting:[transform:none]";

/** MOTION.md #2: press feedback on the chat's buttons. */
const PRESS =
  "transition-[transform] duration-[120ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:[transform:scale(0.97)] motion-reduce:active:[transform:none]";

function Bubble({
  turn,
  label,
  enter,
  lang,
}: {
  turn: DemoTurn;
  label?: string;
  enter: boolean;
  lang: Lang;
}) {
  const mine = turn.role === "contact";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start", enter && ENTER)}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13.5px] leading-snug shadow-[0_1px_0.5px_rgb(0_0_0/0.13)]",
          mine
            ? "rounded-tr-sm bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]"
            : "rounded-tl-sm bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]",
        )}
      >
        {label !== undefined && (
          <p className="mb-0.5 text-[11px] font-medium text-[#1f7aec] dark:text-[#53bdeb]">
            {label}
          </p>
        )}
        <p className="break-words whitespace-pre-wrap">
          <Linkified text={turn.text} />
          <span className="float-right mt-1.5 ml-2 text-[10.5px] text-[#667781] tabular-nums dark:text-[#8696a0]">
            {time(turn.at, lang)}
          </span>
        </p>
      </div>
    </div>
  );
}

export interface DemoChatProps {
  /** The page language: every string of the chat. */
  lang: Lang;
  transcript: DemoTurn[];
  /** Leading turns restored from the session: shown without the enter motion. */
  restored: number;
  pending: boolean;
  remaining: number;
  fallback: DemoFallbackReason | null;
  error: string | null;
  onSend(text: string): void;
  onReset(): void;
  className?: string;
}

export function DemoChat({
  lang,
  transcript,
  restored,
  pending,
  remaining,
  fallback,
  error,
  onSend,
  onReset,
  className,
}: DemoChatProps) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scroller.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [transcript.length, pending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || pending) return;
    onSend(text);
    setDraft("");
  }

  const t = demoDictionary[lang].chat;
  const empty = transcript.length === 0;
  const note =
    fallback === null ? null : fill(t.fallbackNotes[fallback], { limit: DEMO_SESSION_LIMIT });

  return (
    <section
      aria-label={t.label}
      data-testid="demo-chat"
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card", className)}
    >
      <header className="flex items-center gap-3 border-b bg-[#f0f2f5] px-3 py-2.5 dark:bg-[#202c33]">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#1fa855] text-white">
          <Building2Icon aria-hidden className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={t.contactName}>
            {t.contactName}
          </p>
          <p className="truncate text-xs text-muted-foreground" aria-live="polite">
            {pending ? t.typing : t.contactStatus}
          </p>
        </div>
        {!empty && (
          <button
            type="button"
            onClick={onReset}
            disabled={pending}
            aria-label={t.reset}
            title={t.reset}
            className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none hover:bg-black/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-black/10 disabled:opacity-50 dark:hover:bg-white/10 dark:active:bg-white/15"
          >
            <RotateCcwIcon aria-hidden className="size-4" />
          </button>
        )}
      </header>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto bg-[#efeae2] px-3 py-3 dark:bg-[#0b141a]"
        role="log"
        aria-label={t.messagesLabel}
      >
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-[16rem] rounded-lg bg-[#fff5c4] px-3 py-2 text-xs text-[#54656f] dark:bg-[#182229] dark:text-[#8696a0]">
              {t.emptyIntro}
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {t.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    onSend(suggestion);
                  }}
                  className={cn(
                    PRESS,
                    "rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#111b21] outline-none hover:bg-[#f5f6f6] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-[#e9edef] disabled:opacity-50 dark:border-white/10 dark:bg-[#202c33] dark:text-[#e9edef] dark:hover:bg-[#2a3942] dark:active:bg-[#33444f]",
                  )}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {transcript.map((turn, index) =>
              turn.role === "handoff" ? (
                <li key={`${String(index)}-${turn.at}`} className="flex flex-col gap-1.5">
                  <p className="mx-auto rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-[#54656f] dark:bg-[#182229] dark:text-[#8696a0]">
                    {t.handoffLine}
                  </p>
                  <Bubble
                    turn={{ ...turn, text: demoDictionary[lang].agent.handoffMessage }}
                    enter={index >= restored}
                    lang={lang}
                  />
                </li>
              ) : (
                <li key={`${String(index)}-${turn.at}`}>
                  <Bubble
                    turn={turn}
                    label={turn.role === "team" ? t.teamLabel : undefined}
                    enter={index >= restored}
                    lang={lang}
                  />
                </li>
              ),
            )}
            {pending && (
              <li className={cn("flex justify-start", ENTER)} aria-hidden>
                <span className="rounded-lg rounded-tl-sm bg-white px-3 py-2 text-xs text-[#667781] dark:bg-[#202c33] dark:text-[#8696a0]">
                  {t.typing}
                </span>
              </li>
            )}
          </ol>
        )}
      </div>

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t bg-[#f0f2f5] p-2 dark:bg-[#202c33]"
      >
        <label htmlFor="demo-chat-input" className="sr-only">
          {t.inputLabel}
        </label>
        <input
          id="demo-chat-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          maxLength={DEMO_TEXT_MAX_LENGTH}
          autoComplete="off"
          placeholder={t.placeholder}
          className="h-9 min-w-0 flex-1 rounded-lg bg-white px-3 text-sm text-[#111b21] outline-none placeholder:text-[#667781] focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
        />
        <button
          type="submit"
          disabled={pending || draft.trim() === ""}
          aria-label={t.send}
          className={cn(
            PRESS,
            "grid size-9 shrink-0 place-items-center rounded-full bg-[#1fa855] text-white outline-none hover:bg-[#1a9049] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-[#167d3f] disabled:opacity-50 disabled:active:[transform:none]",
          )}
        >
          <ArrowUpIcon aria-hidden className="size-4" />
        </button>
      </form>
      {(error !== null || note !== null || remaining <= 5) && (
        <p
          className={cn(
            "border-t px-3 py-1.5 text-[11.5px]",
            error === null ? "text-muted-foreground" : "text-destructive",
          )}
          role={error === null ? undefined : "alert"}
          data-testid={error === null && note !== null ? "demo-chat-note" : undefined}
          data-fallback={error === null ? (fallback ?? undefined) : undefined}
        >
          {error ??
            note ??
            (remaining === 1 ? t.remainingOne : fill(t.remainingMany, { count: remaining }))}
        </p>
      )}
    </section>
  );
}
