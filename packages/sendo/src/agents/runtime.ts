import { generateText, hasToolCall, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentInboundInput, SendoContext } from "../core/context";
import type { Sendo } from "../core/create-sendo";
import { composeOutbound } from "../core/outbound";
import type { MessageUsage } from "../core/services/messages";
import { ConfigError } from "../errors/errors";
import { AGENT_MODES } from "../types/enums";
import type {
  Account,
  Contact,
  Conversation,
  JsonObject,
  MessageWithMedia,
} from "../types/entities";
import type { AgentMode } from "../types/enums";
import { buildSystemPrompt, HANDOFF_TOOL_NAME, toModelMessages } from "./prompt";
import type {
  AgentApi,
  AgentDefinition,
  AgentHandle,
  AgentHandoffConfig,
  AgentPricing,
  AgentToolDefinition,
} from "./types";

/** TTL of the per-conversation lock (`conv:{id}`). */
export const AGENT_LOCK_TTL_MS = 60_000;
/** Window of the per-contact rate limit. */
export const AGENT_RATE_WINDOW_MS = 60_000;
/** Turns one dispatch may run (the first one plus loops for messages that arrived meanwhile). */
export const AGENT_MAX_TURNS_PER_DISPATCH = 3;

interface ResolvedAgent {
  name: string;
  definition: AgentDefinition;
  historyLimit: number;
  maxStepsPerTurn: number;
  maxMessagesPerMinutePerContact: number;
  fallbackMessage: string | null;
  vision: boolean;
  handoff: AgentHandoffConfig | null;
}

interface Coverage {
  /** The newest inbound message a turn has already seen. */
  messageId: string;
}

type LoopEnd = "idle" | "stopped";

/** Why a turn may not run now: a pause (conversation or number) or a rule (business hours). */
type Hold = { reason: string; paused: boolean } | null;

/** `metadata.agentSkipped` on inbound messages that arrived while the agent was paused. */
const SKIPPED_PAUSED = "paused";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function positiveInt(name: string, field: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`sendo.agent("${name}"): \`${field}\` must be a positive integer.`);
  }
  return value;
}

