"use client";

import { formatDistanceStrict } from "date-fns";
import { es } from "date-fns/locale";
import { useSyncExternalStore } from "react";

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

/** "hace 3 minutos". Never in the future: `now` is floored to 15 s, so fresh activity can be ahead of it. */
export function formatRelative(iso: string, now: number): string {
  const date = Math.min(new Date(iso).getTime(), now);
  return formatDistanceStrict(date, now, { addSuffix: true, locale: es });
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

export function formatClock(iso: string, timeZone: string = DEFAULT_INBOX_TIME_ZONE): string {
  let format = clockFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("es-GT", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    });
    clockFormats.set(timeZone, format);
  }
  return format.format(new Date(iso));
}

/** `hh:mm` until `iso`, floored at `00:00`. */
export function formatCountdown(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60_000));
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
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

const dayKeyFormats = new Map<string, Intl.DateTimeFormat>();

/** `YYYY-MM-DD` of `iso` in `timeZone` (day separators, "Ayer"). */
export function dayKey(iso: string | number, timeZone: string = DEFAULT_INBOX_TIME_ZONE): string {
  let format = dayKeyFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    });
    dayKeyFormats.set(timeZone, format);
  }
  return format.format(new Date(iso));
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000);
}

/** List row time: `10:51` today, "Ayer", the weekday within a week, else `6 oct`. */
export function formatListTime(
  iso: string,
  now: number,
  yesterday: string,
  timeZone: string = DEFAULT_INBOX_TIME_ZONE,
): string {
  const days = daysBetween(dayKey(iso, timeZone), dayKey(now, timeZone));
  if (days <= 0) return formatClock(iso, timeZone);
  if (days === 1) return yesterday;
  if (days < 7) {
    const weekday = new Intl.DateTimeFormat("es", { weekday: "short", timeZone }).format(
      new Date(iso),
    );
    return weekday.charAt(0).toUpperCase() + weekday.slice(1).replace(".", "");
  }
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone })
    .format(new Date(iso))
    .replace(".", "");
}

/** Day separator label: "Hoy", "Ayer", else "lunes 6 de octubre". */
export function formatDayLabel(
  iso: string,
  now: number,
  labels: { today: string; yesterday: string },
  timeZone: string = DEFAULT_INBOX_TIME_ZONE,
): string {
  const days = daysBetween(dayKey(iso, timeZone), dayKey(now, timeZone));
  if (days <= 0) return labels.today;
  if (days === 1) return labels.yesterday;
  const label = new Intl.DateTimeFormat("es", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(iso));
  return label.charAt(0).toUpperCase() + label.slice(1);
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

/** US dollars from cents, always with 4 decimals (`$0.0027`, `$12.3480`), so totals and turns align. */
export function formatCostCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;
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
