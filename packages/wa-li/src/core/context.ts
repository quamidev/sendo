import type { WhatsAppAdapter } from "../adapters/types";
import type { Transport } from "../transport/types";
import type { Account, Contact, Conversation, Message } from "../types/entities";
import type { RedactingLogger } from "../utils/logger";
import type { ResolveAccount } from "./accounts";
import type { ResolvedWhatsAppConfig } from "./config";
import type { WhatsApp } from "./create-whatsapp";
import type { WhatsAppEmitter } from "./events";
import type { WhatsAppServices } from "./services";
import type { WhatsAppSlots } from "./slots";

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
 * Internal state shared by every namespace of one `createWhatsApp` client.
 * Not part of the public API: get it with `getContext(wa)`.
 */
export interface WhatsAppContext {
  config: ResolvedWhatsAppConfig;
  adapter: WhatsAppAdapter;
  transport: Transport;
  /** Redacts every known token and secret. */
  logger: RedactingLogger;
  emitter: WhatsAppEmitter;
  resolveAccount: ResolveAccount;
  services: WhatsAppServices;
  /** Assignable namespaces (`handleWebhook`, `events`, `maintenance`, `inbox`, `agent`). */
  slots: WhatsAppSlots;
  agentDispatcher?: AgentDispatcher;
  /** The public client (set by `createWhatsApp` after the modules are installed). */
  client?: WhatsApp;
  /**
   * Lazy one-time schema check (warns when `adapter.schemaVersion()` is older than
   * `WA_SCHEMA_VERSION` or null). Public entry points await it before using the adapter.
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

const contexts = new WeakMap<object, WhatsAppContext>();

export function attachContext(client: object, ctx: WhatsAppContext): void {
  contexts.set(client, ctx);
}

/** The internal context of a client built by `createWhatsApp`. */
export function getContext(client: object): WhatsAppContext {
  const ctx = contexts.get(client);
  if (!ctx) throw new TypeError("Not a wa-li client created by createWhatsApp().");
  return ctx;
}
