/** Language of the text Sendo itself sends to end customers (handoff, opt-out confirmation). */
export type SendoLocale = "es" | "en";

export const SENDO_LOCALES: readonly SendoLocale[] = ["en", "es"];

/** Text Sendo sends to end customers when the app doesn't override it. */
export interface BuiltInMessages {
  /** Sent on handoff (`handoffMessage` overrides it). */
  handoff: string;
  /** Sent inside the window after a keyword opt-out (`optOut.confirmation` overrides it). */
  optOutConfirmation: string;
}

/** The built-in end-customer messages per `createSendo({ locale })`. */
export const BUILT_IN_MESSAGES: Record<SendoLocale, BuiltInMessages> = {
  en: {
    handoff: "Connecting you with someone from the team.",
    optOutConfirmation:
      "Done, we won't send you promotional messages anymore. If you change your mind, message us.",
  },
  es: {
    handoff: "Te comunico con una persona del equipo.",
    optOutConfirmation:
      "Listo, ya no te enviaremos mensajes promocionales. Si cambias de opinión, escríbenos.",
  },
};

/** `metadata.event` of a system line; the inbox renders it from `event` + `params`. */
export type SystemEventName =
  | "handoff"
  | "assigned"
  | "unassigned"
  | "returned"
  | "closed"
  | "agent_paused"
  | "agent_resumed"
  | "routed"
  | "after_hours"
  | "escalated";

/** Every `SystemEventName`, keyed for code (`SYSTEM_LINE_EVENTS.agentPaused === "agent_paused"`). */
export const SYSTEM_LINE_EVENTS = {
  handoff: "handoff",
  assigned: "assigned",
  unassigned: "unassigned",
  returned: "returned",
  closed: "closed",
  agentPaused: "agent_paused",
  agentResumed: "agent_resumed",
  routed: "routed",
  afterHours: "after_hours",
  escalated: "escalated",
} as const satisfies Record<string, SystemEventName>;

/** Values a system line interpolates, stored as top-level `metadata` keys. */
export type SystemLineParams = Record<string, string | number | boolean | null>;

/** A system line about to be stored: what happened, who did it and what the sentence needs. */
export interface SystemLineSpec {
  kind: "system" | "rule";
  event: SystemEventName;
  /** `metadata.by`: a user id, `"system"`, `"business_app"`, `"agent:<name>"` or `"rule:<key>"`. */
  by: string;
  /** `by` as a display name ("Sendo", "The agent recepcion", "Ana López"). */
  subject: string;
  params: SystemLineParams;
}

/** The English sentence stored in a system line's `text` (search, previews, legacy clients). */
export function systemLineText(line: SystemLineSpec): string {
  const { event, params, subject } = line;
  const assignee = String(params.assignedToName ?? params.assignedTo ?? "");
  if (line.kind === "rule") return ruleLineText(event, params, assignee);
  switch (event) {
    case "handoff": {
      const assigned = params.assignedTo == null ? "" : ` · Assigned to ${assignee}`;
      return `${subject} handed the conversation to a person · ${String(params.reason ?? "")}${assigned}`;
    }
    case "assigned":
      return params.assignedTo === line.by
        ? `${assignee} took the conversation`
        : `${subject} assigned the conversation to ${assignee}`;
    case "unassigned":
      return `${subject} removed the assignment`;
    case "returned":
      return `${subject} returned the conversation to the agent`;
    case "closed":
      return `${subject} closed the conversation`;
    case "agent_paused":
      return `${subject} paused the agent in this conversation`;
    case "agent_resumed":
      return `${subject} resumed the agent`;
    case "routed":
    case "after_hours":
    case "escalated":
      return ruleLineText(event, params, assignee);
  }
}

function ruleLineText(event: SystemEventName, params: SystemLineParams, assignee: string): string {
  const rule = `rule «${String(params.ruleKey ?? "")}»`;
  const waited =
    typeof params.minutesWaiting === "number"
      ? ` (${String(params.minutesWaiting)} min without a reply)`
      : "";
  const routing = [
    typeof params.queue === "string" ? `queue «${params.queue}»` : null,
    typeof params.tags === "string" && params.tags !== "" ? `tags: ${params.tags}` : null,
  ].filter((p) => p !== null);
  const detail = routing.length > 0 ? ` (${routing.join("; ")})` : "";
  switch (event) {
    case "handoff":
      return `Handed to a person by ${rule}${detail}`;
    case "routed":
      return `Routed by ${rule}${detail}`;
    case "assigned":
      return waited === ""
        ? `Assigned to ${assignee} by ${rule}`
        : `Reassigned to ${assignee} by ${rule}${waited}`;
    case "escalated":
      return `Escalated by ${rule}${waited}`;
    case "returned":
      return `Returned to the agent by ${rule}${waited}`;
    case "closed": {
      const days = Number(params.afterDays ?? 0);
      return `Closed by ${rule} after ${String(days)} ${days === 1 ? "day" : "days"} without activity`;
    }
    case "after_hours":
      return `After-hours message sent by ${rule}`;
    case "unassigned":
      return `Assignment removed by ${rule}`;
    case "agent_paused":
      return `Agent paused by ${rule}`;
    case "agent_resumed":
      return `Agent resumed by ${rule}`;
  }
}
