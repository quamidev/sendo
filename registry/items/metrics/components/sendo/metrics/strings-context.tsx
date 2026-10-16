"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";
import { metricsFormat, type MetricsFormat } from "./format";
import { metricsStrings, resolveMetricsStrings, type MetricsStrings } from "./strings";

/** What the metrics screen renders in: its strings, their language and the `Intl` locale. */
export interface MetricsStringsContextValue {
  strings: MetricsStrings;
  locale: SendoLocale;
  /** BCP-47 tag for numbers and dates (`es-GT`); defaults to `locale`. */
  formatLocale: string;
}

export const MetricsStringsContext = createContext<MetricsStringsContextValue>({
  strings: metricsStrings.en,
  locale: "en",
  formatLocale: "en",
});

/** Provides `{ strings, locale, formatLocale }` to the metrics components below it. */
export function MetricsStringsProvider({
  locale,
  formatLocale,
  strings: overrides,
  children,
}: {
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<MetricsStrings>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      strings: resolveMetricsStrings(locale, overrides),
      locale,
      formatLocale: formatLocale ?? locale,
    }),
    [locale, formatLocale, overrides],
  );
  return <MetricsStringsContext value={value}>{children}</MetricsStringsContext>;
}

export function useMetricsStrings(): MetricsStrings {
  return useContext(MetricsStringsContext).strings;
}

/** Numbers, money, days and plurals in the screen's `formatLocale` (the `format` of string functions). */
export function useMetricsFormat(): MetricsFormat {
  return metricsFormat(useContext(MetricsStringsContext).formatLocale);
}
