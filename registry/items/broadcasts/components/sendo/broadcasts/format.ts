import type { RecipientCounts } from "./types";

/**
 * Numbers, plurals and dates in the screen's `formatLocale` (a BCP-47 tag such as `en`, `es` or
 * `es-GT`). The `format` argument of the string functions; inside the screen,
 * `useBroadcastsFormat()`.
 */
export interface BroadcastsFormat {
  /** A count: `1,234` (en), `1234` / `12.345` (es). */
  number: (value: number) => string;
  /** `forms.one` or `forms.other` for `count`, by the locale's plural rules. */
  plural: (count: number, forms: { one: string; other: string }) => string;
  /** "Oct 9, 2:05 PM" (en), "9 oct, 14:05" (es) in the viewer's time zone. */
  dateTime: (iso: string) => string;
  /** The clock time today, else the date and time. */
  when: (iso: string, now?: Date) => string;
}

const formats = new Map<string, BroadcastsFormat>();

/** The `BroadcastsFormat` of `formatLocale`, built once per locale. */
export function broadcastsFormat(formatLocale: string): BroadcastsFormat {
  const known = formats.get(formatLocale);
  if (known !== undefined) return known;
  const integer = new Intl.NumberFormat(formatLocale);
  const plurals = new Intl.PluralRules(formatLocale);
  const dateTime = new Intl.DateTimeFormat(formatLocale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeOnly = new Intl.DateTimeFormat(formatLocale, { hour: "2-digit", minute: "2-digit" });
  const format: BroadcastsFormat = {
    number: (value) => integer.format(value),
    plural: (count, forms) => (plurals.select(count) === "one" ? forms.one : forms.other),
    dateTime: (iso) => dateTime.format(new Date(iso)),
    when: (iso, now = new Date()) => {
      const date = new Date(iso);
      return date.toDateString() === now.toDateString()
        ? timeOnly.format(date)
        : dateTime.format(date);
    },
  };
  formats.set(formatLocale, format);
  return format;
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
