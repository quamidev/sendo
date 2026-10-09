import type { FixtureConversation } from "../types";

/** A conversation without messages (e.g. created and then its messages pruned). */
export const emptyConversation: FixtureConversation = {
  key: "vacia",
  contact: { phone: "+50255551003", profileName: "Conversación vacía" },
  status: "agent",
  createdMinutesAgo: 240,
  messages: [],
};
