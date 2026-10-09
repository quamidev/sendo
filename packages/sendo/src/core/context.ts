import type { SendoAdapter } from "../adapters/types";
import type { ResolvedTeamConfig } from "../team/config";
import type { Transport } from "../transport/types";
import type { Account, Contact, Conversation, Message } from "../types/entities";
import type { RedactingLogger } from "../utils/logger";
import type { ResolveAccount } from "./accounts";
import type { ResolvedSendoConfig } from "./config";
import type { Sendo } from "./create-sendo";
import type { SendoEmitter } from "./events";
import type { SendoServices } from "./services";
import type { SendoSlots } from "./slots";

export interface AgentInboundInput {
  account: Account;
  contact: Contact;
  conversation: Conversation;
  message: Message;
}

/** Set by the agent runtime (WAL-3.1); called by the pipeline (WAL-2.7) for `agent` conversations. */
export interface AgentDispatcher {
  handleInbound(input: AgentInboundInput): Promise<void>;
}

/**
 * Where the rules engine plugs into the pipeline and the runtime. SND-3.4 implements it
 * (assigned by `installRules`); SND-3.2 and SND-3.4 wire the call sites.
 */
export interface RulesHooks {
  /** New or reopened conversation, after source attribution; may set queue/tags/handoff. */
  onNewConversation(i: {
    account: Account;
    contact: Contact;
    conversation: Conversation;
    message: Message;
  }): Promise<Conversation>;
  /** Conversation just entered `human` (handoff, take, rule); may auto-assign. */
  onEnterHuman(i: {
    account: Account;
    conversation: Conversation;
    by: string;
  }): Promise<Conversation>;
  /** Every inbound message; may send the after-hours message. */
  onInbound(i: { account: Account; conversation: Conversation; message: Message }): Promise<void>;
  /** `true` → the agent must not run a turn (business_hours appliesTo "all", outside hours). */
  holdsAgent(i: { account: Account; conversation: Conversation; now: Date }): Promise<boolean>;
}

/** No rules: conversations pass through unchanged and the agent is never held. */
export function createNoopRulesHooks(): RulesHooks {
  return {
    onNewConversation: (i) => Promise.resolve(i.conversation),
    onEnterHuman: (i) => Promise.resolve(i.conversation),
    onInbound: () => Promise.resolve(),
    holdsAgent: () => Promise.resolve(false),
  };
}

/**
 * Internal state shared by every namespace of one `createSendo` client.
 * Not part of the public API: get it with `getContext(sendo)`.
 */
export interface SendoContext {
  config: ResolvedSendoConfig;
  /** Team, rules and reach config (`team/config.ts`). */
  team: ResolvedTeamConfig;
  adapter: SendoAdapter;
  transport: Transport;
  /** Redacts every known token and secret. */
  logger: RedactingLogger;
  emitter: SendoEmitter;
  resolveAccount: ResolveAccount;
  services: SendoServices;
  /** Assignable namespaces (see `SendoSlots`); stubs until their module assigns them. */
  slots: SendoSlots;
  agentDispatcher?: AgentDispatcher;
  /** No-op until the rules module (SND-3.4) assigns it. */
  rulesHooks: RulesHooks;
  /** The public client (set by `createSendo` after the modules are installed). */
  client?: Sendo;
  /**
   * Lazy one-time schema check (warns when `adapter.schemaVersion()` is older than
   * `SENDO_SCHEMA_VERSION` or null). Public entry points await it before using the adapter.
   */
  ready(): Promise<void>;
  /**
   * Runs a Meta/transport call for an account. A `MetaApiError` with code 190 emits
   * `account.error` before being rethrown.
   */
  callTransport<T>(account: Account, fn: () => Promise<T>): Promise<T>;
  /** Registers a value (e.g. a resolved token) the logger must redact. */
  addSecret(value: string): void;
  secrets(): readonly string[];
  /** `normalizePhone` with the configured `defaultCountry`. */
  normalizePhone(input: string): string;
}

const contexts = new WeakMap<object, SendoContext>();

export function attachContext(client: object, ctx: SendoContext): void {
  contexts.set(client, ctx);
}

/** The internal context of a client built by `createSendo`. */
export function getContext(client: object): SendoContext {
  const ctx = contexts.get(client);
  if (!ctx) throw new TypeError("Not a sendo client created by createSendo().");
  return ctx;
}
