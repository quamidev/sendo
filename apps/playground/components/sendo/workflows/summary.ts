import { WEEKDAYS, type Weekday } from "@quami/sendo/rules";
import { draftsFromRule, type TimeRangeDraft } from "./drafts";
import type { WorkflowsStrings } from "./strings";
import { findNumber, type RuleNumberView, type RuleRowView } from "./types";

// One-line, human summaries of a valid rule's params for the list rows.

const KEYWORDS_SHOWN = 3;

export function numberName(
  numbers: RuleNumberView[],
  ref: string,
  strings: WorkflowsStrings,
): string {
  const number = findNumber(numbers, ref);
  if (number === undefined) return strings.unknownNumber(ref);
  const name = number.label ?? number.displayPhone;
  return number.active ? name : strings.disconnectedNumber(name);
}

function rangesText(ranges: TimeRangeDraft[]): string {
  return ranges.map((range) => `${range.start}–${range.end}`).join(", ");
}

/** "L–V 09:00–18:00 · S 09:00–13:00": consecutive days with the same hours are grouped. */
function scheduleText(
  schedule: Record<Weekday, TimeRangeDraft[]>,
  strings: WorkflowsStrings,
): string {
  const groups: { from: Weekday; to: Weekday; hours: string }[] = [];
  for (const day of WEEKDAYS) {
    const hours = rangesText(schedule[day]);
    const last = groups.at(-1);
    if (
      hours !== "" &&
      last !== undefined &&
      last.hours === hours &&
      WEEKDAYS.indexOf(last.to) === WEEKDAYS.indexOf(day) - 1
    ) {
      last.to = day;
    } else if (hours !== "") {
      groups.push({ from: day, to: day, hours });
    }
  }
  if (groups.length === 0) return strings.summaryClosedAllWeek;
  return groups
    .map(({ from, to, hours }) => {
      const days =
        from === to
          ? strings.weekdayShort[from]
          : `${strings.weekdayShort[from]}–${strings.weekdayShort[to]}`;
      return `${days} ${hours}`;
    })
    .join(" · ");
}

/** The parts of a rule's summary (joined with " · " by the row). */
export function ruleSummary(
  rule: Pick<RuleRowView, "type" | "params">,
  numbers: RuleNumberView[],
  strings: WorkflowsStrings,
): string[] {
  const drafts = draftsFromRule(rule.type, rule.params);
  switch (rule.type) {
    case "business_hours": {
      const draft = drafts.business_hours;
      return [
        scheduleText(draft.schedule, strings),
        draft.timezone,
        ...(draft.holidays.length > 0 ? [strings.summaryHolidays(draft.holidays.length)] : []),
        strings.summaryAppliesTo[draft.appliesTo],
      ];
    }
    case "route": {
      const draft = drafts.route;
      const conditions = [
        ...(draft.keywords.length > 0
          ? [
              strings.summaryKeywords(
                draft.keywords.slice(0, KEYWORDS_SHOWN),
                Math.max(0, draft.keywords.length - KEYWORDS_SHOWN),
              ),
            ]
          : []),
        ...(draft.source !== "" ? [strings.summarySource(draft.source)] : []),
        ...(draft.channel !== "" ? [strings.summaryChannel] : []),
        ...(draft.account !== ""
          ? [strings.summaryNumber(numberName(numbers, draft.account, strings))]
          : []),
      ];
      const action = [
        ...(draft.queue.trim() !== "" ? [strings.summaryToQueue(draft.queue.trim())] : []),
        ...(draft.tags.length > 0
          ? [
              strings.summaryTags(
                draft.tags.slice(0, KEYWORDS_SHOWN),
                Math.max(0, draft.tags.length - KEYWORDS_SHOWN),
              ),
            ]
          : []),
        strings.summaryTo[draft.to],
      ];
      return [
        `${conditions.length > 0 ? conditions.join(", ") : strings.summaryAnyConversation} → ${action.join(", ")}`,
      ];
    }
    case "auto_assign": {
      const draft = drafts.auto_assign;
      return [
        queueText(draft.queueMode, draft.queue, strings),
        strings.strategyLabels[draft.strategy],
      ];
    }
    case "escalate": {
      const draft = drafts.escalate;
      return [
        strings.summaryEscalate(
          strings.minutes(Number(draft.afterMinutes)),
          strings.escalateActionLabels[draft.action],
        ),
        queueText(draft.queueMode, draft.queue, strings),
      ];
    }
    case "auto_close":
      return [strings.summaryAutoClose(strings.days(Number(drafts.auto_close.afterDays)))];
  }
}

function queueText(
  mode: "any" | "none" | "named",
  queue: string,
  strings: WorkflowsStrings,
): string {
  if (mode === "any") return strings.summaryAnyQueue;
  if (mode === "none") return strings.summaryNoQueue;
  return strings.summaryQueue(queue.trim());
}
