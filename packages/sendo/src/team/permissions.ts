import { ForbiddenError } from "../errors/errors";
import type { TenantId } from "../types/entities";

/**
 * The single server-side source of truth for who may do what (product spec AC-RL-2).
 * Actions every role has on a visible conversation (reply, step in, note, tag, approve
 * drafts, take, return to the AI, close) need no capability: `canSeeConversation` gates them.
 */

export const ROLES = ["agent", "supervisor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export interface Actor {
  userId: string;
  tenantId: TenantId;
  role: Role;
  /** Queues the user works; agents see unassigned conversations in these. */
  queues: string[];
}

export type Capability =
  | "conversations.view_all"
  | "conversations.reassign"
  | "conversations.pause_agent"
  | "metrics.view"
  | "costs.view"
  | "numbers.manage"
  | "rules.manage"
  | "snippets.manage_tenant"
  | "tags.manage"
  | "broadcasts.manage";

const SUPERVISOR_AND_ADMIN: readonly Role[] = ["supervisor", "admin"];
const ADMIN_ONLY: readonly Role[] = ["admin"];

const MATRIX: Readonly<Record<Capability, readonly Role[]>> = {
  "conversations.view_all": SUPERVISOR_AND_ADMIN,
  "conversations.reassign": SUPERVISOR_AND_ADMIN,
  "conversations.pause_agent": SUPERVISOR_AND_ADMIN,
  "metrics.view": SUPERVISOR_AND_ADMIN,
  "costs.view": ADMIN_ONLY,
  "numbers.manage": ADMIN_ONLY,
  "rules.manage": ADMIN_ONLY,
  "snippets.manage_tenant": ADMIN_ONLY,
  "tags.manage": ADMIN_ONLY,
  "broadcasts.manage": ADMIN_ONLY,
};

const GRANTS = new Map<string, ReadonlySet<string>>(
  Object.entries(MATRIX).map(([capability, roles]) => [capability, new Set<string>(roles)]),
);

export const CAPABILITIES = Object.keys(MATRIX) as Capability[];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Fails closed: an unknown role or capability (untyped callers) is never granted. */
export function can(actor: Actor, capability: Capability): boolean {
  return GRANTS.get(capability)?.has(actor.role) ?? false;
}

/** Throws `ForbiddenError` (`FORBIDDEN`, `{ capability, role }`) when `can` is false. */
export function assertCan(actor: Actor, capability: Capability): void {
  if (!can(actor, capability)) throw new ForbiddenError({ capability, role: actor.role });
}

/** The conversation fields visibility depends on (a `Conversation` satisfies it). */
export interface ConversationVisibility {
  tenantId: TenantId;
  assignedTo: string | null;
  queue: string | null;
}

/**
 * Same tenant, then: supervisors and admins see everything; agents see conversations
 * assigned to them plus unassigned ones in their queues. An unassigned conversation
 * with no queue (`queue === null`, the default when no routing rule set one) is in the
 * tenant's general queue and visible to every agent.
 */
export function canSeeConversation(actor: Actor, conversation: ConversationVisibility): boolean {
  if (conversation.tenantId !== actor.tenantId) return false;
  if (can(actor, "conversations.view_all")) return true;
  if (!isRole(actor.role)) return false;
  if (conversation.assignedTo !== null) return conversation.assignedTo === actor.userId;
  return conversation.queue === null || actor.queues.includes(conversation.queue);
}

/** Throws `ForbiddenError` (`capability: null`) when the actor cannot see the conversation. */
export function assertCanSeeConversation(actor: Actor, conversation: ConversationVisibility): void {
  if (!canSeeConversation(actor, conversation)) {
    throw new ForbiddenError({ capability: null, role: actor.role });
  }
}
