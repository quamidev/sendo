"use client";

import { useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SendoLocale } from "@/lib/sendo-ui";
import { cn } from "@/lib/utils";
import { fadeSwapClass, pressClass } from "./press";
import { SendoQrCode } from "./qr-code";
import type { WidgetsLocaleProps } from "./strings";
import { useWidgetsStrings, WidgetsStringsProvider } from "./strings-context";
import {
  LINK_TEXT_MAX,
  SOURCE_PATTERN,
  toSourceSlug,
  type LinksActions,
  type WidgetLinkView,
  type WidgetNumberView,
} from "./types";

const DEBOUNCE_MS = 250;
const COPIED_MS = 1600;

export interface LinkDraft {
  account: string;
  text: string;
  source: string;
}

export interface LinkBuilderHandle {
  /** Puts `source` in the form and regenerates the link (the sources table's `useSource`). */
  applySource(source: string): void;
}

export interface LinkBuilderProps extends WidgetsLocaleProps {
  numbers: WidgetNumberView[];
  actions: Pick<LinksActions, "createLink">;
  initialDraft: LinkDraft;
  /** The link for `initialDraft`, created on the server so the first paint already has it. */
  initialLink: WidgetLinkView | null;
  ref?: Ref<LinkBuilderHandle>;
  className?: string;
}

export function numberLabel(number: WidgetNumberView): string {
  return number.label ? `${number.label} · ${number.displayPhone}` : number.displayPhone;
}

/** The message and the source a link was built from (`text` = message + " " + code). */
export function linkParts(link: WidgetLinkView): { message: string; source: string } {
  return {
    message: link.text.slice(0, link.text.length - link.code.length).trim(),
    source: link.code.slice(2, -1),
  };
}

/** The `<SendoChatBubble />` line for a link (valid JSX for any text), in the screen's language. */
function bubbleSnippet(link: WidgetLinkView, locale: SendoLocale): string {
  const { message, source } = linkParts(link);
  const attribute = (name: string, value: string) =>
    /["\\\n{}]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
  const parts = [attribute("locale", locale), attribute("phone", link.phone)];
  if (message !== "") parts.push(attribute("text", message));
  parts.push(attribute("source", source));
  return `<SendoChatBubble ${parts.join(" ")} />`;
}

function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const strings = useWidgetsStrings();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("shrink-0", pressClass, className)}
      onClick={() => {
        if (timer.current) clearTimeout(timer.current);
        void navigator.clipboard.writeText(value).then(
          () => {
            setState("copied");
          },
          () => {
            setState("failed");
          },
        );
        timer.current = setTimeout(() => {
          setState("idle");
        }, COPIED_MS);
      }}
    >
      <span className="grid" aria-live="polite">
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center gap-1.5",
            fadeSwapClass,
            state !== "idle" && "opacity-0",
          )}
          aria-hidden={state !== "idle"}
        >
          <Copy aria-hidden />
          {label}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 inline-flex items-center gap-1.5",
            fadeSwapClass,
            state === "idle" && "opacity-0",
          )}
          aria-hidden={state === "idle"}
        >
          <Check aria-hidden className={state === "copied" ? "text-emerald-600" : "hidden"} />
          {state === "failed" ? strings.copyFailed : strings.copied}
        </span>
      </span>
    </Button>
  );
}

/**
 * Pick a number, write the prefilled text and a source label: get the `wa.me` link (with the
 * visible `[#source]` code), a copy button, the QR with PNG / SVG downloads and the chat bubble
 * snippet. Every link comes from `sendo.links.create` through the `createLink` action. Renders in
 * `locale`.
 */
export function LinkBuilder({ locale, formatLocale, strings, ...props }: LinkBuilderProps) {
  return (
    <WidgetsStringsProvider locale={locale} formatLocale={formatLocale} strings={strings}>
      <LinkBuilderView {...props} language={{ locale, formatLocale, strings }} />
    </WidgetsStringsProvider>
  );
}