function validate(ctx: SendoContext, input: AgentDefinition): ResolvedAgent {
  // Runtime guard: JS callers may pass anything.
  const def = input as Partial<AgentDefinition> | undefined;
  if (def === undefined || typeof def !== "object") {
    throw new ConfigError("sendo.agent needs a definition object.");
  }
  if (!nonEmpty(def.name)) throw new ConfigError("sendo.agent: `name` is required.");
  const name = def.name;
  const fail = (message: string) => new ConfigError(`sendo.agent("${name}"): ${message}`);
  const model: unknown = def.model;
  if (!(nonEmpty(model) || (typeof model === "object" && model !== null))) {
    throw fail("`model` is required (a gateway model id or a LanguageModel).");
  }
  const instructions: unknown = def.instructions;
  if (!(nonEmpty(instructions) || typeof instructions === "function")) {
    throw fail("`instructions` is required (a string or a function).");
  }
  const accounts: unknown = def.accounts;
  if (accounts !== undefined && !Array.isArray(accounts) && typeof accounts !== "function") {
    throw fail("`accounts` must be an array of ids or a predicate.");
  }
  if (Array.isArray(accounts) && !accounts.every(nonEmpty)) {
    throw fail("`accounts` must only contain non-empty strings.");
  }
  const tenants: unknown = def.tenants;
  if (tenants !== undefined && !Array.isArray(tenants) && typeof tenants !== "function") {
    throw fail("`tenants` must be an array of tenant ids or a predicate.");
  }
  if (Array.isArray(tenants) && !tenants.every((id) => id === null || nonEmpty(id))) {
    throw fail("`tenants` must only contain non-empty strings or null.");
  }
  const mode: unknown = def.mode;
  if (mode !== undefined && !(AGENT_MODES as readonly unknown[]).includes(mode)) {
    throw fail(`\`mode\` must be one of ${AGENT_MODES.map((m) => `"${m}"`).join(", ")}.`);
  }
  for (const [toolName, toolDef] of Object.entries(def.tools ?? {})) {
    const candidate = toolDef as Partial<AgentToolDefinition> | undefined;
    if (toolName === HANDOFF_TOOL_NAME) {
      throw fail(`\`${HANDOFF_TOOL_NAME}\` is a built-in tool name.`);
    }
    const schema: unknown = candidate?.input;
    const parsable =
      typeof schema === "object" &&
      schema !== null &&
      typeof (schema as { safeParse?: unknown }).safeParse === "function";
    if (typeof candidate?.run !== "function" || !parsable) {
      throw fail(`tool \`${toolName}\` needs a zod \`input\` schema and a \`run\` function.`);
    }
  }
  const handoff = def.handoff;
  if (handoff !== undefined) {
    if (!nonEmpty(handoff.when) || !nonEmpty(handoff.to)) {
      throw fail("`handoff.when` and `handoff.to` are required.");
    }
    if (handoff.message !== undefined && handoff.message !== null && !nonEmpty(handoff.message)) {
      throw fail("`handoff.message` must be a non-empty string or null.");
    }
  }
  const fallback = def.fallbackMessage;
  if (fallback !== undefined && fallback !== null && !nonEmpty(fallback)) {
    throw fail("`fallbackMessage` must be a non-empty string or null.");
  }
  if (def.vision !== undefined && typeof def.vision !== "boolean") {
    throw fail("`vision` must be a boolean.");
  }
  if (def.timezone !== undefined && !nonEmpty(def.timezone)) {
    throw fail("`timezone` must be an IANA timezone.");
  }
  const pricing = def.pricing as Partial<AgentPricing> | undefined;
  if (pricing !== undefined) {
    const rate = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (
      typeof pricing !== "object" ||
      !rate(pricing.inputPerMTok) ||
      !rate(pricing.outputPerMTok)
    ) {
      throw fail("`pricing` needs non-negative `inputPerMTok` and `outputPerMTok` (USD).");
    }
  }
  const defaults = ctx.config.agentDefaults;
  return {
    name,
    definition: input,
    historyLimit: positiveInt(name, "historyLimit", def.historyLimit, defaults.historyLimit),
    maxStepsPerTurn: positiveInt(
      name,
      "maxStepsPerTurn",
      def.maxStepsPerTurn,
      defaults.maxStepsPerTurn,
    ),
    maxMessagesPerMinutePerContact: positiveInt(
      name,
      "maxMessagesPerMinutePerContact",
      def.maxMessagesPerMinutePerContact,
      defaults.maxMessagesPerMinutePerContact,
    ),
    fallbackMessage: fallback ?? null,
    vision: def.vision ?? true,
    handoff: handoff ?? null,
  };
}

/**
 * Whether two optional list filters certainly overlap (`undefined` = everything). A predicate
 * can't be compared statically; `checkStoredAccounts` and dispatch catch those conflicts.
 */
function listsOverlap<T>(
  a: readonly T[] | ((value: never) => boolean) | undefined,
  b: readonly T[] | ((value: never) => boolean) | undefined,
): boolean {
  if (typeof a === "function" || typeof b === "function") return false;
  if (a === undefined) return b === undefined || b.length > 0;
  if (b === undefined) return a.length > 0;
  const other = new Set(b);
  return a.some((id) => other.has(id));
}

/** Whether two definitions certainly match a common account without looking at storage. */
function staticallyOverlap(a: AgentDefinition, b: AgentDefinition): boolean {
  return listsOverlap(a.accounts, b.accounts) && listsOverlap(a.tenants, b.tenants);
}

function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return "[unserializable]";
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

type TurnResult = Awaited<ReturnType<typeof generateText>>;

