"use client";

import { AlertCircle, ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";
import { cn } from "@/lib/utils";
import { totalOf } from "./format";
import { pressClass } from "./press";
import type { BroadcastsStrings } from "./strings";
import {
  BroadcastsStringsProvider,
  useBroadcastsFormat,
  useBroadcastsStrings,
} from "./strings-context";
import {
  BILLING_PAUSE,
  RECIPIENT_STATUS_ORDER,
  type BroadcastNumberView,
  type BroadcastStatusValue,
  type RecipientCounts,
  type RecipientStatus,
} from "./types";

const STATUS_TONE: Record<BroadcastStatusValue, string> = {
  queued: "bg-muted text-muted-foreground",
  sending: "bg-[#eef4ff] text-[#2b59c3] dark:bg-[#2b59c3]/20 dark:text-[#9fb7ee]",
  paused: "bg-[#fef3c7] text-[#92400e] dark:bg-[#f59e0b]/15 dark:text-[#fbbf24]",
  done: "bg-[#ecfdf3] text-[#067647] dark:bg-[#1fa855]/15 dark:text-[#6ee7a0]",
  cancelled: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

export function BroadcastStatusBadge({
  status,
  pauseReason,
  className,
}: {
  status: BroadcastStatusValue;
  pauseReason: string | null;
  className?: string;
}) {
  const strings = useBroadcastsStrings();
  const label =
    status === "paused" && pauseReason === BILLING_PAUSE
      ? strings.pausedBilling
      : strings.statusLabels[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap",
        STATUS_TONE[status],
        className,
      )}
    >
      {status === "sending" && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {label}
    </span>
  );
}

/**
 * Recipient states as an ordinal blue ramp for what went out (sent → delivered → read), status
 * colours for failed (critical) and skipped (warning), greys for cancelled and pending. Never
 * colour alone: the legend always shows the label and the count next to the swatch.
 */
export const RECIPIENT_COLOR: Record<RecipientStatus, string> = {
  pending: "bg-zinc-200 dark:bg-zinc-700",
  sent: "bg-[#86b6ef]",
  delivered: "bg-[#2a78d6]",
  read: "bg-[#184f95] dark:bg-[#3987e5]",
  failed: "bg-[#d03b3b]",
  skipped: "bg-[#fab219]",
  cancelled: "bg-zinc-400 dark:bg-zinc-500",
};

const RECIPIENT_TONE: Record<RecipientStatus, string> = {
  pending: "text-muted-foreground",
  sent: "text-foreground",
  delivered: "text-foreground",
  read: "text-foreground",
  failed: "text-destructive",
  skipped: "text-[#92400e] dark:text-[#fbbf24]",
  cancelled: "text-muted-foreground",
};

export function RecipientStatusLabel({ status }: { status: RecipientStatus }) {
  const strings = useBroadcastsStrings();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap",
        RECIPIENT_TONE[status],
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", RECIPIENT_COLOR[status])} aria-hidden />
      {strings.recipientStatusLabels[status]}
    </span>
  );
}

/**
 * One stacked bar of every recipient by state (segments in `RECIPIENT_STATUS_ORDER` without
 * pending, which is the track). Widths follow the counts; they are not animated.
 */
export function ProgressBar({
  counts,
  className,
}: {
  counts: RecipientCounts;
  className?: string;
}) {
  const strings = useBroadcastsStrings();
  const format = useBroadcastsFormat();
  const total = totalOf(counts);
  const segments = RECIPIENT_STATUS_ORDER.filter(
    (status) => status !== "pending" && counts[status] > 0,
  );
  return (
    <div
      role="img"
      aria-label={strings.processed(total - counts.pending, total, format)}
      className={cn(
        "flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700",
        className,
      )}
    >
      {total > 0 &&
        segments.map((status) => (
          <span
            key={status}
            title={`${strings.recipientStatusLabels[status]}: ${format.number(counts[status])}`}
            className={cn("h-full min-w-[3px] first:rounded-l-full", RECIPIENT_COLOR[status])}
            style={{ width: `${String((counts[status] / total) * 100)}%` }}
          />
        ))}
    </div>
  );
}

/**
 * The legend of the bar, doubling as the recipients filter: "All" plus every state with its
 * count. States with no recipients are hidden (except while selected).
 */
