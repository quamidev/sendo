"use client";

import { formatDistanceStrict, type Locale } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { useSyncExternalStore } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";

export const DEFAULT_INBOX_TIME_ZONE = "America/Guatemala";

const NOW_TICK_MS = 15_000;

function subscribeNow(onChange: () => void): () => void {
  const id = setInterval(onChange, NOW_TICK_MS);
  return () => {
    clearInterval(id);
  };
}

function nowSnapshot(): number {
  return Math.floor(Date.now() / NOW_TICK_MS) * NOW_TICK_MS;
}

/** Current time, refreshed every 15 s (relative times and the window countdown). */
export function useNow(): number {
  return useSyncExternalStore(subscribeNow, nowSnapshot, nowSnapshot);
}

const DESKTOP_QUERY = "(min-width: 768px)";
/** From here the context panel is a fourth column; below it opens as a panel or sheet. */
export const WIDE_QUERY = "(min-width: 1180px)";

function subscribeQuery(query: string, onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const list = window.matchMedia(query);
  list.addEventListener("change", onChange);
  return () => {
    list.removeEventListener("change", onChange);
  };
}

function queryMatches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** `matchMedia(query).matches`, live. `serverValue` is used while rendering on the server. */
export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeQuery(query, onChange),
    () => queryMatches(query),
    () => serverValue,
  );
}

/** `true` from the `md:` breakpoint up (dialogs on desktop, sheets on mobile). */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/**
 * date-fns locales by language (the part of `formatLocale` before the first `-`). Add one when you
 * add a `SendoLocale`; languages missing here format relative times in English.
 */
const DATE_FNS_LOCALES: Record<SendoLocale, Locale> = { es, en: enUS };

function dateFnsLocale(formatLocale: string): Locale {
  const byLanguage: Partial<Record<string, Locale>> = DATE_FNS_LOCALES;
  return byLanguage[formatLocale.split("-")[0]?.toLowerCase() ?? ""] ?? enUS;
}

/**
 * Cached `Intl` formatters: building one is slow and the list re-renders every 15 s. Keyed by the
 * formatter kind, `formatLocale` and its options.
 */
const intlCache = new Map<
  string,
  Intl.DateTimeFormat | Intl.NumberFormat | Intl.ListFormat | Intl.Collator
>();

function cached<
  T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.ListFormat | Intl.Collator,
>(key: string, create: () => T): T {
  let format = intlCache.get(key) as T | undefined;
  if (format === undefined) {
    format = create();
    intlCache.set(key, format);
  }
  return format;
}

function dateFormat(
  formatLocale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return cached(
    `date|${formatLocale}|${JSON.stringify(options)}`,
    () => new Intl.DateTimeFormat(formatLocale, options),
  );
}

/** Numbers and lists in the inbox's `formatLocale`; string functions that show them receive it. */
export interface InboxFormat {
  /** A count or token total: `1,234` (en), `1234` / `12.345` (es). */
  number: (value: number) => string;
  /** "a, b and c" (en), "a, b y c" (es). */
  list: (items: readonly string[]) => string;
}

/** The `InboxFormat` of `formatLocale` (a BCP-47 tag such as `en`, `es` or `es-GT`). */
export function inboxFormat(formatLocale: string): InboxFormat {
  const number = cached(`number|${formatLocale}`, () => new Intl.NumberFormat(formatLocale));
  const list = cached(
    `list|${formatLocale}`,
    () => new Intl.ListFormat(formatLocale, { style: "long", type: "conjunction" }),
  );
  return {
    number: (value) => number.format(value),
    list: (items) => list.format(items),
  };
}

/** Compares names for sorting in `formatLocale` (accents and case ignored). */
export function compareText(a: string, b: string, formatLocale: string): number {
  return cached(
    `collator|${formatLocale}`,
    () => new Intl.Collator(formatLocale, { sensitivity: "base" }),
  ).compare(a, b);
}

/** "3 minutes ago" / "hace 3 minutos". Never in the future: `now` is floored to 15 s, so fresh activity can be ahead of it. */
export function formatRelative(iso: string, now: number, formatLocale: string): string {
  const date = Math.min(new Date(iso).getTime(), now);
  return formatDistanceStrict(date, now, { addSuffix: true, locale: dateFnsLocale(formatLocale) });
}

