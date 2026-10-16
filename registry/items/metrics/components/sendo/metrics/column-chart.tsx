"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pressClass, tooltipFadeClass } from "./press";
import { useMetricsFormat, useMetricsStrings } from "./strings-context";

/**
 * Plain HTML/CSS column chart (no chart library; see AGENTS.md). One categorical slot per series,
 * stacked from a single baseline. Colours are the validated dataviz reference slots 1 (blue) and
 * 2 (orange), light and dark steps, as CSS variables on the chart root.
 */
export const SERIES_COLORS = {
  1: "var(--sendo-metrics-series-1)",
  2: "var(--sendo-metrics-series-2)",
} as const;

export const chartPaletteClass =
  "[--sendo-metrics-series-1:#2a78d6] [--sendo-metrics-series-2:#eb6834] dark:[--sendo-metrics-series-1:#3987e5] dark:[--sendo-metrics-series-2:#d95926]";

export interface ChartSeries {
  key: string;
  label: string;
  slot: keyof typeof SERIES_COLORS;
  /** One value per day, same order as `days`. */
  values: number[];
}

/** Extra numeric columns shown only in the table view. */
export interface ChartTableColumn {
  key: string;
  label: string;
  values: number[];
}

export interface ColumnChartProps {
  title: string;
  description?: string;
  days: string[];
  /** Bottom to top. Two at most (the palette is validated for adjacent slots 1 and 2). */
  series: ChartSeries[];
  tableColumns?: ChartTableColumn[];
  format: (value: number) => string;
  /** Axis ticks; defaults to `format`. */
  formatTick?: (value: number) => string;
  /** Integer data gets integer ticks. */
  integer?: boolean;
  emptyLabel: string;
  className?: string;
}

const PLOT_HEIGHT = 176;
const TARGET_TICKS = 4;

/** Clean ticks (1, 2, 5 × 10ⁿ) from 0 up to at least `max`. */
export function niceTicks(max: number, integer: boolean): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / TARGET_TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * magnitude;
  if (integer) step = Math.max(1, Math.round(step));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i <= Math.round(top / step); i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

/** Up to ~6 evenly spread day indexes for x-axis labels, always the first and last. */
function labelIndexes(count: number): number[] {
  if (count <= 1) return count === 1 ? [0] : [];
  const slots = Math.min(count, count <= 8 ? count : 6);
  const out = new Set<number>();
  for (let i = 0; i < slots; i++) out.add(Math.round((i * (count - 1)) / (slots - 1)));
  return [...out];
}