function LinkBuilderView({
  numbers,
  actions,
  initialDraft,
  initialLink,
  ref,
  className,
  language,
}: Omit<LinkBuilderProps, keyof WidgetsLocaleProps> & { language: WidgetsLocaleProps }) {
  const strings = useWidgetsStrings();
  const ids = useId();
  const [draft, setDraft] = useState<LinkDraft>(initialDraft);
  const [link, setLink] = useState<WidgetLinkView | null>(initialLink);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  const [sourceTouched, setSourceTouched] = useState(false);
  // Empty before the admin typed anything is "not yet", not an error.
  const sourceValid = SOURCE_PATTERN.test(draft.source) || (!sourceTouched && draft.source === "");

  function update(patch: Partial<LinkDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    request.current += 1;
    if (!SOURCE_PATTERN.test(next.source) || next.account === "") {
      setPending(false);
      setLink(null);
      setError(null);
      return;
    }
    const id = request.current;
    setPending(true);
    timer.current = setTimeout(() => {
      void actions
        .createLink(next)
        .catch(() => ({ ok: false as const, code: "UNKNOWN" as const }))
        .then((result) => {
          if (id !== request.current) return;
          setPending(false);
          if (result.ok) {
            setLink(result.data);
            setError(null);
          } else {
            setError(
              result.code === "UNKNOWN" ? strings.previewError : strings.errorMessages[result.code],
            );
          }
        });
    }, DEBOUNCE_MS);
  }

  useImperativeHandle(ref, () => ({
    applySource(source: string) {
      update({ source: toSourceSlug(source) });
    },
  }));

  const selected = numbers.find((number) => number.id === draft.account);

  return (
    <div
      className={cn(
        "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]",
        className,
      )}
    >
      <section className="flex min-w-0 flex-col gap-5 rounded-xl border bg-background p-5">
        <h2 className="text-[11.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {strings.builderTitle}
        </h2>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-number`} className="text-sm font-medium">
            {strings.numberLabel}
          </label>
          <Select
            value={draft.account}
            onValueChange={(account) => {
              update({ account });
            }}
          >
            <SelectTrigger id={`${ids}-number`} className="w-full min-w-0">
              <SelectValue placeholder={strings.numberPlaceholder}>
                {selected ? <span className="truncate">{numberLabel(selected)}</span> : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {numbers.map((number) => (
                <SelectItem key={number.id} value={number.id}>
                  <span className="truncate">{numberLabel(number)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-text`} className="text-sm font-medium">
            {strings.textLabel}
          </label>
          <Textarea
            id={`${ids}-text`}
            value={draft.text}
            maxLength={LINK_TEXT_MAX}
            rows={3}
            placeholder={strings.textPlaceholder}
            aria-describedby={`${ids}-text-hint`}
            className="resize-none [overflow-wrap:anywhere]"
            onChange={(event) => {
              update({ text: event.target.value });
            }}
          />
          <p
            id={`${ids}-text-hint`}
            className="flex justify-between gap-4 text-xs text-muted-foreground"
          >
            <span>{strings.textHint}</span>
            <span className="shrink-0 tabular-nums">
              {draft.text.length}/{LINK_TEXT_MAX}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-source`} className="text-sm font-medium">
            {strings.sourceLabel}
          </label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-sm text-muted-foreground"
            >
              [#
            </span>
            <Input
              id={`${ids}-source`}
              value={draft.source}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
              placeholder={strings.sourcePlaceholder}
              aria-invalid={!sourceValid}
              aria-describedby={`${ids}-source-hint`}
              className="pr-7 pl-8 font-mono"
              onChange={(event) => {
                setSourceTouched(true);
                update({ source: toSourceSlug(event.target.value) });
              }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-sm text-muted-foreground"
            >
              ]
            </span>
          </div>
          <p
            id={`${ids}-source-hint`}
            className={cn("text-xs", sourceValid ? "text-muted-foreground" : "text-destructive")}
          >
            {sourceValid ? strings.sourceHint : strings.sourceInvalid}
          </p>
        </div>
      </section>

      <section
        aria-busy={pending}
        aria-label={strings.previewTitle}
        className="flex min-w-0 flex-col gap-5 rounded-xl border bg-background p-5"
      >
        <h2 className="text-[11.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          {strings.previewTitle}
        </h2>

        {link === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <QrCode aria-hidden className="size-8 opacity-40" />
            <p className="max-w-56">{error ?? strings.previewEmpty}</p>
          </div>
        ) : (
          <div className={cn("flex flex-col gap-5", fadeSwapClass, pending && "opacity-60")}>
            <SendoQrCode
              value={link.url}
              label={strings.qrLabel(linkParts(link).source)}
              fileName={`whatsapp-${linkParts(link).source}`}
              {...language}
            />

            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">{strings.messagePreviewLabel}</span>
              <p className="self-start rounded-[14px] rounded-bl-[5px] border bg-background px-3 py-2 text-sm leading-[1.45] whitespace-pre-wrap [overflow-wrap:anywhere]">
                {linkParts(link).message !== "" && `${linkParts(link).message} `}
                <span className="rounded-md bg-violet-50 px-1.5 py-px font-mono text-[12px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                  {link.code}
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">{strings.linkLabel}</span>
              <div className="flex min-w-0 items-center gap-2">
                <code
                  title={link.url}
                  className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs"
                >
                  {link.url}
                </code>
                <CopyButton value={link.url} label={strings.copy} />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4">
              <span className="text-sm font-medium">{strings.bubbleTitle}</span>
              <p className="text-xs text-muted-foreground">{strings.bubbleHint}</p>
              <code className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs [overflow-wrap:anywhere]">
                {bubbleSnippet(link, language.locale)}
              </code>
              <CopyButton
                value={bubbleSnippet(link, language.locale)}
                label={strings.copyCode}
                className="self-start"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
