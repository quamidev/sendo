"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatWhen } from "./format";
import { ErrorBar, RecipientStatusLabel } from "./parts";
import { pendingFadeClass, pressClass } from "./press";
import type { BroadcastsStrings } from "./strings";
import type { BroadcastRecipientRowView, SkipReason } from "./types";

export interface RecipientTableProps {
  title: string;
  items: BroadcastRecipientRowView[];
  /** Recipients in the current filter (from the broadcast's counts). */
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  /** New results arrived while more than one page is on screen. */
  stale: boolean;
  strings: BroadcastsStrings;
  onLoadMore: () => void;
  onRefresh: () => void;
}

const COLUMNS = "md:grid-cols-[minmax(0,1.1fr)_8.5rem_minmax(0,1.6fr)] md:gap-x-4";

/** Per-recipient results, paged with "Cargar más" (10,000 recipients never render at once). */
export function RecipientTable({
  title,
  items,
  total,
  hasMore,
  loading,
  error,
  stale,
  strings,
  onLoadMore,
  onRefresh,
}: RecipientTableProps) {
  return (
    <section className="flex flex-col gap-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {strings.recipientsShowing(items.length, total)}
        </span>
      </div>

      {stale && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{strings.refreshAvailable}</span>
          <Button size="sm" variant="outline" className={pressClass} onClick={onRefresh}>
            <RefreshCw aria-hidden />
            {strings.refresh}
          </Button>
        </div>
      )}

      {error !== null && <ErrorBar message={error} strings={strings} onRetry={onRefresh} />}

      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-background",
          pendingFadeClass,
          loading && items.length > 0 && "opacity-60",
        )}
      >
        <div
          aria-hidden
          className={cn(
            "hidden border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid",
            COLUMNS,
          )}
        >
          <span>{strings.colContact}</span>
          <span>{strings.colStatus}</span>
          <span>{strings.colDetail}</span>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {loading ? strings.loading : strings.recipientsEmpty}
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((recipient) => (
              <RecipientRow key={recipient.id} recipient={recipient} strings={strings} />
            ))}
          </ul>
        )}
      </div>

      {hasMore && (
        <Button
          variant="outline"
          className={cn("self-center", pressClass)}
          disabled={loading}
          onClick={onLoadMore}
        >
          {loading ? strings.loading : strings.loadMore}
        </Button>
      )}
    </section>
  );
}

function RecipientRow({
  recipient,
  strings,
}: {
  recipient: BroadcastRecipientRowView;
  strings: BroadcastsStrings;
}) {
  const name = recipient.name ?? recipient.appRef;
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3 text-sm",
        COLUMNS,
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            "min-w-0 font-medium [overflow-wrap:anywhere]",
            name === null && "text-muted-foreground",
          )}
        >
          {name ?? strings.noName}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {recipient.phone ?? strings.noPhone}
        </span>
      </div>
      <div className="pt-px">
        <RecipientStatusLabel status={recipient.status} strings={strings} />
      </div>
      <div className="col-span-2 min-w-0 md:col-span-1">
        <RecipientDetail recipient={recipient} strings={strings} />
      </div>
    </li>
  );
}

function RecipientDetail({
  recipient,
  strings,
}: {
  recipient: BroadcastRecipientRowView;
  strings: BroadcastsStrings;
}) {
  if (recipient.status === "failed" && recipient.error !== null) {
    const { error } = recipient;
    const text =
      error.title !== null && error.title !== error.message
        ? `${error.title}: ${error.message}`
        : error.message;
    const full = error.details === null ? text : `${text} — ${error.details}`;
    return (
      <div className="min-w-0 text-[12.5px]" title={full}>
        <span className="font-medium text-destructive">{strings.metaError(error.code)}</span>
        <p className="line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]">{full}</p>
      </div>
    );
  }
  if (recipient.status === "skipped") {
    const reason = recipient.skipReason as SkipReason | null;
    const label =
      reason !== null && reason in strings.skipReasonLabels
        ? strings.skipReasonLabels[reason]
        : strings.unknownSkipReason;
    return <p className="min-w-0 text-[12.5px] text-muted-foreground">{label}</p>;
  }
  return (
    <p className="text-[12.5px] text-muted-foreground">
      <time dateTime={recipient.updatedAt} suppressHydrationWarning>
        {strings.updatedAt(formatWhen(recipient.updatedAt))}
      </time>
    </p>
  );
}
