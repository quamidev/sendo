"use client";

import type { ConversationStatus } from "@quami/sendo";
import {
  BotIcon,
  FileTextIcon,
  InfoIcon,
  NotebookPenIcon,
  PaperclipIcon,
  SendIcon,
  UserIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MotionSheet } from "./motion-sheet";
import { personName, useInboxPeople } from "./people";
import { SnippetPicker, snippetOptionId } from "./snippet-picker";
import { findSnippetVariables, searchSnippets, SNIPPET_VARIABLE } from "@quami/sendo/snippets";
import { useInboxFormat, useInboxStrings } from "./strings-context";
import { TemplatePicker, type TemplateSendInput } from "./template-picker";
import type {
  InboxActionResult,
  InboxRenderedSnippet,
  InboxReplyInput,
  InboxSnippetView,
  InboxTemplateView,
} from "./types";
import { pressClass, swapInClass } from "./transitions";
import { useIsDesktop, useNow } from "./utils";
import { WindowIndicator, windowState } from "./window-indicator";

export type ComposerSendResult = "sent" | "window_closed" | "failed";

export type ComposerMode = "reply" | "note";

export interface ComposerProps {
  /** The conversation's 24-hour window. Closed → replies only through a template. */
  window: { open: boolean; expiresAt: string | null };
  onSend: (input: InboxReplyInput) => Promise<ComposerSendResult>;
  listTemplates: () => Promise<InboxActionResult<InboxTemplateView[]>>;
  /** Picks the reply hint: while `agent`, a reply is a step-in and the agent stays in charge. */
  status?: ConversationStatus;
  /** Saves an internal note. Omit to hide the Responder / Nota interna switch. */
  onNote?: (text: string) => Promise<ComposerSendResult>;
  /** Snippets usable on this conversation. Omit to hide the `/` picker and the zap button. */
  listSnippets?: () => Promise<InboxActionResult<InboxSnippetView[]>>;
  /** Fills a snippet's variables for this conversation; without it the body is inserted as is. */
  renderSnippet?: (snippetId: string) => Promise<InboxActionResult<InboxRenderedSnippet>>;
  disabled?: boolean;
  className?: string;
}

const FIRST_VARIABLE = /\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/;

/** The `/query` being typed at the caret: at the start of the text or after a space. */
export function slashToken(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(text.slice(0, caret));
  if (match === null) return null;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, query };
}

/** The text with every `{{variable}}` wrapped in a mark (the textarea's highlight layer). */
function highlightVariables(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(SNIPPET_VARIABLE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <mark
        key={match.index}
        className="rounded-[3px] bg-amber-200/80 text-transparent shadow-[0_0_0_1.5px_var(--color-amber-300)] dark:bg-amber-500/30 dark:shadow-[0_0_0_1.5px_var(--color-amber-700)]"
      >
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

const MODES: readonly ComposerMode[] = ["reply", "note"];

/**
 * Responder / Nota interna. The pill has a fixed width (half the control) and only moves with
 * `transform` (MOTION.md #20); under reduced motion it jumps and the label colours still fade.
 */
function ModeSwitch({
  mode,
  onChange,
  disabled,
}: {
  mode: ComposerMode;
  onChange: (mode: ComposerMode) => void;
  disabled: boolean;
}) {
  const strings = useInboxStrings();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const next: ComposerMode =
      event.key === "Home"
        ? "reply"
        : event.key === "End"
          ? "note"
          : mode === "reply"
            ? "note"
            : "reply";
    onChange(next);
    buttons.current[MODES.indexOf(next)]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={strings.composerModeLabel}
      onKeyDown={onKeyDown}
      className="relative grid shrink-0 grid-cols-2 rounded-lg bg-muted p-0.5"
      data-slot="composer-mode"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-background shadow-[0_1px_2px_rgb(0_0_0/0.08)] transition-transform duration-[var(--sendo-dur-menu)] ease-[var(--sendo-ease-in-out)] motion-reduce:transition-none dark:bg-input/60",
          mode === "note" && "[transform:translateX(100%)]",
        )}
        data-slot="composer-mode-pill"
      />
      {MODES.map((value, index) => (
        <button
          key={value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={mode === value}
          tabIndex={mode === value ? 0 : -1}
          disabled={disabled}
          onClick={() => {
            onChange(value);
          }}
          className="relative z-10 rounded-md px-2.5 py-1 text-[12.5px] whitespace-nowrap text-muted-foreground outline-none transition-colors duration-[var(--sendo-dur-fast)] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-checked:text-foreground"
        >
          {value === "reply" ? strings.composerModeReply : strings.composerModeNote}
        </button>
      ))}
    </div>
  );
}

/**
 * Closed window (Flow D 8): the "Ventana de 24 h cerrada" bar; "Plantilla" opens the approved
 * templates (in place on desktop, in a sheet on phones).
 */
