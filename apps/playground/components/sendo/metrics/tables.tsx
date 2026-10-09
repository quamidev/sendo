"use client";

import type { TagColor } from "@quami/sendo";
import { Megaphone, QrCode, Smartphone, UserRound } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pressClass } from "./press";
import { formatCost, formatDuration, formatInteger, formatPercent } from "./format";
import type { MetricsStrings } from "./strings";
import type {
  MetricsAgentCost,
  MetricsAssigneeSummary,
  MetricsSourceSummary,
  MetricsTagSummary,
} from "./types";

/** Same dot colours as sendo-inbox's tag chips (`TAG_COLORS`). */
export const TAG_DOT_CLASS: Record<TagColor, string> = {
  gray: "bg-zinc-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-sky-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export interface Column<Row> {
  key: string;
  label: string;
  /** Numbers align right with tabular figures. */
  numeric?: boolean;
  /**
   * `true`: hidden below `sm` (phones). `"half"`: also hidden while the card sits in a
   * half-width column (`lg` up to `xl`).
   */
  secondary?: boolean | "half";
  cell: (row: Row) => ReactNode;
}

export interface TableCardProps<Row> {
  title: string;
  description?: string;
  rows: Row[];
  rowKey: (row: Row) => string;
  columns: Column<Row>[];
  empty: string;
  /** Rows shown before "Mostrar todos". */
  limit?: number;
  strings: Pick<MetricsStrings, "showAll" | "showLess">;
  className?: string;
  children?: ReactNode;
}

function secondaryClass(secondary: Column<unknown>["secondary"]): string | false {
  if (secondary === "half") return "hidden sm:table-cell lg:hidden xl:table-cell";
  return secondary === true && "hidden sm:table-cell";
}

export function TableCard<Row>({
  title,
  description,
  rows,
  rowKey,
  columns,
  empty,
  limit = 8,
  strings,
  className,
  children,
}: TableCardProps<Row>) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, limit);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4 sm:p-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="text-[15px] font-[650]">
          {title}
        </h2>
        {description !== undefined && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-background">
              <tr className="border-b text-left text-xs text-muted-foreground">
                {columns.map((column, index) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "py-2 font-medium",
                      index < columns.length - 1 && "pr-3",
                      column.numeric && "text-right",
                      secondaryClass(column.secondary),
                    )}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={rowKey(row)} className="border-b last:border-b-0">
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        "py-2 align-top",
                        index === 0 && "w-full max-w-0",
                        index < columns.length - 1 && "pr-3",
                        column.numeric && "text-right whitespace-nowrap tabular-nums",
                        secondaryClass(column.secondary),
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(pressClass, "-ml-2 w-fit text-muted-foreground")}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded ? strings.showLess : strings.showAll(rows.length)}
        </Button>
      )}
    </section>
  );
}

const duration = (seconds: number | null, strings: MetricsStrings) =>
  seconds === null ? (
    <span className="text-muted-foreground">{strings.noValue}</span>
  ) : (
    formatDuration(seconds)
  );

function Initials({ name }: { name: string }) {
  const segmenter = new Intl.Segmenter("es", { granularity: "grapheme" });
  // Letters only: "Agente de turno 11" → "AT", not "A1".
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word));
  const firstGrapheme = (word: string | undefined) =>
    word === undefined ? "" : ([...segmenter.segment(word)][0]?.segment ?? "");
  const text =
    words.length > 1
      ? `${firstGrapheme(words[0])}${firstGrapheme(words[words.length - 1])}`
      : firstGrapheme(words[0] ?? name.trim());
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground uppercase"
    >
      {text}
    </span>
  );
}