function stepsMetadata(result: TurnResult): JsonObject[] {
  return result.steps.map((step) => ({
    text: step.text,
    finishReason: step.finishReason,
    toolCalls: step.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      input: toJson(call.input),
    })),
    toolResults: step.toolResults.map((res) => ({
      id: res.toolCallId,
      name: res.toolName,
      output: toJson(res.output),
    })),
    toolErrors: step.content.flatMap((part) =>
      part.type === "tool-error"
        ? [
            {
              id: part.toolCallId,
              name: part.toolName,
              input: toJson(part.input),
              error: errorText(part.error),
            },
          ]
        : [],
    ),
  }));
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** USD the provider reported for the turn (OpenRouter `usage.cost`, summed over the steps). */
function providerCostUsd(result: TurnResult): number | null {
  let total: number | null = null;
  for (const step of result.steps) {
    const openrouter = step.providerMetadata?.openrouter;
    const usage = openrouter?.usage;
    const cost =
      typeof usage === "object" && usage !== null && !Array.isArray(usage)
        ? finite(usage.cost)
        : null;
    if (cost !== null) total = (total ?? 0) + cost;
  }
  return total;
}

/** Tokens of the whole turn and its cost in cents (provider cost, else `pricing`, else null). */
function turnUsage(result: TurnResult, pricing: AgentPricing | undefined): MessageUsage {
  const tokensIn = finite(result.totalUsage.inputTokens);
  const tokensOut = finite(result.totalUsage.outputTokens);
  let usd = providerCostUsd(result);
  if (usd === null && pricing !== undefined && tokensIn !== null && tokensOut !== null) {
    usd = (tokensIn * pricing.inputPerMTok + tokensOut * pricing.outputPerMTok) / 1_000_000;
  }
  const costCents = usd === null ? null : Math.round(usd * 100 * 10_000) / 10_000;
  return { tokensIn, tokensOut, costCents };
}

/**
 * Inbound messages of `history` (oldest first) no turn has seen yet. The marker is the
 * in-process coverage, else the `coveredInboundId` stored on the newest agent reply.
 * When the marker scrolled out of the window, everything after the newest agent reply
 * (or the whole window) counts as pending.
 */
function pendingInbound(
  history: readonly MessageWithMedia[],
  agentName: string,
  covered: Coverage | undefined,
): MessageWithMedia[] {
  let start = 0;
  let markerId = covered?.messageId;
  let lastAgentIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message?.sender === "agent" && message.senderRef === agentName) {
      lastAgentIndex = i;
      const stored = message.metadata.coveredInboundId;
      if (markerId === undefined && typeof stored === "string") markerId = stored;
      break;
    }
  }
  const markerIndex =
    markerId === undefined ? -1 : history.findIndex((message) => message.id === markerId);
  if (markerIndex >= 0) start = markerIndex + 1;
  else if (lastAgentIndex >= 0) start = lastAgentIndex + 1;
  // No catch-up after a pause: nothing stored before the resume line is answered.
  const resumed = history.findLastIndex((message) => "agentResumeFrom" in message.metadata);
  if (resumed >= start) start = resumed + 1;
  return history
    .slice(start)
    .filter((message) => message.direction === "in" && message.metadata.agentSkipped === undefined);
}

/**
 * Moves unseen messages that arrived while this agent was replying (stored before its
 * latest reply) right after that reply, so the prompt ends with the contact's turn.
 */
function unseenAfterReplies(
  history: readonly MessageWithMedia[],
  pending: readonly MessageWithMedia[],
  agentName: string,
): MessageWithMedia[] {
  const lastReply = history.findLastIndex(
    (message) => message.sender === "agent" && message.senderRef === agentName,
  );
  if (lastReply < 0) return [...history];
  const pendingIds = new Set(pending.map((message) => message.id));
  const moved = history.slice(0, lastReply).filter((message) => pendingIds.has(message.id));
  if (moved.length === 0) return [...history];
  const movedIds = new Set(moved.map((message) => message.id));
  const before = history.slice(0, lastReply + 1).filter((message) => !movedIds.has(message.id));
  return [...before, ...moved, ...history.slice(lastReply + 1)];
}

