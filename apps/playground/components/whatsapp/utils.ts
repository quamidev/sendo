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

function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function desktopSnapshot(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
}

/** `true` from the `md:` breakpoint up (dialogs on desktop, sheets on mobile). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => true);
}

export function formatRelative(iso: string, now: number): string {
  return formatDistanceStrict(new Date(iso), now, { addSuffix: true, locale: es });
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

export function formatClock(iso: string, timeZone: string = DEFAULT_INBOX_TIME_ZONE): string {
  let format = clockFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("es-GT", { hour: "2-digit", minute: "2-digit", timeZone });
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
