import type { SendoAdapter } from "../adapters/types";
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
 * Internal state shared by every namespace of one `createSendo` client.
 * Not part of the public API: get it with `getContext(sendo)`.
 */
export interface SendoContext {
  config: ResolvedSendoConfig;
  adapter: SendoAdapter;
  transport: Transport;
  /** Redacts every known token and secret. */
  logger: RedactingLogger;
  emitter: SendoEmitter;
  resolveAccount: ResolveAccount;
  services: SendoServices;
  /** Assignable namespaces (`handleWebhook`, `events`, `maintenance`, `inbox`, `agent`). */
  slots: SendoSlots;
  agentDispatcher?: AgentDispatcher;
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
