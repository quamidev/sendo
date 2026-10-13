import { WEEKDAYS, type RuleType, type Weekday } from "@quami/sendo/rules";

// Form state per rule type. Drafts hold what the admin typed (numbers as text, empty strings for
// "not set"); `paramsFromDraft` turns them into params for the package schema. `draftFromParams`
// reads stored params defensively: an invalid stored rule still opens in the editor.

export interface TimeRangeDraft {
  start: string;
  end: string;
}

export interface BusinessHoursDraft {
  timezone: string;
  schedule: Record<Weekday, TimeRangeDraft[]>;
  holidays: string[];
  outsideMessage: string;
  appliesTo: "human" | "all";
}

/** `any` = the param is omitted (every queue); `none` = `null` (conversations without queue). */
export type QueueMode = "any" | "none" | "named";

export interface RouteDraft {
  keywords: string[];
  source: string;
  channel: "" | "whatsapp";
  /** Account id or phone number id; `""` = any number. */
  account: string;
  queue: string;
  tags: string[];
  to: "agent" | "human";
  reason: string;
}

export interface AutoAssignDraft {
  queueMode: QueueMode;
  queue: string;
  strategy: "least_open" | "round_robin";
}

export interface EscalateDraft {
  afterMinutes: string;
  queueMode: QueueMode;
  queue: string;
  action: "reassign" | "notify" | "return_to_agent";
}

export interface AutoCloseDraft {
  afterDays: string;
}

export interface RuleDrafts {
  business_hours: BusinessHoursDraft;
  route: RouteDraft;
  auto_assign: AutoAssignDraft;
  escalate: EscalateDraft;
  auto_close: AutoCloseDraft;
}

export const RULE_TYPE_ORDER = [
  "business_hours",
  "route",
  "auto_assign",
  "escalate",
  "auto_close",
] as const satisfies readonly RuleType[];

const WORKDAY_RANGE: TimeRangeDraft = { start: "09:00", end: "18:00" };

/** The browser's (or server's) IANA zone; the default for a new business-hours rule. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function emptyDrafts(timezone = localTimeZone()): RuleDrafts {
  const schedule = Object.fromEntries(
    WEEKDAYS.map((day) => [day, day === "sat" || day === "sun" ? [] : [{ ...WORKDAY_RANGE }]]),
  ) as Record<Weekday, TimeRangeDraft[]>;
  return {
    business_hours: {
      timezone,
      schedule,
      holidays: [],
      outsideMessage: "",
      appliesTo: "human",
    },
    route: {
      keywords: [],
      source: "",
      channel: "",
      account: "",
      queue: "",
      tags: [],
      to: "human",
      reason: "",
    },
    auto_assign: { queueMode: "any", queue: "", strategy: "least_open" },
    escalate: { afterMinutes: "15", queueMode: "any", queue: "", action: "reassign" },
    auto_close: { afterDays: "3" },
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text) : [];
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function queueDraft(value: unknown): { queueMode: QueueMode; queue: string } {
  if (value === undefined) return { queueMode: "any", queue: "" };
  if (value === null) return { queueMode: "none", queue: "" };
  return { queueMode: "named", queue: text(value) };
}

/** The editor's drafts for a stored rule: its own type from `params`, the rest from defaults. */
export function draftsFromRule(type: RuleType, rawParams: unknown): RuleDrafts {
  const drafts = emptyDrafts();
  const params = record(rawParams);
  switch (type) {
    case "business_hours": {
      const schedule = record(params.schedule);
      drafts.business_hours = {
        timezone: text(params.timezone),
        schedule: Object.fromEntries(
          WEEKDAYS.map((day) => {
            const ranges = Array.isArray(schedule[day]) ? (schedule[day] as unknown[]) : [];
            return [
              day,
              ranges.map((range) => {
                const pair = Array.isArray(range) ? (range as unknown[]) : [];
                return { start: text(pair[0]), end: text(pair[1]) };
              }),
            ];
          }),
        ) as Record<Weekday, TimeRangeDraft[]>,
        holidays: texts(params.holidays),
        outsideMessage: text(params.outsideMessage),
        appliesTo: oneOf(params.appliesTo, ["human", "all"], "human"),
      };
      break;
    }
    case "route": {
      const match = record(params.match);
      const action = record(params.action);
      drafts.route = {
        keywords: texts(match.keywords),
        source: text(match.source),
        channel: oneOf(match.channel, ["", "whatsapp"], ""),
        account: text(match.account),
        queue: text(action.queue),
        tags: texts(action.tags),
        to: oneOf(action.to, ["agent", "human"], "human"),
        reason: text(action.reason),
      };
      break;
    }
    case "auto_assign":
      drafts.auto_assign = {
        ...queueDraft(params.queue),
        strategy: oneOf(params.strategy, ["least_open", "round_robin"], "least_open"),
      };
      break;
    case "escalate":
      drafts.escalate = {
        afterMinutes: text(params.afterMinutes),
        ...queueDraft(params.queue),
        action: oneOf(params.action, ["reassign", "notify", "return_to_agent"], "reassign"),
      };
      break;
    case "auto_close":
      drafts.auto_close = { afterDays: text(params.afterDays) };
      break;
  }
  return drafts;
}

