"use client";

import { AlertTriangle, Ban, CheckCircle2, Clock, ExternalLink, OctagonX, X } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
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
import { cn } from "@/lib/utils";
import { errorText } from "./broadcast-composer";
import { formatDateTime, processedOf, totalOf } from "./format";
import {
  BackLink,
  BroadcastStatusBadge,
  Callout,
  CountsFilter,
  ErrorBar,
  numberName,
  ProgressBar,
} from "./parts";
import { dialogReducedClass, pressClass, viewEnterClass } from "./press";
import { RecipientTable } from "./recipient-table";
import type { BroadcastsStrings } from "./strings";
import {
  BILLING_PAUSE,
  isActiveBroadcast,
  RECIPIENT_STATUS_ORDER,
  type BroadcastNumberView,
  type BroadcastRecipientRowView,
  type BroadcastsActions,
  type BroadcastsLinks,
  type BroadcastSummaryView,
  type RecipientCounts,
  type RecipientStatus,
} from "./types";

export interface BroadcastProgressProps {
  broadcast: BroadcastSummaryView;
  numbers: BroadcastNumberView[];
  actions: Pick<BroadcastsActions, "getBroadcast" | "listRecipients" | "cancelBroadcast">;
  links: BroadcastsLinks;
  strings: BroadcastsStrings;
  /** How often an active broadcast (queued, sending, paused) is re-read with `getBroadcast`. */
  pollMs?: number;
  onBack: () => void;
  /** The broadcast changed (poll or cancel): lets the list stay current. */
  onChange?: (broadcast: BroadcastSummaryView) => void;
}

interface RecipientsPage {
  /** `filter|reload` the page was loaded for; anything else on screen is still loading. */
  key: string;
  items: BroadcastRecipientRowView[];
  nextCursor: string | null;
  error: string | null;
  /** More than the first page is on screen (a silent refresh would lose the reader's place). */
  extended: boolean;
}

const sameCounts = (a: RecipientCounts, b: RecipientCounts) =>
  RECIPIENT_STATUS_ORDER.every((status) => a[status] === b[status]);

/**
 * Flow H step 4: counts per state (from `getBroadcast`), the paused / stopped / cancelled notice,
 * "Cancelar envío", and every recipient with its state (failed rows show Meta's error), paged.
 */