export function ColumnChart({
  title,
  description,
  days,
  series,
  tableColumns = [],
  format,
  formatTick = format,
  integer = false,
  emptyLabel,
  className,
}: ColumnChartProps) {
  const strings = useMetricsStrings();
  const { dayShort, dayLong } = useMetricsFormat();
  const id = useId();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);

  const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(0, ...totals);
  const ticks = niceTicks(max, integer);
  const top = ticks[ticks.length - 1] ?? 1;
  const empty = max === 0;
  const dense = days.length > 45;
  const xLabels = labelIndexes(days.length);
  const keepOnPhone = new Set([
    xLabels[0],
    xLabels[Math.floor(xLabels.length / 2)],
    xLabels[xLabels.length - 1],
  ]);
  const activeDay = active === null ? undefined : days[active];
  // The tooltip keeps the last day while it fades out (state adjusted during render).
  const [shown, setShown] = useState<number | null>(null);
  if (active !== null && active !== shown) setShown(active);
  const tip = shown !== null && shown < days.length ? shown : null;
  const tipDay = tip === null ? undefined : days[tip];

  function indexAt(clientX: number): number | null {
    const box = plot.current?.getBoundingClientRect();
    if (!box || box.width === 0 || days.length === 0) return null;
    const ratio = (clientX - box.left) / box.width;
    return Math.min(days.length - 1, Math.max(0, Math.floor(ratio * days.length)));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (empty) return;
    setActive(indexAt(event.clientX));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (days.length === 0) return;
    const last = days.length - 1;
    const current = active ?? -1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(last, current + 1);
    else if (event.key === "ArrowLeft") next = current < 0 ? last : Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  const tooltipAlign =
    tip === null || days.length < 4
      ? "-translate-x-1/2"
      : tip / days.length < 0.2
        ? "translate-x-0"
        : tip / days.length > 0.8
          ? "-translate-x-full"
          : "-translate-x-1/2";
  const tooltipLeft =
    tip === null
      ? "50%"
      : tooltipAlign === "translate-x-0"
        ? `${String((tip / days.length) * 100)}%`
        : tooltipAlign === "-translate-x-full"
          ? `${String(((tip + 1) / days.length) * 100)}%`
          : `${String(((tip + 0.5) / days.length) * 100)}%`;

  const first = days[0];
  const last = days[days.length - 1];

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl border bg-background p-4 sm:p-5",
        chartPaletteClass,
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-[15px] font-[650]">
            {title}
          </h2>
          {description !== undefined && (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(pressClass, "-mr-2 shrink-0")}
          aria-pressed={view === "table"}
          onClick={() => {
            setView(view === "chart" ? "table" : "chart");
          }}
        >
          {view === "chart" ? strings.showTable : strings.showChart}
        </Button>
      </div>

      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: SERIES_COLORS[s.slot] }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {view === "chart" ? (
        <div className="flex gap-2">
          {/* y axis */}
          <div
            className="relative shrink-0 text-right text-[11px] text-muted-foreground tabular-nums"
            style={{ height: PLOT_HEIGHT }}
            aria-hidden
          >
            {/* Sizes the gutter to the widest tick (the ticks themselves are positioned). */}
            <span className="invisible block h-0 overflow-hidden whitespace-nowrap">
              {ticks.map(formatTick).reduce((a, b) => (b.length > a.length ? b : a), "")}
            </span>
            {ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-0 translate-y-1/2 leading-none whitespace-nowrap"
                style={{ bottom: `${String((tick / top) * 100)}%` }}
              >
                {formatTick(tick)}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            <div
              ref={plot}
              role="group"
              tabIndex={0}
              aria-label={
                first !== undefined && last !== undefined
                  ? strings.chartLabel(title, dayShort(first), dayShort(last))
                  : title
              }
              aria-describedby={`${id}-live`}
              className="relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              style={{ height: PLOT_HEIGHT }}
              onPointerMove={onPointerMove}
              onPointerLeave={() => {
                setActive(null);
              }}
              onBlur={() => {
                setActive(null);
              }}
              onKeyDown={onKeyDown}
            >
              {ticks.map((tick) => (
                <div
                  key={tick}
                  aria-hidden
                  className={cn(
                    "absolute inset-x-0 border-t",
                    tick === 0 ? "border-foreground/25" : "border-border/70",
                  )}
                  style={{ bottom: `${String((tick / top) * 100)}%` }}
                />
              ))}

              <div
                aria-hidden
                className={cn(
                  "absolute inset-0 flex items-end",
                  days.length > 60 ? "gap-px" : "gap-[2px]",
                )}
              >
                {days.map((day, i) => {
                  const total = totals[i] ?? 0;
                  const visible = series.filter((s) => (s.values[i] ?? 0) > 0);
                  return (
                    <div
                      key={day}
                      className={cn(
                        "flex h-full min-w-0 flex-1 flex-col-reverse items-center",
                        active !== null && active !== i && "opacity-45",
                      )}
                    >
                      {total > 0 &&
                        visible.map((s, segment) => (
                          <div
                            key={s.key}
                            className={cn(
                              "w-full max-w-6 shrink-0",
                              segment > 0 && "mb-[2px]",
                              segment === visible.length - 1 &&
                                (dense ? "rounded-t-[2px]" : "rounded-t-[4px]"),
                            )}
                            style={{
                              height: `${String(((s.values[i] ?? 0) / top) * 100)}%`,
                              minHeight: 1,
                              backgroundColor: SERIES_COLORS[s.slot],
                            }}
                          />
                        ))}
                    </div>
                  );
                })}
              </div>

              {empty && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  {emptyLabel}
                </p>
              )}

              <div
                role="presentation"
                className={cn(
                  "pointer-events-none absolute -top-2 z-10 w-max max-w-56 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
                  tooltipFadeClass,
                  tooltipAlign,
                  activeDay === undefined ? "opacity-0" : "opacity-100",
                )}
                style={{ left: tooltipLeft }}
              >
                {tipDay !== undefined && tip !== null && (
                  <>
                    <p className="mb-1.5 text-muted-foreground">{dayLong(tipDay)}</p>
                    <ul className="flex flex-col gap-1">
                      {[...series].reverse().map((s) => (
                        <li key={s.key} className="flex items-center gap-2">
                          <span
                            className="h-0.5 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: SERIES_COLORS[s.slot] }}
                          />
                          <span className="font-semibold tabular-nums">
                            {format(s.values[tip] ?? 0)}
                          </span>
                          <span className="text-muted-foreground">{s.label}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>

            {/* x axis (inside the card's height: no nested scroll) */}
            <div className="relative mt-1.5 h-4 text-[11px] text-muted-foreground" aria-hidden>
              {xLabels.map((i) => {
                const day = days[i];
                if (day === undefined) return null;
                const edge =
                  days.length === 1
                    ? "-translate-x-1/2"
                    : i === 0
                      ? "translate-x-0"
                      : i === days.length - 1
                        ? "-translate-x-full"
                        : "-translate-x-1/2";
                const left =
                  edge === "translate-x-0"
                    ? "0%"
                    : edge === "-translate-x-full"
                      ? "100%"
                      : `${String(((i + 0.5) / days.length) * 100)}%`;
                return (
                  <span
                    key={day}
                    className={cn(
                      "absolute top-0 whitespace-nowrap tabular-nums",
                      edge,
                      // Phones keep the first, middle and last labels only.
                      !keepOnPhone.has(i) && "hidden sm:inline",
                    )}
                    style={{ left }}
                  >
                    {dayShort(day)}
                  </span>
                );
              })}
            </div>

            <p id={`${id}-live`} className="sr-only" aria-live="polite">
              {activeDay !== undefined && active !== null
                ? `${dayLong(activeDay)}: ${series
                    .map((s) => `${s.label} ${format(s.values[active] ?? 0)}`)
                    .join(", ")}`
                : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="max-h-80 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">
                  {strings.dayColumn}
                </th>
                {[...series, ...tableColumns].map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day} className="border-b last:border-b-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal whitespace-nowrap">
                    {dayLong(day)}
                  </th>
                  {[...series, ...tableColumns].map((column) => (
                    <td key={column.key} className="px-3 py-1.5 text-right tabular-nums">
                      {format(column.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
