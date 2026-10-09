// Contract of the live demo (`POST /api/demo`), shared by the route and the browser.
// No server-only imports here.
import type {
  InboxConversationView,
  InboxMessageView,
  InboxTagView,
} from "@/components/sendo/types";

/** Where the code lives; the scripted fallback points here. */
export const DEMO_CODE_URL = "https://github.com/quamidev/sendo";

/** The scripted fallback reply (product spec, edge cases: "Live demo budget exhausted"). */
export const DEMO_FALLBACK_TEXT = `El demo descansa un momento; mira el código en ${DEMO_CODE_URL}`;

/** Sent to the contact when the agent hands the conversation to people. */
export const DEMO_HANDOFF_MESSAGE =
  "Te comunico con una persona del equipo de administración; te escribirán por aquí.";

/** Contact messages per browser session (signed cookie). */
export const DEMO_SESSION_LIMIT = 20;
/** Contact messages per IP per UTC day. */
export const DEMO_IP_DAILY_LIMIT = 200;
/** Output cap of every model call. */
export const DEMO_MAX_OUTPUT_TOKENS = 300;
/** Longest message a visitor can send. */
export const DEMO_TEXT_MAX_LENGTH = 500;
/** Longest transcript the server replays. */
export const DEMO_TRANSCRIPT_MAX_TURNS = 80;

/**
 * One line of the demo conversation, kept by the browser:
 * - `contact`: the visitor, writing as a customer on WhatsApp;
 * - `agent`: the AI agent's reply;
 * - `team`: a person replying from the demo inbox (step-in);
 * - `handoff`: the agent handed the conversation to people (`text` is the reason); the contact
 *   received `DEMO_HANDOFF_MESSAGE`.
 */
export interface DemoTurn {
  role: "contact" | "agent" | "team" | "handoff";
  text: string;
  /** ISO timestamp. */
  at: string;
}

export interface DemoRequest {
  /** Everything before `text`, oldest first. The server keeps nothing between requests. */
  transcript: DemoTurn[];
  text: string;
  /** `team` replies from the demo inbox: no agent turn, no model call. Default `contact`. */
  from?: "contact" | "team";
}

/** Why the scripted fallback answered instead of the model. */
export type DemoFallbackReason = "no_model" | "session_limit" | "ip_limit" | "budget";

/** The demo conversation as the team sees it in the inbox (ids are stable across requests). */
export interface DemoInboxSnapshot {
  conversation: InboxConversationView;
  /** Oldest first. */
  thread: InboxMessageView[];
  names: Record<string, string>;
}

/** The other conversations of the demo inbox, computed on the server (`/demo/inbox`). */
export interface InboxSnapshot {
  conversations: InboxConversationView[];
  /** Conversation id → messages, oldest first. */
  threads: Record<string, InboxMessageView[]>;
  tags: InboxTagView[];
  names: Record<string, string>;
}

export interface DemoResponse {
  /** The message just sent, with the server's timestamp. */
  turn: DemoTurn;
  /** What happened after it: agent replies and a handoff, oldest first. */
  messages: DemoTurn[];
  fallback: DemoFallbackReason | null;
  /** Contact messages left in this session. */
  remaining: number;
  inbox: DemoInboxSnapshot;
}

export interface DemoErrorResponse {
  error: "invalid_request" | "forbidden_origin" | "server_error";
  message: string;
}

/** Stable ids of the demo conversation in every snapshot. */
export const DEMO_CONVERSATION_ID = "demo-conversation";
export const DEMO_ACCOUNT_ID = "demo-account";
/** The visitor, as an operator of the demo inbox. */
export const DEMO_OPERATOR_ID = "demo-operator";
export const DEMO_TENANT_ID = "torre-vista";
