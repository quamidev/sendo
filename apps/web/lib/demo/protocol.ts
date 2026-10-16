// Contract of the live demo (`POST /api/demo`), shared by the route and the browser.
// No server-only imports here.
import type {
  InboxConversationView,
  InboxMessageView,
  InboxTagView,
} from "@/components/sendo/types";
import type { Lang } from "@/lib/i18n/langs";

/** Where the code lives; the scripted fallback points here. */
export const DEMO_CODE_URL = "https://github.com/quamidev/sendo";

/**
 * Request header carrying the signed session counter. The browser keeps the token in
 * `sessionStorage` and sends back the one each response returns (`DemoResponse.token`); the demo
 * sets no cookie (AC-ST-15).
 */
export const DEMO_TOKEN_HEADER = "x-sendo-demo";

/** Contact messages per browser session (signed counter token). */
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
 *   received the demo dictionary's `agent.handoffMessage`.
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
  /**
   * The page language: the agent greets in it (then follows the visitor's language), and the
   * scripted fallback, handoff message and names use it. Default `en`; `?lang=` works too.
   */
  lang?: Lang;
}

/**
 * Why the scripted fallback answered instead of the model. Every reason but `no_model` is a
 * limit (session, network, monthly budget, `SENDO_DEMO_DAILY_CAP`): the chat shows a small
 * "demo limit reached" note, never an error.
 */
export type DemoFallbackReason = "no_model" | "session_limit" | "ip_limit" | "budget" | "daily_cap";

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
  /** The new signed session counter: store it and send it in `DEMO_TOKEN_HEADER` next time. */
  token: string;
  inbox: DemoInboxSnapshot;
}

export interface DemoErrorResponse {
  error: "invalid_request" | "forbidden_origin" | "server_error";
  message: string;
}

/** Stable ids of the demo conversation in every snapshot. */
export const DEMO_CONVERSATION_ID = "demo-conversation";
export const DEMO_ACCOUNT_ID = "demo-account";
/** The demo building's agent (`senderRef` of its messages, key of `agentNames`). */
export const DEMO_AGENT_NAME = "torre-vista";
/** The visitor, as an operator of the demo inbox. */
export const DEMO_OPERATOR_ID = "demo-operator";
export const DEMO_TENANT_ID = "torre-vista";