/** Time of day in `formatLocale`'s clock (`14:05`, `2:05 PM`); `en-US-u-hc-h23` forces 24 h. */
export function formatClock(
  iso: string,
  formatLocale: string,
  timeZone: string = DEFAULT_INBOX_TIME_ZONE,
): string {
  return dateFormat(formatLocale, { hour: "numeric", minute: "2-digit", timeZone }).format(
    new Date(iso),
  );
}

/** Up to two initials, or `null` when the name has no letters (e.g. only a phone number). */
export function initials(name: string): string | null {
  const letters = name
    .split(/\s+/)
    .map((word) => /\p{L}/u.exec(word)?.[0])
    .filter((letter) => letter !== undefined)
    .slice(0, 2)
    .map((letter) => letter.toUpperCase());
  return letters.length === 0 ? null : letters.join("");
}

/** `YYYY-MM-DD` of `iso` in `timeZone` (an internal key for day separators and "yesterday", never shown). */
export function dayKey(iso: string | number, timeZone: string = DEFAULT_INBOX_TIME_ZONE): string {
  return dateFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000);
}

function capitalize(text: string, formatLocale: string): string {
  return text.charAt(0).toLocaleUpperCase(formatLocale) + text.slice(1);
}

/** List row time: the clock today, `yesterday`, the weekday within a week ("Mon"), else "Oct 6". */
export function formatListTime(
  iso: string,
  now: number,
  yesterday: string,
  formatLocale: string,
  timeZone: string = DEFAULT_INBOX_TIME_ZONE,
): string {
  const days = daysBetween(dayKey(iso, timeZone), dayKey(now, timeZone));
  if (days <= 0) return formatClock(iso, formatLocale, timeZone);
  if (days === 1) return yesterday;
  const date = new Date(iso);
  // Abbreviations drop their trailing dot ("lun." → "Lun", "6 oct." → "6 oct").
  if (days < 7) {
    const weekday = dateFormat(formatLocale, { weekday: "short", timeZone }).format(date);
    return capitalize(weekday.replace(/\.$/, ""), formatLocale);
  }
  return dateFormat(formatLocale, { day: "numeric", month: "short", timeZone })
    .format(date)
    .replace(/\.$/, "");
}

/** Day separator label: `today`, `yesterday`, else the full date ("Monday, October 6"). */
export function formatDayLabel(
  iso: string,
  now: number,
  labels: { today: string; yesterday: string },
  formatLocale: string,
  timeZone: string = DEFAULT_INBOX_TIME_ZONE,
): string {
  const days = daysBetween(dayKey(iso, timeZone), dayKey(now, timeZone));
  if (days <= 0) return labels.today;
  if (days === 1) return labels.yesterday;
  const label = dateFormat(formatLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(iso));
  return capitalize(label, formatLocale);
}

/** Hours and minutes left until `iso` (floored, never negative). */
export function remainingParts(iso: string, now: number): { hours: number; minutes: number } {
  const minutes = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60_000));
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

/**
 * Trailing `[#code]` of a first inbound message (same pattern as the package's
 * `SOURCE_CODE_RE`): the inbox shows the text without it and an "Origen" chip instead.
 */
const SOURCE_CODE_RE = /\s*\[#([a-z0-9-]{1,32})\]\s*$/;

export function stripSourceCode(text: string): string {
  const match = SOURCE_CODE_RE.exec(text);
  return match === null ? text : text.slice(0, match.index);
}

/** US dollars from cents in `formatLocale`, always with 4 decimals (`$0.0027`, `0,0027 US$`), so totals and turns align. */
export function formatCostCents(cents: number, formatLocale: string): string {
  return cached(
    `usd|${formatLocale}`,
    () =>
      new Intl.NumberFormat(formatLocale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }),
  ).format(cents / 100);
}

const AVATAR_TONES = [
  "bg-rose-700",
  "bg-sky-700",
  "bg-amber-700",
  "bg-lime-700",
  "bg-violet-700",
  "bg-teal-700",
  "bg-orange-700",
  "bg-indigo-700",
] as const;

/** A stable background for initials avatars (white text passes contrast on every tone). */
export function avatarTone(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? AVATAR_TONES[0];
}
