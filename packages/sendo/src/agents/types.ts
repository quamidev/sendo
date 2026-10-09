import type { LanguageModel } from "ai";
import type { z } from "zod";
import type { Sendo } from "../core/create-sendo";
import type { Account, Contact, Conversation } from "../types/entities";

/** Passed to a tool's `run` after its input passed the zod schema. */
export interface AgentToolContext<Input = unknown> {
  input: Input;
  contact: Contact;
  conversation: Conversation;
  account: Account;
  sendo: Sendo;
}

export interface AgentToolDefinition<Schema extends z.ZodType = z.ZodType> {
  /** Tells the model when to use the tool. */
  description?: string;
  /** Validates the model's arguments before `run` is called. */
  input: Schema;
  /** The return value is serialized and given back to the model. */
  run(ctx: AgentToolContext<z.output<Schema>>): Promise<unknown>;
}

/** Context for `instructions` when it is a function. */
export interface AgentContextInfo {
  account: Account;
  contact: Contact;
  conversation: Conversation;
  sendo: Sendo;
}

export interface AgentHandoffConfig {
  /** When the model should transfer, in natural language (goes into the system prompt). */
  when: string;
  /** Passed to `resolveHandoffTargets` (a team or role). */
  to: string;
  /** Sent on handoff. `null` sends nothing. Default `config.handoffMessage`. */
  message?: string | null;
}

export type AgentAccountsFilter = string[] | ((account: Account) => boolean);

export interface AgentDefinition {
  /** Unique per client; stored as `senderRef` of the agent's messages. */
  name: string;
  /** Account ids or phone number ids, or a predicate. Default: every account. */
  accounts?: AgentAccountsFilter;
  /** A gateway model id (e.g. `"openai/gpt-5-mini"`) or an AI SDK `LanguageModel`. */
  model: LanguageModel;
  instructions: string | ((ctx: AgentContextInfo) => string | Promise<string>);
  tools?: Record<string, AgentToolDefinition>;
  /** Adds the built-in `transferir_a_humano({ motivo })` tool. */
  handoff?: AgentHandoffConfig;
  /** Default `agentDefaults.historyLimit` (20). */
  historyLimit?: number;
  /** Default `agentDefaults.maxStepsPerTurn` (5). */
  maxStepsPerTurn?: number;
  /** Default `agentDefaults.maxMessagesPerMinutePerContact` (10). */
  maxMessagesPerMinutePerContact?: number;
  /** Sent when the model or a turn fails. `null`/omitted sends nothing. */
  fallbackMessage?: string | null;
  /** Send images to the model as image parts. Default `true`; `false` describes them as text. */
  vision?: boolean;
  /** IANA timezone for the date in the system prompt. Default the account's timezone. */
  timezone?: string;
}

export interface AgentHandle {
  readonly name: string;
  /** Unregisters the agent; later inbound messages are not answered by it. */
  remove(): void;
}

/** `sendo.agent(definition)`. Throws `ConfigError` on an invalid definition. */
export type AgentApi = (definition: AgentDefinition) => AgentHandle;