export function CountsFilter({
  counts,
  selected,
  onSelect,
}: {
  counts: RecipientCounts;
  selected: RecipientStatus | null;
  onSelect: (status: RecipientStatus | null) => void;
}) {
  const strings = useBroadcastsStrings();
  const format = useBroadcastsFormat();
  const visible = RECIPIENT_STATUS_ORDER.filter(
    (status) => counts[status] > 0 || status === selected,
  );
  const item = (
    key: string,
    active: boolean,
    label: string,
    count: number,
    swatch: string | null,
    status: RecipientStatus | null,
  ) => (
    <li key={key}>
      <button
        type="button"
        aria-pressed={active}
        className={cn(
          "flex w-full min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left",
          "hover:border-ring hover:bg-accent",
          active ? "border-foreground bg-accent" : "border-border bg-background",
          pressClass,
        )}
        onClick={() => {
          onSelect(status);
        }}
      >
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {swatch !== null && (
            <span className={cn("size-2 shrink-0 rounded-full", swatch)} aria-hidden />
          )}
          {label}
        </span>
        <span className="text-[17px] font-[650] tabular-nums">{format.number(count)}</span>
      </button>
    </li>
  );
  return (
    <ul
      aria-label={strings.recipientsFilterLabel}
      className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 md:grid-cols-4"
    >
      {item("all", selected === null, strings.filterAll, totalOf(counts), null, null)}
      {visible.map((status) =>
        item(
          status,
          selected === status,
          strings.recipientStatusLabels[status],
          counts[status],
          RECIPIENT_COLOR[status],
          status,
        ),
      )}
    </ul>
  );
}

export function numberName(
  numbers: BroadcastNumberView[],
  id: string,
  strings: BroadcastsStrings,
): string {
  const number = numbers.find((candidate) => candidate.id === id);
  if (number === undefined) return strings.unknownNumber;
  const name = strings.numberName(number.label, number.displayPhone);
  return number.active ? name : `${name} (${strings.disconnected})`;
}

export function ErrorBar({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const strings = useBroadcastsStrings();
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">{message}</p>
      {onRetry !== undefined && (
        <button
          type="button"
          className={cn(
            "shrink-0 rounded-md px-2 text-xs font-medium underline-offset-2 hover:underline",
            pressClass,
          )}
          onClick={onRetry}
        >
          {strings.retry}
        </button>
      )}
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label={strings.dismiss}
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-md hover:bg-destructive/10",
            pressClass,
          )}
          onClick={onDismiss}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** A coloured notice inside the screen (billing pause, stopped, warnings). */
export function Callout({
  tone,
  icon,
  title,
  children,
  action,
}: {
  tone: "warning" | "danger" | "neutral" | "info";
  icon: ReactNode;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3.5 py-3 text-[13px] sm:flex-row sm:items-start",
        tone === "warning" &&
          "border-[#f59e0b]/40 bg-[#fef3c7] text-[#7c2d12] dark:bg-[#f59e0b]/10 dark:text-[#fcd34d]",
        tone === "danger" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "neutral" && "border-border bg-muted/50 text-muted-foreground",
        tone === "info" &&
          "border-[#2b59c3]/20 bg-[#f6f8ff] text-[#1e3a8a] dark:bg-[#2b59c3]/10 dark:text-[#bfd0f7]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-px shrink-0 [&_svg]:size-4" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {title !== undefined && <p className="font-semibold">{title}</p>}
          {children !== undefined && (
            <div className={cn(title !== undefined && "mt-0.5 opacity-90")}>{children}</div>
          )}
        </div>
      </div>
      {action !== undefined && <div className="shrink-0 sm:ml-2">{action}</div>}
    </div>
  );
}

/** Which full-page message `BroadcastsNotice` shows. */
export type BroadcastsNoticeKind = "forbidden" | "noNumbers";

/** Full-page message instead of the screen (no access, no numbers), in `locale`. */
export function BroadcastsNotice({
  kind,
  locale,
  formatLocale,
  strings,
}: {
  kind: BroadcastsNoticeKind;
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<BroadcastsStrings>;
}) {
  return (
    <BroadcastsStringsProvider locale={locale} formatLocale={formatLocale} strings={strings}>
      <NoticeMessage kind={kind} />
    </BroadcastsStringsProvider>
  );
}

function NoticeMessage({ kind }: { kind: BroadcastsNoticeKind }) {
  const strings = useBroadcastsStrings();
  const title = kind === "forbidden" ? strings.forbiddenTitle : strings.noNumbersTitle;
  const body = kind === "forbidden" ? strings.forbiddenBody : strings.noNumbersBody;
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-[17px] font-[650]">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

/** "← Broadcasts": back to the list from the composer or a progress view. */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "-ml-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
        pressClass,
      )}
      onClick={onClick}
    >
      <ArrowLeft className="size-4" aria-hidden />
      {label}
    </button>
  );
}