export function createAgentRuntime(ctx: SendoContext): {
  agent: AgentApi;
  handleInbound(input: AgentInboundInput): Promise<void>;
} {
  const agents = new Map<string, ResolvedAgent>();
  const coverage = new Map<string, Coverage>();
  const { adapter, logger } = ctx;

  function client(): Sendo {
    if (!ctx.client) throw new ConfigError("sendo client is not ready yet.");
    return ctx.client;
  }

  function accountsMatch(agent: ResolvedAgent, account: Account): boolean {
    const filter = agent.definition.accounts;
    if (filter === undefined) return true;
    if (Array.isArray(filter)) {
      return (
        filter.includes(account.id) ||
        (account.phoneNumberId !== null && filter.includes(account.phoneNumberId))
      );
    }
    try {
      return filter(account);
    } catch (error) {
      logger.error(`[sendo] agent "${agent.name}": accounts predicate threw`, error);
      return false;
    }
  }

  function tenantsMatch(agent: ResolvedAgent, account: Account): boolean {
    const filter = agent.definition.tenants;
    if (filter === undefined) return true;
    if (Array.isArray(filter)) return filter.includes(account.tenantId);
    try {
      return filter(account.tenantId);
    } catch (error) {
      logger.error(`[sendo] agent "${agent.name}": tenants predicate threw`, error);
      return false;
    }
  }

  function matches(agent: ResolvedAgent, account: Account): boolean {
    return accountsMatch(agent, account) && tenantsMatch(agent, account);
  }

  /**
   * Why no turn may run now, or null: the conversation or its number is paused, or a rule
   * holds the agent (business hours). Read fresh at lock acquisition, so a pause set while a
   * turn runs lets that turn finish and stops the next one.
   */
  async function holdReason(account: Account, conversation: Conversation): Promise<Hold> {
    if (conversation.agentPaused) return { reason: "the conversation is paused", paused: true };
    if (account.agentPaused) return { reason: "the number is paused", paused: true };
    try {
      const held = await ctx.rulesHooks.holdsAgent({ account, conversation, now: new Date() });
      if (held) return { reason: "a rule holds the agent", paused: false };
    } catch (error) {
      logger.error(`[sendo] rules holdsAgent failed for ${conversation.id}`, error);
    }
    return null;
  }

  /** Marks the unseen inbound messages as skipped, so a resume does not answer them. */
  async function skipWhilePaused(agent: ResolvedAgent, conversationId: string): Promise<void> {
    const history = await adapter.messages.history(conversationId, agent.historyLimit);
    for (const message of pendingInbound(history, agent.name, coverage.get(conversationId))) {
      await adapter.messages.updateMetadata(message.id, { agentSkipped: SKIPPED_PAUSED });
    }
  }

  function effectiveMode(agent: ResolvedAgent, account: Account): AgentMode {
    return account.agentMode ?? agent.definition.mode ?? "auto";
  }

  async function checkStoredAccounts(): Promise<void> {
    try {
      for (const account of await adapter.accounts.list()) {
        const matching = [...agents.values()].filter((agent) => matches(agent, account));
        if (matching.length > 1) {
          logger.error(conflictError(account, matching));
        }
      }
    } catch (error) {
      logger.warn("[sendo] could not check agent accounts", error);
    }
  }

  function conflictError(account: Account, matching: readonly ResolvedAgent[]): ConfigError {
    const names = matching.map((agent) => `"${agent.name}"`).join(", ");
    return new ConfigError(
      `Agents ${names} all match account ${account.phoneNumberId}; only one agent can match an account.`,
    );
  }

  function register(definition: AgentDefinition): AgentHandle {
    const agent = validate(ctx, definition);
    if (agents.has(agent.name)) {
      throw new ConfigError(`sendo.agent: an agent named "${agent.name}" is already registered.`);
    }
    for (const other of agents.values()) {
      if (staticallyOverlap(other.definition, definition)) {
        throw new ConfigError(
          `sendo.agent: agents "${other.name}" and "${agent.name}" match the same accounts and tenants; only one agent can match an account.`,
        );
      }
    }
    agents.set(agent.name, agent);
    if (agents.size > 1) void checkStoredAccounts();
    return {
      name: agent.name,
      remove: () => {
        if (agents.get(agent.name) === agent) agents.delete(agent.name);
      },
    };
  }

  function buildTools(
    agent: ResolvedAgent,
    target: { account: Account; contact: Contact; conversation: Conversation },
  ): ToolSet {
    const tools: ToolSet = {};
    for (const [name, def] of Object.entries(agent.definition.tools ?? {})) {
      tools[name] = tool({
        description: def.description,
        inputSchema: def.input,
        execute: (input: unknown) => def.run({ input, ...target, sendo: client() }),
      });
    }
    const handoff = agent.handoff;
    if (handoff !== null) {
      tools[HANDOFF_TOOL_NAME] = tool({
        description:
          "Transfiere la conversación a una persona del equipo. Úsala solo en los casos indicados en las instrucciones.",
        inputSchema: z.object({
          motivo: z.string().min(1).describe("Por qué se transfiere, en una frase."),
        }),
        execute: async ({ motivo }) => {
          const { conversation, assignees } = await ctx.services.conversations.handoff(
            target.conversation.id,
            {
              reason: motivo,
              to: handoff.to,
              message: handoff.message,
              by: `agent:${agent.name}`,
            },
          );
          return { transferido: true, estado: conversation.status, asignados: assignees.length };
        },
      });
    }
    return tools;
  }

  /**
   * Auto mode sends the reply. Draft mode replaces the conversation's pending draft with this
   * one (stored `draft`, status `pending`, never sent) for approval in the inbox.
   */
  async function deliverText(
    agent: ResolvedAgent,
    target: { account: Account; contact: Contact; conversation: Conversation },
    text: string,
    metadata: JsonObject,
    usage: MessageUsage | undefined,
  ): Promise<void> {
    const sendTarget = { ...target, sender: "agent" as const, senderRef: agent.name };
    const composed = await composeOutbound(ctx, sendTarget, { kind: "text", body: text });
    if (effectiveMode(agent, target.account) === "auto") {
      await ctx.services.messages.sendOutbound({ ...sendTarget, ...composed, metadata, usage });
      return;
    }
    const conversation = target.conversation;
    await adapter.messages.deleteDrafts(conversation.id);
    await adapter.messages.insertOutbound({
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      type: composed.type,
      content: composed.content,
      text: composed.text,
      sender: "agent",
      senderRef: agent.name,
      draft: true,
      metadata,
      ...usage,
    });
  }

  /** One model call over the current history. Never throws. */
  async function runTurn(
    agent: ResolvedAgent,
    input: { account: Account; contact: Contact; conversation: Conversation },
    history: readonly MessageWithMedia[],
    pending: readonly MessageWithMedia[],
  ): Promise<void> {
    const conversationId = input.conversation.id;
    const covered = pending.at(-1);
    if (covered === undefined) return;
    coverage.set(conversationId, { messageId: covered.id });
    const baseMetadata: JsonObject = { agent: agent.name, coveredInboundId: covered.id };
    let result: TurnResult;
    try {
      const def = agent.definition;
      const instructions =
        typeof def.instructions === "function"
          ? await def.instructions({ ...input, sendo: client() })
          : def.instructions;
      const system = buildSystemPrompt({
        instructions,
        handoff: agent.handoff ?? undefined,
        contact: input.contact,
        timezone: def.timezone ?? input.account.timezone,
        now: new Date(),
      });
      const ordered = unseenAfterReplies(history, pending, agent.name);
      const messages = await toModelMessages(ctx.config.media, ordered, { vision: agent.vision });
      result = await generateText({
        model: def.model,
        system,
        messages,
        tools: buildTools(agent, input),
        stopWhen: [stepCountIs(agent.maxStepsPerTurn), hasToolCall(HANDOFF_TOOL_NAME)],
      });
    } catch (error) {
      logger.error(`[sendo] agent "${agent.name}" turn failed in ${conversationId}`, error);
      if (agent.fallbackMessage !== null) {
        try {
          await deliverText(
            agent,
            input,
            agent.fallbackMessage,
            { ...baseMetadata, fallback: true },
            undefined,
          );
        } catch (sendError) {
          logger.error(`[sendo] agent "${agent.name}" could not send the fallback`, sendError);
        }
      }
      return;
    }

    const steps = stepsMetadata(result);
    for (const step of steps) {
      for (const failure of step.toolErrors as { name: string; error: string }[]) {
        logger.warn(`[sendo] agent "${agent.name}" tool ${failure.name} failed: ${failure.error}`);
      }
    }
    const text = result.text.trim();
    if (text === "") return;
    try {
      const usage = turnUsage(result, agent.definition.pricing);
      await deliverText(agent, input, text, { ...baseMetadata, steps }, usage);
    } catch (error) {
      logger.error(`[sendo] agent "${agent.name}" could not send its reply`, error);
    }
  }

  /** Runs turns while there are unseen inbound messages. Call with the lock held. */
  async function loop(
    agent: ResolvedAgent,
    input: AgentInboundInput,
    budget: { turns: number },
  ): Promise<LoopEnd> {
    while (budget.turns > 0) {
      const conversation = await adapter.conversations.get(input.conversation.id);
      if (conversation?.status !== "agent") return "stopped";
      const account = (await adapter.accounts.getById(input.account.id)) ?? input.account;
      const held = await holdReason(account, conversation);
      if (held !== null) {
        logger.debug(`[sendo] agent "${agent.name}" skips ${conversation.id}: ${held.reason}`);
        if (held.paused) await skipWhilePaused(agent, conversation.id);
        return "stopped";
      }
      const history = await adapter.messages.history(conversation.id, agent.historyLimit);
      const pending = pendingInbound(history, agent.name, coverage.get(conversation.id));
      if (pending.length === 0) return "idle";
      const since = new Date(Date.now() - AGENT_RATE_WINDOW_MS);
      const recent = await adapter.messages.countInboundSince(input.contact.id, since);
      if (recent > agent.maxMessagesPerMinutePerContact) {
        logger.warn(
          `[sendo] agent "${agent.name}": rate limit for contact ${input.contact.id} (${String(recent)} messages in 60 s); not answering.`,
        );
        return "stopped";
      }
      budget.turns--;
      await runTurn(agent, { account, contact: input.contact, conversation }, history, pending);
    }
    return "stopped";
  }

  async function hasPending(agent: ResolvedAgent, conversationId: string): Promise<boolean> {
    const conversation = await adapter.conversations.get(conversationId);
    if (conversation?.status !== "agent") return false;
    const history = await adapter.messages.history(conversationId, agent.historyLimit);
    return pendingInbound(history, agent.name, coverage.get(conversationId)).length > 0;
  }

  async function handleInbound(input: AgentInboundInput): Promise<void> {
    try {
      const matching = [...agents.values()].filter((agent) => matches(agent, input.account));
      const [agent] = matching;
      if (agent === undefined) return;
      if (matching.length > 1) {
        logger.error(conflictError(input.account, matching));
        return;
      }
      const key = `conv:${input.conversation.id}`;
      const budget = { turns: AGENT_MAX_TURNS_PER_DISPATCH };
      for (;;) {
        // A busy lock means another turn is running; its holder re-checks before releasing.
        if (!(await adapter.locks.acquire(key, AGENT_LOCK_TTL_MS))) return;
        let end: LoopEnd;
        try {
          end = await loop(agent, input, budget);
        } finally {
          await adapter.locks.release(key);
        }
        // A message stored between the last check and the release found the lock busy.
        if (end !== "idle" || !(await hasPending(agent, input.conversation.id))) return;
      }
    } catch (error) {
      logger.error(`[sendo] agent dispatch failed for ${input.conversation.id}`, error);
    }
  }

  return { agent: register, handleInbound };
}

/** Installs `sendo.agent` and the pipeline's agent dispatcher. */
export function installAgents(ctx: SendoContext): void {
  const runtime = createAgentRuntime(ctx);
  ctx.slots.agent = runtime.agent;
  ctx.agentDispatcher = { handleInbound: (input) => runtime.handleInbound(input) };
}

/** Identity helper that infers a tool's `run` input from its zod schema. */
export function agentTool<Schema extends z.ZodType>(
  definition: AgentToolDefinition<Schema>,
): AgentToolDefinition {
  return definition;
}
