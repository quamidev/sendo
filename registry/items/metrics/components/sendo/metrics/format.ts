const formats = new Map<string, MetricsFormat>();

function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * Numbers, money, durations and days in the screen's `formatLocale` (a BCP-47 tag such as `en`,
 * `es` or `es-GT`). The `format` argument of the string functions; inside the screen,
 * `useMetricsFormat()`.
 */
export interface MetricsFormat {
  /** A count or token total: `1,284` (en), `1284` / `12.840` (es). */
  integer: (n: number) => string;
  /** Big standalone figures: `1,284` / `12.9K` (en), `1284` / `12,9 mil` (es). */
  compact: (n: number) => string;
  /** A share (0–1): `42%`; shares under 1% keep one decimal. */
  percent: (share: number) => string;
  /** `costCents` (US cents, 4 decimals) as dollars; small amounts keep 4 decimals. */
  cost: (cents: number) => string;
  /** Axis ticks for cost: short (`$0.05` · `$400` · `$1.2K` in en). */
  costTick: (cents: number) => string;
  /** 45 s · 3 min · 1 h 05 min · 2 d 4 h. */
  duration: (seconds: number) => string;
  /** `forms.one` or `forms.other` for `count`, by the locale's plural rules. */
  plural: (count: number, forms: { one: string; other: string }) => string;
  /** A `YYYY-MM-DD` day, short: "Oct 5" (en), "5 oct" (es). */
  dayShort: (day: string) => string;
  /** A `YYYY-MM-DD` day with weekday and year: "Mon, Oct 5, 2026" (en), "lun, 5 oct 2026" (es). */
  dayLong: (day: string) => string;
  /** Sorts names in the locale's alphabetical order (`Intl.Collator`). */
  compare: (a: string, b: string) => number;
  /** The first user-perceived character of `text` (emoji, accents and flags stay whole). */
  firstGrapheme: (text: string) => string;
}

/** The `MetricsFormat` of `formatLocale`, built once per locale. */
export function metricsFormat(formatLocale: string): MetricsFormat {
  const known = formats.get(formatLocale);
  if (known !== undefined) return known;

  const integer = new Intl.NumberFormat(formatLocale);
  const compact = new Intl.NumberFormat(formatLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const percent = new Intl.NumberFormat(formatLocale, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const precisePercent = new Intl.NumberFormat(formatLocale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const usd = new Intl.NumberFormat(formatLocale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const usdSmall = new Intl.NumberFormat(formatLocale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const usdTick = new Intl.NumberFormat(formatLocale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  });
  const usdTiny = new Intl.NumberFormat(formatLocale, {
    style: "currency",
    currency: "USD",
    maximumSignificantDigits: 2,
  });
  const plurals = new Intl.PluralRules(formatLocale);
  const dayShort = new Intl.DateTimeFormat(formatLocale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const dayLong = new Intl.DateTimeFormat(formatLocale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const collator = new Intl.Collator(formatLocale);
  const segmenter = new Intl.Segmenter(formatLocale, { granularity: "grapheme" });
  const whole = (n: number) => integer.format(n);

  const format: MetricsFormat = {
    integer: whole,
    compact: (n) => (Math.abs(n) < 10_000 ? integer.format(n) : compact.format(n)),
    percent: (share) =>
      share > 0 && share < 0.01 ? precisePercent.format(share) : percent.format(share),
    cost: (cents) => {
      const dollars = cents / 100;
      if (dollars === 0) return usd.format(0);
      return Math.abs(dollars) < 1 ? usdSmall.format(dollars) : usd.format(dollars);
    },
    costTick: (cents) => {
      const dollars = cents / 100;
      return dollars === 0 || dollars >= 1 ? usdTick.format(dollars) : usdTiny.format(dollars);
    },
    duration: (seconds) => {
      const s = Math.round(seconds);
      if (s < 60) return `${whole(s)} s`;
      const minutes = Math.round(s / 60);
      if (minutes < 60) return `${whole(minutes)} min`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${whole(hours)} h ${String(minutes % 60).padStart(2, "0")} min`;
      return `${whole(Math.floor(hours / 24))} d ${whole(hours % 24)} h`;
    },
    plural: (count, forms) => (plurals.select(count) === "one" ? forms.one : forms.other),
    dayShort: (day) => dayShort.format(dayDate(day)),
    dayLong: (day) => dayLong.format(dayDate(day)),
    compare: (a, b) => collator.compare(a, b),
    firstGrapheme: (text) => [...segmenter.segment(text)][0]?.segment ?? "",
  };
  formats.set(formatLocale, format);
  return format;
}