/** `""` → `undefined` (required error), otherwise `Number(...)` (NaN → "write a number"). */
function numberOrUndefined(value: string): number | undefined {
  return value.trim() === "" ? undefined : Number(value.trim());
}

function queueParam(mode: QueueMode, queue: string): { queue?: string | null } {
  if (mode === "any") return {};
  if (mode === "none") return { queue: null };
  return { queue };
}

/** Params for the package schema (`ruleParamsSchemas[type]`), straight from the draft. */
export function paramsFromDraft(type: RuleType, drafts: RuleDrafts): Record<string, unknown> {
  switch (type) {
    case "business_hours": {
      const draft = drafts.business_hours;
      return {
        timezone: draft.timezone.trim(),
        schedule: Object.fromEntries(
          WEEKDAYS.map((day) => [
            day,
            draft.schedule[day].map((range) => [range.start.trim(), range.end.trim()]),
          ]),
        ),
        holidays: draft.holidays,
        outsideMessage: draft.outsideMessage,
        appliesTo: draft.appliesTo,
      };
    }
    case "route": {
      const draft = drafts.route;
      return {
        match: {
          ...(draft.channel !== "" && { channel: draft.channel }),
          ...(draft.account !== "" && { account: draft.account }),
          ...(draft.source.trim() !== "" && { source: draft.source.trim() }),
          ...(draft.keywords.length > 0 && { keywords: draft.keywords }),
        },
        action: {
          ...(draft.queue.trim() !== "" && { queue: draft.queue }),
          ...(draft.tags.length > 0 && { tags: draft.tags }),
          to: draft.to,
          ...(draft.reason.trim() !== "" && { reason: draft.reason }),
        },
      };
    }
    case "auto_assign": {
      const draft = drafts.auto_assign;
      return { ...queueParam(draft.queueMode, draft.queue), strategy: draft.strategy };
    }
    case "escalate": {
      const draft = drafts.escalate;
      return {
        afterMinutes: numberOrUndefined(draft.afterMinutes),
        ...queueParam(draft.queueMode, draft.queue),
        action: draft.action,
      };
    }
    case "auto_close": {
      const draft = drafts.auto_close;
      return { afterDays: numberOrUndefined(draft.afterDays) };
    }
  }
}

/** Splits typed or pasted text into chips: commas and new lines separate, blanks are dropped. */
export function splitChips(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Adds chips once each (accent- and case-insensitive, like the engine's keyword match). */
export function addChips(current: string[], added: string[]): string[] {
  const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const seen = new Set(current.map(fold));
  const next = [...current];
  for (const value of added) {
    const key = fold(value);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  return next;
}
