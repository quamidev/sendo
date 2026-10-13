"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SendoLocale } from "@/lib/sendo-ui";
import {
  resolveWorkflowsStrings,
  workflowsFormat,
  workflowsStrings,
  type WorkflowsFormat,
  type WorkflowsStrings,
} from "./strings";

/** What the rules screen renders in: its strings, their language and the `Intl` locale. */
export interface WorkflowsStringsContextValue {
  strings: WorkflowsStrings;
  locale: SendoLocale;
  /** BCP-47 tag for numbers, lists and dates (`es-GT`); defaults to `locale`. */
  formatLocale: string;
}

export const WorkflowsStringsContext = createContext<WorkflowsStringsContextValue>({
  strings: workflowsStrings.en,
  locale: "en",
  formatLocale: "en",
});

/** Provides `{ strings, locale, formatLocale }` to the workflows components below it. */
export function WorkflowsStringsProvider({
  locale,
  formatLocale,
  strings: overrides,
  children,
}: {
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<WorkflowsStrings>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      strings: resolveWorkflowsStrings(locale, overrides),
      locale,
      formatLocale: formatLocale ?? locale,
    }),
    [locale, formatLocale, overrides],
  );
  return <WorkflowsStringsContext value={value}>{children}</WorkflowsStringsContext>;
}

export function useWorkflowsStrings(): WorkflowsStrings {
  return useContext(WorkflowsStringsContext).strings;
}

/** Numbers, plurals, lists and dates in the screen's `formatLocale` (the `format` of string functions). */
export function useWorkflowsFormat(): WorkflowsFormat {
  return workflowsFormat(useContext(WorkflowsStringsContext).formatLocale);
}
