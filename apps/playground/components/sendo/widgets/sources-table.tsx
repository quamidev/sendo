"use client";

import { useId, useRef, useState } from "react";
import { Megaphone, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fadeSwapClass, pressClass } from "./press";
import type { WidgetsLocaleProps } from "./strings";
import { useWidgetsFormat, useWidgetsStrings, WidgetsStringsProvider } from "./strings-context";
import {
  SOURCE_PATTERN,
  type LinksActions,
  type WidgetNumberView,
  type WidgetSourceView,
} from "./types";

const ALL = "all";

export interface SourcesTableProps extends WidgetsLocaleProps {
  numbers: WidgetNumberView[];
  /** Counts for every number, loaded by the page. */
  initialSources: WidgetSourceView[];
  actions: Pick<LinksActions, "listSources">;
  /** The `useSource` button: puts a source in the link builder. Hidden when omitted. */
  onUseSource?: (source: string) => void;
  className?: string;
}

/**
 * Sources with their conversation counts, most first; `null` is `directSource`. Admin only.
 * Renders in `locale`, counts and shares in `formatLocale`.
 */
export function SourcesTable({ locale, formatLocale, strings, ...props }: SourcesTableProps) {
  return (
    <WidgetsStringsProvider locale={locale} formatLocale={formatLocale} strings={strings}>
      <SourcesTableView {...props} />
    </WidgetsStringsProvider>
  );
}

function SourcesTableView({
  numbers,
  initialSources,
  actions,
  onUseSource,
  className,
}: Omit<SourcesTableProps, keyof WidgetsLocaleProps>) {
  const strings = useWidgetsStrings();
  const format = useWidgetsFormat();
  const id = useId();
  const [account, setAccount] = useState(ALL);
  const [sources, setSources] = useState(initialSources);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const total = sources.reduce((sum, row) => sum + row.conversations, 0);
  const named = sources.filter((row) => row.source !== null);

  function select(next: string) {
    setAccount(next);
    request.current += 1;
    const current = request.current;
    setPending(true);
    void actions
      .listSources(next === ALL ? null : next)
      .catch(() => ({ ok: false as const, code: "UNKNOWN" as const }))
      .then((result) => {
        if (current !== request.current) return;
        setPending(false);
        if (result.ok) {
          setSources(result.data);
          setError(null);
        } else {
          setError(
            result.code === "UNKNOWN" ? strings.sourcesError : strings.errorMessages[result.code],
          );
        }
      });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("flex min-w-0 flex-col gap-4 rounded-xl border bg-background p-5", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`${id}-title`}
            className="text-[11.5px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
          >
            {strings.sourcesTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{strings.sourcesDescription}</p>
        </div>
        {numbers.length > 1 && (
          <Select value={account} onValueChange={select}>
            <SelectTrigger size="sm" className="max-w-64 min-w-0" aria-label={strings.numberLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL}>{strings.sourcesAllNumbers}</SelectItem>
              {numbers.map((number) => (
                <SelectItem key={number.id} value={number.id}>
                  <span className="truncate">
                    {number.label
                      ? `${number.label} · ${number.displayPhone}`
                      : number.displayPhone}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {named.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {strings.sourcesEmpty}
        </p>
      )}

      {sources.length > 0 && (
        <div
          className={cn("overflow-x-auto", fadeSwapClass, pending && "opacity-60")}
          aria-busy={pending}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {strings.sourceColumn}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {strings.conversationsColumn}
                </th>
                <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">
                  {strings.shareColumn}
                </th>
                {onUseSource && (
                  <th scope="col" className="w-0 py-2">
                    <span className="sr-only">{strings.useSource}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sources.map((row) => (
                <tr key={row.source ?? "__direct"} className="border-b last:border-b-0">
                  <td className="w-full max-w-0 py-2 pr-3">
                    {row.source === null ? (
                      <span className="text-muted-foreground">{strings.directSource}</span>
                    ) : (
                      <span
                        title={row.source}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-violet-50 px-1.5 py-px font-mono text-xs text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                      >
                        {row.source.startsWith("ad:") ? (
                          <Megaphone aria-hidden className="size-3 shrink-0" />
                        ) : (
                          <QrCode aria-hidden className="size-3 shrink-0" />
                        )}
                        <span className="truncate">{row.source}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {format.number(row.conversations)}
                  </td>
                  <td className="hidden py-2 pr-3 text-right text-muted-foreground tabular-nums sm:table-cell">
                    {total === 0 ? "—" : format.percent(row.conversations / total)}
                  </td>
                  {onUseSource && (
                    <td className="py-1 text-right">
                      {/* Link codes only: `ad:<id>` comes from Meta ads and can't go in a link. */}
                      {row.source !== null && SOURCE_PATTERN.test(row.source) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={pressClass}
                          aria-label={strings.useSourceLabel(row.source)}
                          onClick={() => {
                            if (row.source !== null) onUseSource(row.source);
                          }}
                        >
                          {strings.useSource}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