export function BroadcastProgress({
  broadcast: initial,
  numbers,
  actions,
  links,
  strings,
  pollMs = 5000,
  onBack,
  onChange,
}: BroadcastProgressProps) {
  const [broadcast, setBroadcast] = useState(initial);
  const [filter, setFilter] = useState<RecipientStatus | null>(null);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<RecipientsPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stale, setStale] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = `${filter ?? "all"}|${String(reload)}`;
  const loading = page?.key !== key || loadingMore;
  const items = page?.key === key ? page.items : (page?.items ?? []);

  useEffect(() => {
    let live = true;
    const done = (next: Omit<RecipientsPage, "key" | "extended">) => {
      if (!live) return;
      setPage({ key, extended: false, ...next });
      setStale(false);
    };
    actions.listRecipients(broadcast.id, { status: filter, cursor: null }).then(
      (result) => {
        done(
          result.ok
            ? { items: result.data.items, nextCursor: result.data.nextCursor, error: null }
            : { items: [], nextCursor: null, error: errorText(result, strings) },
        );
      },
      () => {
        done({ items: [], nextCursor: null, error: strings.errors.UNKNOWN });
      },
    );
    return () => {
      live = false;
    };
  }, [actions, broadcast.id, filter, key, strings]);

  async function loadMore() {
    if (page?.key !== key || page.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await actions.listRecipients(broadcast.id, {
        status: filter,
        cursor: page.nextCursor,
      });
      setPage((current) => {
        if (current?.key !== key) return current;
        return result.ok
          ? {
              key,
              items: [...current.items, ...result.data.items],
              nextCursor: result.data.nextCursor,
              error: null,
              extended: true,
            }
          : { ...current, error: errorText(result, strings) };
      });
    } catch {
      setPage((current) =>
        current?.key === key ? { ...current, error: strings.errors.UNKNOWN } : current,
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const extended = page?.extended ?? false;
  const applyPoll = useEffectEvent((next: BroadcastSummaryView) => {
    if (next.status === broadcast.status && sameCounts(next.counts, broadcast.counts)) return;
    setBroadcast(next);
    onChange?.(next);
    if (extended) setStale(true);
    else setReload((value) => value + 1);
  });

  const active = isActiveBroadcast(broadcast.status);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const timer = setInterval(() => {
      if (document.hidden) return;
      actions.getBroadcast(broadcast.id).then(
        (result) => {
          if (live && result.ok) applyPoll(result.data);
        },
        () => undefined,
      );
    }, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, actions, broadcast.id, pollMs]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const result = await actions.cancelBroadcast(broadcast.id);
      if (result.ok) {
        setBroadcast(result.data);
        onChange?.(result.data);
        setReload((value) => value + 1);
      } else {
        setError(errorText(result, strings));
      }
    } catch {
      setError(strings.errors.UNKNOWN);
    } finally {
      setCancelling(false);
      setCancelOpen(false);
    }
  }

  const { counts } = broadcast;
  const total = totalOf(counts);
  const category = strings.categoryLabels[broadcast.category] ?? broadcast.category;
  const filteredTotal = filter === null ? total : counts[filter];

  return (
    <section className={cn("flex flex-col gap-5", viewEnterClass)}>
      <div className="flex flex-col gap-3">
        <BackLink label={strings.backToList} onClick={onBack} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="min-w-0 text-[17px] font-[650] tracking-[-0.01em] [overflow-wrap:anywhere]">
                {broadcast.templateName}
              </h2>
              <BroadcastStatusBadge
                status={broadcast.status}
                pauseReason={broadcast.pauseReason}
                strings={strings}
              />
            </div>
            <p className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
              {numberName(numbers, broadcast.accountId, strings)}
              {" · "}
              {`${broadcast.language} · ${category} · ${strings.perMinute(broadcast.ratePerMinute)}`}
              {" · "}
              <time dateTime={broadcast.createdAt} suppressHydrationWarning>
                {strings.createdOn(formatDateTime(broadcast.createdAt))}
              </time>
            </p>
          </div>
          {active && (
            <Button
              variant="outline"
              className={cn("shrink-0 self-start", pressClass)}
              onClick={() => {
                setCancelOpen(true);
              }}
            >
              <Ban aria-hidden />
              {strings.cancel}
            </Button>
          )}
        </div>
      </div>

      <StateNotice broadcast={broadcast} links={links} strings={strings} />

      {error !== null && (
        <ErrorBar
          message={error}
          strings={strings}
          onDismiss={() => {
            setError(null);
          }}
        />
      )}

      <section
        className="flex flex-col gap-3 rounded-xl border bg-background p-4"
        aria-label={strings.countsLabel}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{strings.progressTitle}</h3>
          <span className="text-sm text-muted-foreground tabular-nums">
            {strings.processed(processedOf(counts), total)}
          </span>
        </div>
        <ProgressBar counts={counts} strings={strings} />
        <CountsFilter counts={counts} selected={filter} strings={strings} onSelect={setFilter} />
      </section>

      <RecipientTable
        title={filter === null ? strings.recipientsTitle : strings.recipientStatusLabels[filter]}
        items={items}
        total={filteredTotal}
        hasMore={page?.key === key && page.nextCursor !== null}
        loading={loading}
        error={page?.key === key ? page.error : null}
        stale={stale}
        strings={strings}
        onLoadMore={() => void loadMore()}
        onRefresh={() => {
          setReload((value) => value + 1);
        }}
      />

      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!cancelling) setCancelOpen(open);
        }}
      >
        <DialogContent showCloseButton={false} className={cn("sm:max-w-md", dialogReducedClass)}>
          <DialogHeader>
            <DialogTitle>{strings.cancelTitle}</DialogTitle>
            <DialogDescription>{strings.cancelBody(counts.pending)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={cancelling}
              className={pressClass}
              onClick={() => {
                setCancelOpen(false);
              }}
            >
              {strings.cancelKeep}
            </Button>
            <Button
              variant="destructive"
              disabled={cancelling}
              className={pressClass}
              onClick={() => void cancel()}
            >
              {cancelling ? strings.cancelling : strings.cancelConfirm}
            </Button>
          </DialogFooter>
          <DialogClose className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
            <X aria-hidden />
            <span className="sr-only">{strings.close}</span>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StateNotice({
  broadcast,
  links,
  strings,
}: {
  broadcast: BroadcastSummaryView;
  links: BroadcastsLinks;
  strings: BroadcastsStrings;
}) {
  switch (broadcast.status) {
    case "paused":
      return broadcast.pauseReason === BILLING_PAUSE ? (
        <Callout
          tone="warning"
          icon={<AlertTriangle />}
          title={strings.billingBannerTitle}
          action={
            <a
              href={links.metaBilling}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border border-current/25 bg-white/70 px-3 text-[12.5px] font-medium whitespace-nowrap hover:bg-white dark:bg-black/20 dark:hover:bg-black/30",
                pressClass,
              )}
            >
              {strings.billingBannerLink}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          }
        >
          {strings.billingBannerBody}
        </Callout>
      ) : (
        <Callout tone="warning" icon={<Clock />} title={strings.statusLabels.paused} />
      );
    case "failed":
      return (
        <Callout tone="danger" icon={<OctagonX />} title={strings.failedBannerTitle}>
          {strings.failedBannerBody}
        </Callout>
      );
    case "cancelled":
      return (
        <Callout tone="neutral" icon={<Ban />}>
          {strings.cancelledBanner(broadcast.counts.cancelled)}
        </Callout>
      );
    case "done":
      return broadcast.counts.failed > 0 &&
        broadcast.counts.sent + broadcast.counts.delivered + broadcast.counts.read === 0 ? (
        <Callout tone="danger" icon={<OctagonX />} title={strings.noneDeliveredTitle}>
          {strings.noneDeliveredBody}
        </Callout>
      ) : (
        <Callout tone="neutral" icon={<CheckCircle2 />}>
          {strings.doneBanner}
        </Callout>
      );
    case "queued":
      return (
        <Callout tone="info" icon={<Clock />}>
          {strings.queuedBanner}
        </Callout>
      );
    case "sending":
      return null;
  }
}
