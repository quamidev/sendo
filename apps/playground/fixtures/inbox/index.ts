import type { FixtureConversation } from "../types";
import { emptyConversation } from "./empty";
import { failedSend } from "./failed-send";
import { longName } from "./long-name";
import { longThread } from "./long-thread";
import { missingMedia } from "./missing-media";
import { mixedConversations } from "./mixed";
import { teamConversations } from "./team";
import { voiceNotes } from "./voice-notes";

export { LONG_CONTACT_NAME } from "./long-name";
export { LONG_THREAD_LENGTH } from "./long-thread";
export { OTHER_OPERATOR_ID } from "./mixed";
export {
  FIXTURE_SNIPPETS,
  fixtureSnippetVariables,
  LONGEST_SHORTCUT,
  UNRESOLVED_SNIPPET,
  visibleToDevUser,
} from "./snippets";
export { LONG_HANDOFF_REASON, PLAYGROUND_DISCONNECTED_ACCOUNT, TWELVE_TAGS } from "./team";

/** Inbox edge cases seeded in fixtures mode. */
export const INBOX_FIXTURES: FixtureConversation[] = [
  longName,
  longThread,
  emptyConversation,
  failedSend,
  missingMedia,
  voiceNotes,
  ...mixedConversations,
  ...teamConversations,
];
