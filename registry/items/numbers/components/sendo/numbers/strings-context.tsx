"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";
import {
  numbersFormat,
  numbersStrings,
  resolveNumbersStrings,
  type NumbersFormat,
  type NumbersStrings,
} from "./strings";

/** What the numbers screen renders in: its strings, their language and the `Intl` locale. */
export interface NumbersStringsContextValue {
  strings: NumbersStrings;
  locale: SendoLocale;
  /** BCP-47 tag for numbers (`es-GT`); defaults to `locale`. */
  formatLocale: string;
}

export const NumbersStringsContext = createContext<NumbersStringsContextValue>({
  strings: numbersStrings.en,
  locale: "en",
  formatLocale: "en",
});

/** Provides `{ strings, locale, formatLocale }` to the numbers components below it. */
export function NumbersStringsProvider({
  locale,
  formatLocale,
  strings: overrides,
  children,
}: {
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<NumbersStrings>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      strings: resolveNumbersStrings(locale, overrides),
      locale,
      formatLocale: formatLocale ?? locale,
    }),
    [locale, formatLocale, overrides],
  );
  return <NumbersStringsContext value={value}>{children}</NumbersStringsContext>;
}

export function useNumbersStrings(): NumbersStrings {
  return useContext(NumbersStringsContext).strings;
}

/** Number formatters in the screen's `formatLocale` (the `format` argument of string functions). */
export function useNumbersFormat(): NumbersFormat {
  const { formatLocale } = useContext(NumbersStringsContext);
  return useMemo(() => numbersFormat(formatLocale), [formatLocale]);
}
