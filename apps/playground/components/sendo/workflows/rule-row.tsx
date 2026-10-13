"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock,
  Code2,
  Pencil,
  Split,
  Timer,
  Trash2,
  UserCheck,
  Archive,
  type LucideIcon,
} from "lucide-react";
import type { RuleType, Weekday } from "@quami/sendo/rules";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { pendingFadeClass, pressClass } from "./press";
import type { WorkflowsStrings } from "./strings";
import { numberName, ruleSummary } from "./summary";
import type { RuleNumberView, RuleRowView } from "./types";
import { validateRuleParams } from "./validation";

export const RULE_ICONS: Record<RuleType, LucideIcon> = {
  business_hours: Clock,
  route: Split,
  auto_assign: UserCheck,
  escalate: Timer,
  auto_close: Archive,
};

const dateFormat = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function updatedText(rule: RuleRowView, currentUserId: string | null, strings: WorkflowsStrings) {
  const date = dateFormat.format(new Date(rule.updatedAt));
  if (rule.updatedBy === null)
    return rule.origin === "code" ? strings.syncedOn(date) : strings.updatedOn(date);
  if (rule.updatedBy === currentUserId) return strings.updatedByYou(date);
  return rule.updatedByName === null
    ? strings.updatedOn(date)
    : strings.updatedBy(rule.updatedByName, date);
}

const ISSUES_SHOWN = 3;

/** The form label of a params path (`schedule.mon.0.0` → "Lunes, inicio del tramo 1"), else the path. */
function fieldName(path: string, strings: WorkflowsStrings): string {
  const [head, day, index, part] = path.split(".");
  if (head === "schedule" && day !== undefined && day in strings.weekdayLabels) {
    const dayLabel = strings.weekdayLabels[day as Weekday];
    if (part === "0") return strings.rangeStart(dayLabel, Number(index));
    if (part === "1") return strings.rangeEnd(dayLabel, Number(index));
    return dayLabel;
  }
  const labels: [string, string][] = [
    ["timezone", strings.timezoneLabel],
    ["holidays", strings.holidaysLegend],
    ["outsideMessage", strings.outsideMessageLabel],
    ["match.keywords", strings.keywordsLabel],
    ["match.source", strings.sourceLabel],
    ["match.channel", strings.channelLabel],
    ["match.account", strings.matchNumberLabel],
    ["action.queue", strings.routeQueueLabel],
    ["action.tags", strings.tagsLabel],
    ["action.reason", strings.reasonLabel],
    ["queue", strings.queueLabel],
    ["afterMinutes", strings.afterMinutesLabel],
    ["afterDays", strings.afterDaysLabel],
  ];
  return labels.find(([key]) => path === key || path.startsWith(`${key}.`))?.[1] ?? path;
}

/** The schema's complaints in Spanish (`field: message`), else the server's text. */
function invalidProblems(rule: RuleRowView, strings: WorkflowsStrings): string[] {
  const result = validateRuleParams(rule.type, rule.params, strings);
  if (!result.ok)
    return Object.entries(result.errors).map(
      ([path, message]) => `${fieldName(path, strings)}: ${message}`,
    );
  return rule.error === null ? [] : rule.error.split("\n");
}

const iconButton = cn(
  "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35",
  pressClass,
);

export interface RuleRowProps {
  rule: RuleRowView;
  index: number;
  total: number;
  numbers: RuleNumberView[];
  currentUserId: string | null;
  pending: boolean;
  strings: WorkflowsStrings;
  onToggle: (enabled: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** One rule: order controls, type icon, name, scope and summary (or the validation error), switch, actions. */
export function RuleRow({
  rule,
  index,
  total,
  numbers,
  currentUserId,
  pending,
  strings,
  onToggle,
  onMove,
  onEdit,
  onDelete,
}: RuleRowProps) {
  const Icon = RULE_ICONS[rule.type];
  const summary = rule.valid ? ruleSummary(rule, numbers, strings).join(" · ") : "";
  const problems = rule.valid ? [] : invalidProblems(rule, strings);
  const scope =
    rule.accountId === null ? strings.allNumbers : numberName(numbers, rule.accountId, strings);

  return (
    <div
      aria-busy={pending || undefined}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:px-4",
        pendingFadeClass,
        pending && "opacity-60",
        !rule.valid && "bg-destructive/[0.04]",
      )}
    >
      <div className="row-span-2 flex flex-col sm:row-span-1">
        <button
          type="button"
          className={iconButton}
          aria-label={strings.moveUp(rule.key)}
          data-move={`${rule.id}:up`}
          disabled={index === 0}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (!pending) onMove(-1);
          }}
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={strings.moveDown(rule.key)}
          data-move={`${rule.id}:down`}
          disabled={index === total - 1}
          aria-disabled={pending || undefined}
          onClick={() => {
            if (!pending) onMove(1);
          }}
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
      </div>

      <div
        className={cn(
          "hidden size-9 shrink-0 place-items-center rounded-lg border sm:grid",
          rule.valid ? "bg-muted/50 text-foreground" : "border-destructive/40 text-destructive",
        )}
        aria-hidden
      >
        {rule.valid ? <Icon className="size-4" /> : <AlertTriangle className="size-4" />}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 text-sm font-semibold break-words [overflow-wrap:anywhere]">
            {rule.key}
          </h3>
          {rule.origin === "code" && (
            <span
              title={strings.originCodeHint}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
            >
              <Code2 className="size-3" aria-hidden />
              {strings.originCode}
            </span>
          )}
          {!rule.active && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {strings.inactive}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {strings.typeLabels[rule.type]} · {scope}
        </p>
        {rule.valid ? (
          <p
            className="mt-1 line-clamp-3 text-[13px] text-foreground/80 [overflow-wrap:anywhere]"
            title={summary}
          >
            {summary}
          </p>
        ) : (
          <div
            role="note"
            className="mt-1.5 rounded-md border border-destructive/30 bg-background px-2.5 py-2 text-xs"
          >
            <p className="font-medium text-destructive">
              {strings.invalidTitle}. {strings.invalidBody}
            </p>
            {problems.length > 0 && (
              <ul className="mt-1 grid gap-0.5 text-muted-foreground [overflow-wrap:anywhere]">
                {problems.slice(0, ISSUES_SHOWN).map((problem) => (
                  <li key={problem}>
                    <code className="font-mono text-[11px]">{problem}</code>
                  </li>
                ))}
                {problems.length > ISSUES_SHOWN && (
                  <li>{strings.invalidMore(problems.length - ISSUES_SHOWN)}</li>
                )}
              </ul>
            )}
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground" suppressHydrationWarning>
          {updatedText(rule, currentUserId, strings)}
        </p>
      </div>

      <div className="col-start-2 flex items-center gap-1 sm:col-start-auto sm:self-center">
        <Switch
          checked={rule.active}
          disabled={pending}
          onCheckedChange={onToggle}
          aria-label={strings.activeLabel(rule.key)}
          className="mr-2 transition-[background-color,box-shadow]"
        />
        <button
          type="button"
          className={iconButton}
          aria-label={strings.editLabel(rule.key)}
          onClick={onEdit}
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={cn(iconButton, "hover:bg-destructive/10 hover:text-destructive")}
          aria-label={strings.removeLabel(rule.key)}
          disabled={pending}
          onClick={onDelete}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
