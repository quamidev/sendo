"use client";

import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SendoLocale } from "@/lib/sendo-ui";
import { cn } from "@/lib/utils";
import { ColumnChart } from "./column-chart";
import { MetricsFilterBar } from "./filters";
import { pressClass, refetchClass } from "./press";
import type { MetricsStrings } from "./strings";
import { MetricsStringsProvider, useMetricsFormat, useMetricsStrings } from "./strings-context";
import { AssigneesTable, CostPerAgentTable, SourcesTable, TagsTable } from "./tables";
import {
  todayIn,
  type MetricsActions,
  type MetricsFilters,
  type MetricsNumberView,
  type MetricsReport,
  type MetricsTagView,
} from "./types";

export interface MetricsScreenProps {
  /** The language of every label (`sendoLocale` from `lib/sendo-ui.ts` on the page). */
  locale: SendoLocale;
  /** BCP-47 tag for numbers, money and days (e.g. `es-GT`); defaults to `locale`. */
  formatLocale?: string;
  initialReport: MetricsReport;
  numbers: MetricsNumberView[];
  tags: MetricsTagView[];
  actions: MetricsActions;
  /** "Back to inbox"; `null` hides the link. */
  inboxHref?: string | null;
  /** Fixed "today" (tests, fixtures); defaults to today in the report's timezone. */
  today?: string;
  className?: string;
  /** Single strings on top of `locale`'s (`resolveMetricsStrings`). */
  strings?: Partial<MetricsStrings>;
}

function KpiTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-background p-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[26px] leading-tight font-semibold tracking-[-0.01em]">{value}</dd>
      {detail !== undefined && (
        <dd className="line-clamp-2 text-xs text-muted-foreground">{detail}</dd>
      )}
    </div>
  );
}

/** The Metrics screen: filters, KPI tiles, daily volume, tables and (admins) cost. */
export function MetricsScreen({ locale, formatLocale, strings, ...props }: MetricsScreenProps) {
  return (
    <MetricsStringsProvider locale={locale} formatLocale={formatLocale} strings={strings}>
      <MetricsView {...props} />
    </MetricsStringsProvider>
  );
}

