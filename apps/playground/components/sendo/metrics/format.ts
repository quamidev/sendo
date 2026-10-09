const integer = new Intl.NumberFormat("es");
const compact = new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("es", { style: "percent", maximumFractionDigits: 0 });
const precisePercent = new Intl.NumberFormat("es", { style: "percent", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("es", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdSmall = new Intl.NumberFormat("es", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const dayShort = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLong = new Intl.DateTimeFormat("es", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const formatInteger = (n: number): string => integer.format(n);

/** Big standalone figures: 1.284 / 12,9 mil. */
export const formatCompact = (n: number): string =>
  Math.abs(n) < 10_000 ? integer.format(n) : compact.format(n);

export const formatPercent = (share: number): string =>
  share > 0 && share < 0.01 ? precisePercent.format(share) : percent.format(share);

/** `costCents` (US cents, 4 decimals) as dollars; small amounts keep 4 decimals. */
export function formatCost(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) return usd.format(0);
  return Math.abs(dollars) < 1 ? usdSmall.format(dollars) : usd.format(dollars);
}

const usdTick = new Intl.NumberFormat("es", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const usdTiny = new Intl.NumberFormat("es", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 2,
});

/** Axis ticks for cost: short (0,05 US$ · 400 US$ · 1,2 mil US$). */
export function formatCostTick(cents: number): string {
  const dollars = cents / 100;
  return dollars === 0 || dollars >= 1 ? usdTick.format(dollars) : usdTiny.format(dollars);
}

/** 45 s · 3 min · 1 h 05 min · 2 d 4 h. */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${String(s)} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${String(Math.floor(hours / 24))} d ${String(hours % 24)} h`;
}

function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "5 oct" */
export const formatDayShort = (day: string): string => dayShort.format(dayDate(day));

/** "lun, 5 oct 2026" */
export const formatDayLong = (day: string): string => dayLong.format(dayDate(day));
