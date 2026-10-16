"use client";

import { ChevronRight, Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processedOf, totalOf } from "./format";
import { BroadcastStatusBadge, numberName, ProgressBar } from "./parts";
import { pressClass } from "./press";
import { useBroadcastsFormat, useBroadcastsStrings } from "./strings-context";
import type { BroadcastNumberView, BroadcastSummaryView } from "./types";

export interface BroadcastListProps {
  broadcasts: BroadcastSummaryView[];
  numbers: BroadcastNumberView[];
  hasMore: boolean;
  loadingMore: boolean;
  /** `false` when the tenant has no connected number (the empty state hides "New broadcast"). */
  canCreate: boolean;
  onOpen: (broadcast: BroadcastSummaryView) => void;
  onCreate: () => void;
  onLoadMore: () => void;
}

/** The tenant's broadcasts, newest first, each with its state and a progress bar. */
export function BroadcastList({
  broadcasts,
  numbers,
  hasMore,
  loadingMore,
  canCreate,
  onOpen,
  onCreate,
  onLoadMore,
}: BroadcastListProps) {
  const strings = useBroadcastsStrings();
  const format = useBroadcastsFormat();
  if (broadcasts.length === 0) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-background px-6 py-12 text-center">
        <div
          className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"
          aria-hidden
        >
          <Megaphone className="size-5" />
        </div>
        <h2 className="text-[15px] font-[650]">{strings.emptyTitle}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{strings.emptyBody}</p>
        {canCreate && (
          <Button className={cn("mt-1", pressClass)} onClick={onCreate}>
            <Plus aria-hidden />
            {strings.newBroadcast}
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <ul
        aria-label={strings.listLabel}
        className="divide-y overflow-hidden rounded-xl border bg-background"
      >
        {broadcasts.map((broadcast) => {
          const total = totalOf(broadcast.counts);
          return (
            <li key={broadcast.id}>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-accent/60 active:bg-accent",
                  "transition-[background-color] duration-[var(--sendo-dur-fast,160ms)]",
                )}
                onClick={() => {
                  onOpen(broadcast);
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                      {broadcast.templateName}
                    </span>
                    <span className="text-xs text-muted-foreground">{broadcast.language}</span>
                    <BroadcastStatusBadge
                      status={broadcast.status}
                      pauseReason={broadcast.pauseReason}
                    />
                  </div>
                  <p className="min-w-0 text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
                    {numberName(numbers, broadcast.accountId, strings)}
                    {" · "}
                    <time dateTime={broadcast.createdAt} suppressHydrationWarning>
                      {strings.createdOn(format.dateTime(broadcast.createdAt))}
                    </time>
                  </p>
                  <div className="flex items-center gap-3">
                    <ProgressBar counts={broadcast.counts} className="max-w-56" />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {strings.progressShort(processedOf(broadcast.counts), total, format)}
                    </span>
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <Button
          variant="outline"
          className={cn("self-center", pressClass)}
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? strings.loading : strings.loadMore}
        </Button>
      )}
    </section>
  );
}