function MetricsView({
  initialReport,
  numbers,
  tags,
  actions,
  inboxHref = "/inbox",
  today: fixedToday,
  className,
}: Omit<MetricsScreenProps, "locale" | "formatLocale" | "strings">) {
  const strings = useMetricsStrings();
  const format = useMetricsFormat();
  const [report, setReport] = useState(initialReport);
  const [filters, setFilters] = useState(initialReport.filters);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const today = fixedToday ?? todayIn(report.timeZone);

  function load(next: MetricsFilters) {
    setFilters(next);
    request.current += 1;
    const current = request.current;
    setPending(true);
    void actions
      .loadMetrics(next)
      .catch(() => ({ ok: false as const, message: strings.loadError }))
      .then((result) => {
        if (current !== request.current) return;
        setPending(false);
        if (result.ok) {
          setReport(result.data);
          setError(null);
        } else {
          setError(result.message || strings.loadError);
        }
      });
  }

  const { kpis, days } = report;
  const dash = strings.noValue;
  const dayKeys = days.map((point) => point.day);

  return (
    <div className={cn("mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-8", className)}>
      <header className="flex flex-col gap-1">
        {inboxHref !== null && (
          <a
            href={inboxHref}
            className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {strings.backToInbox}
          </a>
        )}
        <h1 className="text-[17px] font-[650] tracking-[-0.01em]">{strings.pageTitle}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{strings.pageDescription}</p>
      </header>

      <MetricsFilterBar
        filters={filters}
        numbers={numbers}
        tags={tags}
        today={today}
        onChange={load}
      />

      <div className="-mt-2 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{strings.timezoneNote(report.timeZone)}</span>
        <span
          aria-live="polite"
          className={cn(refetchClass, pending ? "opacity-100" : "opacity-0")}
        >
          {pending ? strings.updating : ""}
        </span>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <span>{error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={pressClass}
            onClick={() => {
              load(filters);
            }}
          >
            {strings.retry}
          </Button>
        </div>
      )}

      <div
        aria-busy={pending}
        className={cn("flex flex-col gap-5", refetchClass, pending && "opacity-60")}
      >
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            label={strings.kpiMessages}
            value={format.compact(kpis.messages)}
            detail={strings.kpiMessagesDetail(kpis.inbound, kpis.outbound, format)}
          />
          <KpiTile
            label={strings.kpiConversations}
            value={format.compact(kpis.conversations)}
            detail={
              kpis.conversations === 0
                ? undefined
                : strings.kpiConversationsDetail(kpis.unanswered, format)
            }
          />
          <KpiTile
            label={strings.kpiFirstResponse}
            value={
              kpis.medianFirstResponseSeconds === null
                ? dash
                : format.duration(kpis.medianFirstResponseSeconds)
            }
            detail={strings.kpiFirstResponseDetail(
              kpis.teamMedianFirstResponseSeconds === null
                ? dash
                : format.duration(kpis.teamMedianFirstResponseSeconds),
            )}
          />
          <KpiTile
            label={strings.kpiAiResolved}
            value={kpis.aiResolvedShare === null ? dash : format.percent(kpis.aiResolvedShare)}
            detail={strings.kpiAiResolvedDetail(kpis.aiResolved, kpis.closed, format)}
          />
        </dl>

        <ColumnChart
          title={strings.volumeTitle}
          description={strings.volumeDescription}
          days={dayKeys}
          series={[
            {
              key: "inbound",
              label: strings.seriesInbound,
              slot: 1,
              values: days.map((point) => point.inbound),
            },
            {
              key: "outbound",
              label: strings.seriesOutbound,
              slot: 2,
              values: days.map((point) => point.outbound),
            },
          ]}
          tableColumns={[
            {
              key: "conversations",
              label: strings.seriesConversations,
              values: days.map((point) => point.conversations),
            },
          ]}
          format={format.integer}
          integer
          emptyLabel={strings.chartEmpty}
        />

        <AssigneesTable rows={report.assignees} />

        <div className="grid gap-5 lg:grid-cols-2">
          <SourcesTable rows={report.sources} />
          <TagsTable rows={report.tags} />
        </div>

        {report.cost !== null && (
          <section aria-label={strings.costTitle} className="flex flex-col gap-3">
            <div>
              <h2 className="text-[15px] font-[650]">{strings.costTitle}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{strings.costDescription}</p>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <ColumnChart
                title={strings.costPerDayTitle}
                description={strings.costTotal(format.cost(report.cost.totalCents))}
                days={dayKeys}
                series={[
                  {
                    key: "cost",
                    label: strings.seriesCost,
                    slot: 1,
                    values: days.map((point) => point.costCents ?? 0),
                  },
                ]}
                format={format.cost}
                formatTick={format.costTick}
                emptyLabel={strings.costEmpty}
              />
              <CostPerAgentTable rows={report.cost.perAgent} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** Which full-page message `MetricsNotice` shows. */
export type MetricsNoticeKind = "forbidden" | "noNumbers" | "loadError";

/**
 * Full-page message instead of the screen (no access, no numbers, first load failed), in
 * `locale`. `body` replaces the kind's text (the server's error for `loadError`).
 */
export function MetricsNotice({
  kind,
  body,
  locale,
  formatLocale,
  strings,
}: {
  kind: MetricsNoticeKind;
  body?: string;
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<MetricsStrings>;
}) {
  return (
    <MetricsStringsProvider locale={locale} formatLocale={formatLocale} strings={strings}>
      <NoticeMessage kind={kind} body={body} />
    </MetricsStringsProvider>
  );
}

function NoticeMessage({ kind, body: detail }: { kind: MetricsNoticeKind; body?: string }) {
  const strings = useMetricsStrings();
  const [title, text] =
    kind === "forbidden"
      ? [strings.forbiddenTitle, strings.forbiddenBody]
      : kind === "noNumbers"
        ? [strings.noNumbersTitle, strings.noNumbersBody]
        : [strings.loadError, ""];
  const body = detail ?? text;
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-[17px] font-[650]">{title}</h1>
      {body !== "" && <p className="text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}
