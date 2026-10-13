"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";
import { inboxStrings, resolveInboxStrings, type InboxStrings } from "./strings";
import { inboxFormat, type InboxFormat } from "./utils";

/** What the inbox renders in: its strings, their language and the `Intl` locale for dates and numbers. */
export interface InboxStringsContextValue {
  strings: InboxStrings;
  locale: SendoLocale;
  /** BCP-47 tag for dates, times, numbers and lists (`es-GT`); defaults to `locale`. */
  formatLocale: string;
}

export const InboxStringsContext = createContext<InboxStringsContextValue>({
  strings: inboxStrings.en,
  locale: "en",
  formatLocale: "en",
});

/** Provides `{ strings, locale, formatLocale }` to the inbox components below it. */
export function InboxStringsProvider({
  locale,
  formatLocale,
  strings: overrides,
  children,
}: {
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<InboxStrings>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      strings: resolveInboxStrings(locale, overrides),
      locale,
      formatLocale: formatLocale ?? locale,
    }),
    [locale, formatLocale, overrides],
  );
  return <InboxStringsContext value={value}>{children}</InboxStringsContext>;
}

export function useInboxStrings(): InboxStrings {
  return useContext(InboxStringsContext).strings;
}

/** The `locale` and `formatLocale` the inbox renders in. */
export function useInboxLocale(): Pick<InboxStringsContextValue, "locale" | "formatLocale"> {
  const { locale, formatLocale } = useContext(InboxStringsContext);
  return { locale, formatLocale };
}

/** Number and list formatters in the inbox's `formatLocale` (the `format` argument of string functions). */
export function useInboxFormat(): InboxFormat {
  const { formatLocale } = useContext(InboxStringsContext);
  return useMemo(() => inboxFormat(formatLocale), [formatLocale]);
}
