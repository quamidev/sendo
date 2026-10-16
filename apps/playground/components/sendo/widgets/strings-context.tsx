"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";
import {
  resolveWidgetsStrings,
  widgetsFormat,
  widgetsStrings,
  type WidgetsFormat,
  type WidgetsStrings,
} from "./strings";

/** What the links screen renders in: its strings, their language and the `Intl` locale. */
export interface WidgetsStringsContextValue {
  strings: WidgetsStrings;
  locale: SendoLocale;
  /** BCP-47 tag for numbers (`es-GT`); defaults to `locale`. */
  formatLocale: string;
}

export const WidgetsStringsContext = createContext<WidgetsStringsContextValue>({
  strings: widgetsStrings.en,
  locale: "en",
  formatLocale: "en",
});

/** Provides `{ strings, locale, formatLocale }` to the widgets components below it. */
export function WidgetsStringsProvider({
  locale,
  formatLocale,
  strings: overrides,
  children,
}: {
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<WidgetsStrings>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      strings: resolveWidgetsStrings(locale, overrides),
      locale,
      formatLocale: formatLocale ?? locale,
    }),
    [locale, formatLocale, overrides],
  );
  return <WidgetsStringsContext value={value}>{children}</WidgetsStringsContext>;
}

export function useWidgetsStrings(): WidgetsStrings {
  return useContext(WidgetsStringsContext).strings;
}

/** Counts and shares in the screen's `formatLocale`. */
export function useWidgetsFormat(): WidgetsFormat {
  return widgetsFormat(useContext(WidgetsStringsContext).formatLocale);
}
