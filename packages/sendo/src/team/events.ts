import type { RuleRef } from "../rules/schemas";
import type { Conversation } from "../types/entities";

export interface ConversationAssignedEvent {
  conversation: Conversation;
  from: string | null;
  to: string | null;
  /** A user id, `"system"` or `"rule:<key>"`. */
  by: string;
}

export interface ConversationAgentPausedEvent {
  conversation: Conversation;
  paused: boolean;
  by: string;
}

export interface EscalationEvent {
  conversation: Conversation;
  rule: RuleRef;
  minutesWaiting: number;
}

export interface RuleAppliedEvent {
  rule: RuleRef;
  conversation: Conversation;
  /** What the rule did, e.g. `"route"`, `"assign"`, `"after_hours_message"`, `"close"`. */
  action: string;
}

/** Merged into `SendoEventMap` by intersection. */
export interface TeamEventMap {
  "conversation.assigned": ConversationAssignedEvent;
  "conversation.agent_paused": ConversationAgentPausedEvent;
  escalation: EscalationEvent;
  "rule.applied": RuleAppliedEvent;
}
