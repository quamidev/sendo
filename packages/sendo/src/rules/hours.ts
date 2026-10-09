import type { BusinessHoursParams, TimeRange, Weekday } from "./schemas";

/**
 * Business-hours math on local wall-clock time (`Intl`, no dependency). Schedules are evaluated
 * per local date, so DST changes move the UTC instants, not the opening hours.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back to look for the end of the last open range (a year of holidays still ends). */
const MAX_LOOKBACK_DAYS = 400;
const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(at: Date, timeZone: string): WallClock {
  const out: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

/** `timeZone`'s offset from UTC at `at`, in ms. */
function offsetMs(at: number, timeZone: string): number {
  const w = wallClock(new Date(at), timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** A local date as days since the epoch (UTC calendar arithmetic). */
type LocalDay = number;

function localDayOf(at: Date, timeZone: string): LocalDay {
  const w = wallClock(at, timeZone);
  return Math.floor(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS);
}

function isoDate(day: LocalDay): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(day: LocalDay): Weekday {
  return WEEKDAY_BY_UTC_DAY[new Date(day * DAY_MS).getUTCDay()] ?? "mon";
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** The UTC instant of `minutes` after local midnight of `day` in `timeZone`. */
function instantOf(day: LocalDay, minutes: number, timeZone: string): number {
  const guess = day * DAY_MS + minutes * 60_000;
  const first = guess - offsetMs(guess, timeZone);
  const second = guess - offsetMs(first, timeZone);
  return second;
}

interface Interval {
  start: number;
  end: number;
}

function rangesOf(params: BusinessHoursParams, day: LocalDay): readonly TimeRange[] {
  if (params.holidays?.includes(isoDate(day)) === true) return [];
  return params.schedule[weekdayOf(day)];
}

function intervalsOf(params: BusinessHoursParams, day: LocalDay): Interval[] {
  return rangesOf(params, day).map(([start, end]) => ({
    start: instantOf(day, toMinutes(start), params.timezone),
    end: instantOf(day, toMinutes(end), params.timezone),
  }));
}

/** The open range containing `at`, or null when closed. */
function openIntervalAt(params: BusinessHoursParams, at: Date): Interval | null {
  const t = at.getTime();
  const today = localDayOf(at, params.timezone);
  for (const day of [today, today - 1]) {
    for (const interval of intervalsOf(params, day)) {
      if (interval.start <= t && t < interval.end) return interval;
    }
  }
  return null;
}

export function isOpenAt(params: BusinessHoursParams, at: Date): boolean {
  return openIntervalAt(params, at) !== null;
}

/**
 * When the current closed period began: the end of the last open range before `at`
 * (epoch when the schedule never opened). Only meaningful while closed.
 */
export function closedPeriodStart(params: BusinessHoursParams, at: Date): Date {
  const t = at.getTime();
  const today = localDayOf(at, params.timezone);
  for (let day = today; day > today - MAX_LOOKBACK_DAYS; day--) {
    const ends = intervalsOf(params, day)
      .map((i) => i.end)
      .filter((end) => end <= t);
    if (ends.length > 0) return new Date(Math.max(...ends));
  }
  return new Date(0);
}

/** When the open range containing `at` started, or null when closed. */
export function openPeriodStart(params: BusinessHoursParams, at: Date): Date | null {
  const interval = openIntervalAt(params, at);
  return interval === null ? null : new Date(interval.start);
}

/** Minutes inside business hours between `from` and `to`. */
export function openMinutesBetween(params: BusinessHoursParams, from: Date, to: Date): number {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return 0;
  const first = localDayOf(from, params.timezone) - 1;
  const last = Math.min(localDayOf(to, params.timezone), first + MAX_LOOKBACK_DAYS);
  let total = 0;
  for (let day = first; day <= last; day++) {
    for (const interval of intervalsOf(params, day)) {
      const overlap = Math.min(b, interval.end) - Math.max(a, interval.start);
      if (overlap > 0) total += overlap;
    }
  }
  return total / 60_000;
}