function TemplateBar({
  listTemplates,
  onSend,
  explain,
  className,
}: {
  listTemplates: ComposerProps["listTemplates"];
  onSend: ComposerProps["onSend"];
  /** The window closed under the operator (a send failed): announce it and open the picker. */
  explain: boolean;
  className?: string;
}) {
  const strings = useInboxStrings();
  const isDesktop = useIsDesktop();
  const pickerId = useId();
  const [templates, setTemplates] = useState<InboxTemplateView[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(explain);

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
    if (result === "sent") setOpen(false);
    return result === "sent";
  }

  const picker = (
    <TemplatePicker templates={templates} loadFailed={loadFailed} onSend={send} hideExplanation />
  );

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border border-dashed px-3 py-2.5 text-[13px] text-muted-foreground"
        role={explain ? "status" : undefined}
        data-slot="window-closed-bar"
      >
        <FileTextIcon className="size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 basis-48 text-pretty">
          <b className="font-semibold text-foreground">{strings.windowClosedBarTitle}</b>{" "}
          {strings.windowClosedBarText}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("ml-auto shrink-0 active:bg-accent/70", pressClass)}
          aria-expanded={open}
          aria-controls={isDesktop && open ? pickerId : undefined}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          <FileTextIcon aria-hidden />
          {strings.composerTemplateButton}
        </Button>
      </div>
      {isDesktop ? (
        open && <div id={pickerId}>{picker}</div>
      ) : (
        <MotionSheet
          open={open}
          onOpenChange={setOpen}
          title={strings.templateChoose}
          description={strings.templateExplanation}
        >
          {picker}
        </MotionSheet>
      )}
    </div>
  );
}

/** Shared by the textarea and its highlight layer, so both wrap the text identically. */
const fieldTextClass =
  "min-h-6 w-full py-1 text-base leading-6 break-words whitespace-pre-wrap [scrollbar-gutter:stable] md:text-sm";

/**
 * The composer (mockup option A): Responder / Nota interna, the mode hint, `/` snippets with
 * unresolved variables highlighted (sending is blocked until they are filled or removed), and the
 * template-only bar once the window closed.
 */
