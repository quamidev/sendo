"use client";

import { createContext, useContext } from "react";
import type { InboxStrings } from "./strings";

/** Who is who: the operator, display names of team members and of the AI agents. */
export interface InboxPeople {
  currentUserId: string;
  currentUserName: string | null;
  /** User id → display name (`resolveUserNames()` in inbox-config, assignees). */
  names: Readonly<Record<string, string>>;
  /** Agent name (`senderRef` of agent messages) → display name, e.g. `recepcion` → "Recepción IA". */
  agentNames: Readonly<Record<string, string>>;
}

export const InboxPeopleContext = createContext<InboxPeople>({
  currentUserId: "",
  currentUserName: null,
  names: {},
  agentNames: {},
});

export function useInboxPeople(): InboxPeople {
  return useContext(InboxPeopleContext);
}

/** A team member by user id: their name, "Tú" for the operator, else "Persona del equipo". */
export function personName(
  userId: string | null,
  people: InboxPeople,
  strings: InboxStrings,
): string {
  if (userId === null) return strings.actorPerson;
  const known = people.names[userId];
  if (known !== undefined && known.trim() !== "") return known;
  if (userId === people.currentUserId) return people.currentUserName ?? strings.you;
  return strings.actorPerson;
}

export function agentName(name: string | null, people: InboxPeople, strings: InboxStrings): string {
  if (name !== null) {
    const known = people.agentNames[name];
    if (known !== undefined) return known;
  }
  return strings.actorAgent(name);
}

/**
 * The `by` of a handoff, system line or pause: `agent:<name>`, `rule:<key>`, `system`,
 * `business_app` or a user id.
 */
export function actorName(by: string, people: InboxPeople, strings: InboxStrings): string {
  if (by.startsWith("agent:")) return agentName(by.slice("agent:".length) || null, people, strings);
  if (by.startsWith("rule:")) return strings.actorRule(by.slice("rule:".length));
  if (by === "system") return strings.actorSystem;
  if (by === "business_app") return strings.actorPhone;
  return personName(by, people, strings);
}
