import type { RecipientCounts } from "./types";

const integer = new Intl.NumberFormat("es");
const dateTime = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const timeOnly = new Intl.DateTimeFormat("es", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatCount(value: number): string {
  return integer.format(value);
}

/** "9 oct, 14:05" in the viewer's time zone. */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** "14:05" today, else the date and time. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString() ? timeOnly.format(date) : dateTime.format(date);
}

export function totalOf(counts: RecipientCounts): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

/** Recipients the tick is done with (everything but `pending`). */
export function processedOf(counts: RecipientCounts): number {
  return totalOf(counts) - counts.pending;
}

/** Recipients a message actually went out to (sent, delivered or read). */
export function sentOf(counts: RecipientCounts): number {
  return counts.sent + counts.delivered + counts.read;
}

/** Fills `{{1}}`/`{{name}}` placeholders with the typed values; empty ones stay as placeholders. */
export function fillTemplate(body: string, variables: string[]): string {
  let index = 0;
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (placeholder, key: string) => {
    const position = /^\d+$/.test(key) ? Number(key) - 1 : index++;
    const value = variables[position];
    return value === undefined || value.trim() === "" ? placeholder : value;
  });
}