export function Composer({
  window,
  onSend,
  listTemplates,
  status = "human",
  onNote,
  listSnippets,
  renderSnippet,
  disabled = false,
  className,
}: ComposerProps) {
  const strings = useInboxStrings();
  const format = useInboxFormat();
  const people = useInboxPeople();
  const now = useNow();
  const inputId = useId();
  const listId = useId();
  const warningId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlights = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ComposerMode>("reply");
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  // A send can fail with WINDOW_CLOSED before the countdown reaches zero (clock skew, Meta).
  const [forcedClosed, setForcedClosed] = useState(false);
  const [snippets, setSnippets] = useState<InboxSnippetView[] | null>(null);
  const [snippetsFailed, setSnippetsFailed] = useState(false);
  /** Start of the `/token` the operator closed with Escape (it stays closed for that token). */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [inserting, setInserting] = useState(false);
  /** Selection to apply once React committed the new text (after an insert). */
  const pendingSelection = useRef<[number, number] | null>(null);
  const latestText = useRef(text);
  useLayoutEffect(() => {
    latestText.current = text;
  }, [text]);

  const noteMode = onNote !== undefined && mode === "note";
  const closed = forcedClosed || windowState(window, now) === "closed";
  const templateOnly = closed && !noteMode;

  // Text box ↔ template bar cross-fade in place, but only when it switches while on screen.
  const [shownTemplateOnly, setShownTemplateOnly] = useState(templateOnly);
  const [swapped, setSwapped] = useState(false);
  if (templateOnly !== shownTemplateOnly) {
    setShownTemplateOnly(templateOnly);
    setSwapped(true);
  }
  const swap = swapped ? swapInClass : undefined;

  const snippetsEnabled = listSnippets !== undefined && !noteMode;
  const token = snippetsEnabled ? slashToken(text, caret) : null;
  const pickerOpen = token !== null && token.start !== dismissedAt && !disabled;
  const results = snippets === null ? null : searchSnippets(snippets, token?.query ?? "");
  const resultCount = results?.length ?? 0;

  // The active option goes back to the best match whenever the query changes.
  const [shownQuery, setShownQuery] = useState<string | null>(null);
  const query = pickerOpen ? token.query : null;
  if (query !== shownQuery) {
    setShownQuery(query);
    setActiveIndex(0);
  }
  const active = Math.min(activeIndex, Math.max(resultCount - 1, 0));

  // Reload on every open: the team may have edited the catalog (stale list shown meanwhile).
  useEffect(() => {
    if (!pickerOpen || listSnippets === undefined) return;
    let current = true;
    void listSnippets().then(
      (result) => {
        if (!current) return;
        setSnippetsFailed(!result.ok);
        if (result.ok) setSnippets(result.data);
      },
      () => {
        if (current) setSnippetsFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [pickerOpen, listSnippets]);

  /** The highlight layer scrolls with the textarea (the textarea scrolls past 10 lines). */
  function syncHighlights() {
    if (highlights.current !== null && textarea.current !== null) {
      highlights.current.scrollTop = textarea.current.scrollTop;
    }
  }

  useLayoutEffect(() => {
    syncHighlights();
    const selection = pendingSelection.current;
    const element = textarea.current;
    if (selection === null || element === null) return;
    pendingSelection.current = null;
    element.focus();
    element.setSelectionRange(selection[0], selection[1]);
    setCaret(selection[1]);
  }, [text]);

  const unresolved = noteMode ? [] : findSnippetVariables(text);
  const canSend =
    !disabled &&
    !sending &&
    !inserting &&
    unresolved.length === 0 &&
    (text.trim() !== "" || (!noteMode && file !== null));

  function changeText(value: string, selection: [number, number]) {
    pendingSelection.current = selection;
    if (value === latestText.current) {
      // Same text (no commit to wait for): place the caret now.
      pendingSelection.current = null;
      textarea.current?.focus();
      textarea.current?.setSelectionRange(selection[0], selection[1]);
      setCaret(selection[1]);
      return;
    }
    setText(value);
  }

  async function insert(snippet: InboxSnippetView) {
    if (token === null || inserting) return;
    const { start } = token;
    const end = start + 1 + token.query.length;
    let body = snippet.body;
    if (renderSnippet !== undefined) {
      setInserting(true);
      const result = await renderSnippet(snippet.id).catch(() => null);
      setInserting(false);
      if (result === null || !result.ok) {
        toast.error(
          strings.snippetRenderFailed,
          result === null ? undefined : { description: result.message },
        );
        return;
      }
      body = result.data.text;
    }
    const current = latestText.current;
    // The operator may have kept typing while it rendered: replace the token only if it's still there.
    const [from, to] =
      current.slice(start, end) === `/${token.query}`
        ? [start, end]
        : [current.length, current.length];
    const next = current.slice(0, from) + body + current.slice(to);
    // Select the first unresolved variable, so typing replaces it.
    const variable = FIRST_VARIABLE.exec(body);
    const selection: [number, number] =
      variable === null
        ? [from + body.length, from + body.length]
        : [from + variable.index, from + variable.index + variable[0].length];
    setDismissedAt(null);
    changeText(next, selection);
  }

  function openPicker() {
    const element = textarea.current;
    const at = element?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const prefix = before === "" || /\s$/.test(before) ? "/" : " /";
    setDismissedAt(null);
    changeText(before + prefix + text.slice(at), [at + prefix.length, at + prefix.length]);
  }

  async function submit() {
    if (!canSend) return;
    const body = text.trim();
    if (noteMode) {
      setSending(true);
      setText("");
      const result = await onNote(body);
      setSending(false);
      if (result !== "sent") setText(text);
      return;
    }
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
    if (event.nativeEvent.isComposing) return;
    if (pickerOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (resultCount === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((active + step + resultCount) % resultCount);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(token.start);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey)) {
        const snippet = results?.[active];
        if (snippet !== undefined) {
          event.preventDefault();
          void insert(snippet);
          return;
        }
        if (event.key === "Enter") {
          // Nothing to insert: close the picker instead of sending "/…".
          event.preventDefault();
          setDismissedAt(token.start);
          return;
        }
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submit();
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  const youName = personName(people.currentUserId, people, strings);
  const hint = noteMode
    ? { icon: <NotebookPenIcon aria-hidden />, text: strings.composerHintNote }
    : templateOnly
      ? null
      : status === "agent"
        ? { icon: <BotIcon aria-hidden />, text: strings.composerHintStepIn }
        : { icon: <UserIcon aria-hidden />, text: strings.composerHintHuman(youName) };

  const modeRow = (onNote !== undefined || hint !== null) && (
    <div className="mb-2 flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
      {onNote !== undefined && (
        <ModeSwitch
          mode={mode}
          disabled={disabled}
          onChange={(next) => {
            setMode(next);
            if (!closed || next === "note") {
              requestAnimationFrame(() => textarea.current?.focus());
            }
          }}
        />
      )}
      {hint !== null && (
        <span className="flex min-w-0 items-center gap-1.5 [&>svg]:size-3.5 [&>svg]:shrink-0">
          {hint.icon}
          <span className="truncate" title={hint.text}>
            {hint.text}
          </span>
        </span>
      )}
      <WindowIndicator status={window} className="ml-auto hidden shrink-0 sm:inline-flex" />
    </div>
  );

  return (
    <div
      className={cn("relative border-t bg-background px-3 pt-2.5 pb-3 md:px-4", className)}
      data-slot="composer"
      data-mode={templateOnly ? "template" : noteMode ? "note" : "text"}
    >
      {snippetsEnabled && !templateOnly && (
        <SnippetPicker
          id={listId}
          open={pickerOpen}
          results={results}
          loadFailed={snippetsFailed}
          activeIndex={active}
          onActiveIndexChange={setActiveIndex}
          onPick={(snippet) => {
            void insert(snippet);
          }}
        />
      )}
      {modeRow}
      {templateOnly ? (
        <TemplateBar
          listTemplates={listTemplates}
          onSend={onSend}
          explain={forcedClosed}
          className={swap}
        />
      ) : (
        <form className={cn("flex flex-col", swap)} onSubmit={onSubmit}>
          {file !== null && !noteMode && (
            <div className="mb-2 flex max-w-full items-center gap-2 self-start rounded-md border bg-muted/50 py-1 pr-1 pl-2 text-xs">
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
          <div
            className={cn(
              "flex items-end gap-1 rounded-xl border py-1 pr-1 pl-3 transition-[border-color,background-color] duration-[var(--sendo-dur-fast)] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/20",
              noteMode &&
                "border-amber-300 bg-amber-50 focus-within:border-amber-400 focus-within:ring-amber-300/30 dark:border-amber-800 dark:bg-amber-950/40",
              disabled && "opacity-60",
            )}
            data-slot="composer-box"
          >
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
            <label htmlFor={inputId} className="sr-only">
              {strings.composerLabel}
            </label>
            <div className="relative min-w-0 flex-1 self-center py-0.5">
              <div
                ref={highlights}
                aria-hidden
                className={cn(
                  fieldTextClass,
                  "pointer-events-none absolute inset-x-0 top-0.5 bottom-0.5 overflow-hidden text-transparent",
                )}
                data-slot="composer-highlights"
              >
                {noteMode ? text : highlightVariables(text)}
                {"​"}
              </div>
              <textarea
                ref={textarea}
                id={inputId}
                value={text}
                rows={1}
                placeholder={
                  noteMode ? strings.composerPlaceholderNote : strings.composerPlaceholderReply
                }
                disabled={disabled}
                aria-describedby={unresolved.length > 0 ? warningId : undefined}
                aria-invalid={unresolved.length > 0 || undefined}
                aria-controls={pickerOpen ? listId : undefined}
                aria-autocomplete={snippetsEnabled ? "list" : undefined}
                aria-activedescendant={
                  pickerOpen && resultCount > 0 ? snippetOptionId(listId, active) : undefined
                }
                onChange={(event) => {
                  setText(event.target.value);
                  setCaret(event.target.selectionStart);
                  if (
                    dismissedAt !== null &&
                    slashToken(event.target.value, event.target.selectionStart)?.start !==
                      dismissedAt
                  ) {
                    setDismissedAt(null);
                  }
                }}
                onSelect={(event) => {
                  setCaret(event.currentTarget.selectionStart);
                }}
                onBlur={() => {
                  if (token !== null) setDismissedAt(token.start);
                }}
                onFocus={() => {
                  setDismissedAt(null);
                }}
                onKeyDown={onKeyDown}
                onScroll={syncHighlights}
                className={cn(
                  fieldTextClass,
                  "relative block max-h-40 resize-none overflow-y-auto bg-transparent text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground disabled:cursor-not-allowed",
                )}
              />
            </div>
            {snippetsEnabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("shrink-0 text-muted-foreground active:bg-accent/70", pressClass)}
                aria-label={strings.snippetPickerOpen}
                title={strings.snippetPickerOpen}
                disabled={disabled}
                onClick={openPicker}
              >
                <ZapIcon aria-hidden />
              </Button>
            )}
            {!noteMode && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn("shrink-0 text-muted-foreground active:bg-accent/70", pressClass)}
                aria-label={strings.attach}
                title={strings.attach}
                disabled={disabled}
                onClick={() => fileInput.current?.click()}
              >
                <PaperclipIcon aria-hidden />
              </Button>
            )}
            <Button
              type="submit"
              size="icon"
              className={cn("shrink-0 active:bg-primary/80", pressClass)}
              aria-label={sending ? strings.sending : strings.send}
              aria-describedby={unresolved.length > 0 ? warningId : undefined}
              disabled={!canSend}
            >
              <SendIcon aria-hidden />
            </Button>
          </div>
          {unresolved.length > 0 && (
            <p
              id={warningId}
              className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 transition-opacity duration-[var(--sendo-dur-fast)] ease-[var(--sendo-ease-out)] starting:opacity-0 dark:text-amber-400"
              role="status"
              data-slot="composer-unresolved"
            >
              <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {strings.snippetUnresolved(unresolved, format)}
              </span>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