export function AssigneesTable({
  rows,
  strings,
}: {
  rows: MetricsAssigneeSummary[];
  strings: MetricsStrings;
}) {
  return (
    <TableCard
      strings={strings}
      title={strings.assigneesTitle}
      description={strings.assigneesDescription}
      rows={rows}
      rowKey={(row) => row.id}
      empty={strings.assigneesEmpty}
      columns={[
        {
          key: "person",
          label: strings.assigneeColumn,
          cell: (row) => {
            const businessApp = row.id === "business_app";
            const label = businessApp
              ? strings.businessApp
              : (row.name ??
                (row.id === "" ? strings.unidentifiedPerson : strings.unknownUser(row.id)));
            return (
              <span className="flex min-w-0 items-center gap-2" title={label}>
                {businessApp || row.name === null ? (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    {businessApp ? (
                      <Smartphone aria-hidden className="size-3.5" />
                    ) : (
                      <UserRound aria-hidden className="size-3.5" />
                    )}
                  </span>
                ) : (
                  <Initials name={row.name} />
                )}
                <span
                  className={cn(
                    "min-w-0 truncate",
                    row.name === null && !businessApp && "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </span>
            );
          },
        },
        {
          key: "conversations",
          label: strings.conversationDaysColumn,
          numeric: true,
          secondary: true,
          cell: (row) => formatInteger(row.conversationDays),
        },
        {
          key: "messages",
          label: strings.messagesColumn,
          numeric: true,
          cell: (row) => formatInteger(row.messagesSent),
        },
        {
          key: "first",
          label: strings.firstResponsesColumn,
          numeric: true,
          secondary: true,
          cell: (row) => formatInteger(row.firstResponses),
        },
        {
          key: "median",
          label: strings.medianColumn,
          numeric: true,
          cell: (row) => duration(row.medianFirstResponseSeconds, strings),
        },
      ]}
    />
  );
}

export function SourceLabel({
  source,
  strings,
}: {
  source: string | null;
  strings: MetricsStrings;
}) {
  if (source === null) return <span className="text-muted-foreground">{strings.directSource}</span>;
  return (
    <span
      title={source}
      className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-px font-mono text-xs"
    >
      {source.startsWith("ad:") ? (
        <Megaphone aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <QrCode aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{source}</span>
    </span>
  );
}

export function SourcesTable({
  rows,
  strings,
}: {
  rows: MetricsSourceSummary[];
  strings: MetricsStrings;
}) {
  const total = rows.reduce((sum, row) => sum + row.conversations, 0);
  return (
    <TableCard
      strings={strings}
      title={strings.sourcesTitle}
      description={strings.sourcesDescription}
      rows={total === 0 ? [] : rows}
      rowKey={(row) => row.source ?? "__direct"}
      empty={strings.sourcesEmpty}
      columns={[
        {
          key: "source",
          label: strings.sourceColumn,
          cell: (row) => <SourceLabel source={row.source} strings={strings} />,
        },
        {
          key: "conversations",
          label: strings.conversationsColumn,
          numeric: true,
          cell: (row) => formatInteger(row.conversations),
        },
        {
          key: "share",
          label: strings.shareColumn,
          numeric: true,
          secondary: true,
          cell: (row) => (
            <span className="text-muted-foreground">
              {formatPercent(row.conversations / total)}
            </span>
          ),
        },
      ]}
    />
  );
}

export function TagsTable({
  rows,
  strings,
}: {
  rows: MetricsTagSummary[];
  strings: MetricsStrings;
}) {
  return (
    <TableCard
      strings={strings}
      title={strings.tagsTitle}
      description={strings.tagsDescription}
      rows={rows}
      rowKey={(row) => row.id ?? "__untagged"}
      empty={strings.tagsEmpty}
      columns={[
        {
          key: "tag",
          label: strings.tagColumn,
          cell: (row) => {
            const name = row.id === null ? strings.untagged : (row.name ?? row.id);
            return (
              <span className="flex min-w-0 items-center gap-2" title={name}>
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    row.color === null
                      ? "border border-dashed border-muted-foreground/60"
                      : TAG_DOT_CLASS[row.color],
                  )}
                />
                <span
                  className={cn("min-w-0 truncate", row.id === null && "text-muted-foreground")}
                >
                  {name}
                </span>
              </span>
            );
          },
        },
        {
          key: "conversations",
          label: strings.conversationsColumn,
          numeric: true,
          cell: (row) => formatInteger(row.conversations),
        },
        {
          key: "median",
          label: strings.medianColumn,
          numeric: true,
          secondary: "half",
          cell: (row) => duration(row.medianFirstResponseSeconds, strings),
        },
        {
          key: "ai",
          label: strings.aiResolvedColumn,
          numeric: true,
          cell: (row) =>
            row.closed === 0 ? (
              <span className="text-muted-foreground">{strings.noValue}</span>
            ) : (
              <>
                {formatPercent(row.aiResolved / row.closed)}
                <span className="ml-1 hidden text-xs text-muted-foreground sm:inline">
                  ({formatInteger(row.aiResolved)}/{formatInteger(row.closed)})
                </span>
              </>
            ),
        },
      ]}
    />
  );
}

export function CostPerAgentTable({
  rows,
  strings,
  className,
}: {
  rows: MetricsAgentCost[];
  strings: MetricsStrings;
  className?: string;
}) {
  return (
    <TableCard
      strings={strings}
      className={className}
      title={strings.costPerAgentTitle}
      rows={rows}
      rowKey={(row) => row.agent ?? "__unnamed"}
      empty={strings.costEmpty}
      columns={[
        {
          key: "agent",
          label: strings.agentColumn,
          cell: (row) => (
            <span
              title={row.agent ?? undefined}
              className={cn(
                "block truncate font-mono text-xs",
                row.agent === null && "text-muted-foreground",
              )}
            >
              {row.agent ?? strings.unnamedAgent}
            </span>
          ),
        },
        {
          key: "cost",
          label: strings.costColumn,
          numeric: true,
          cell: (row) => formatCost(row.costCents),
        },
        {
          key: "turns",
          label: strings.turnsColumn,
          numeric: true,
          secondary: true,
          cell: (row) => formatInteger(row.turns),
        },
        {
          key: "tokens",
          label: strings.tokensColumn,
          numeric: true,
          secondary: true,
          cell: (row) => `${formatInteger(row.tokensIn)} / ${formatInteger(row.tokensOut)}`,
        },
      ]}
    />
  );
}
