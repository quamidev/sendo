"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";
import { broadcastsFormat, type BroadcastsFormat } from "./format";
import { broadcastsStrings, resolveBroadcastsStrings, type BroadcastsStrings } from "./strings";

/** What the broadcasts screen renders in: its strings, their language and the `Intl` locale. */
export interface BroadcastsStringsContextValue {
  strings: BroadcastsStrings;
  locale: SendoLocale;
  /** BCP-47 tag for numbers and dates (`es-GT`); defaults to `locale`. */
  formatLocale: string;
}

export const BroadcastsStringsContext = createContext<BroadcastsStringsContextValue>({
  strings: broadcastsStrings.en,
  locale: "en",
  formatLocale: "en",
});

/** Provides `{ strings, locale, formatLocale }` to the broadcasts components below it. */
export function BroadcastsStringsProvider({
  locale,
  formatLocale,
  strings: overrides,
  children,
}: {
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<BroadcastsStrings>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      strings: resolveBroadcastsStrings(locale, overrides),
      locale,
      formatLocale: formatLocale ?? locale,
    }),
    [locale, formatLocale, overrides],
  );
  return <BroadcastsStringsContext value={value}>{children}</BroadcastsStringsContext>;
}

export function useBroadcastsStrings(): BroadcastsStrings {
  return useContext(BroadcastsStringsContext).strings;
}

/** Numbers, plurals and dates in the screen's `formatLocale` (the `format` of string functions). */
export function useBroadcastsFormat(): BroadcastsFormat {
  return broadcastsFormat(useContext(BroadcastsStringsContext).formatLocale);
}
