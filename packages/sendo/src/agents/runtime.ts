import { generateText, hasToolCall, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import type { AgentInboundInput, SendoContext } from "../core/context";
import type { Sendo } from "../core/create-sendo";
import { createReply } from "../core/reply";
import { ConfigError } from "../errors/errors";
import type {
  Account,
  Contact,
  Conversation,
  JsonObject,
  MessageWithMedia,
} from "../types/entities";
import { buildSystemPrompt, HANDOFF_TOOL_NAME, toModelMessages } from "./prompt";
import type {
  AgentApi,
  AgentDefinition,
  AgentHandle,
  AgentHandoffConfig,
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

/** Whether two filters certainly overlap without looking at the stored accounts. */
function staticallyOverlap(a: AgentDefinition, b: AgentDefinition): boolean {
  if (typeof a.accounts === "function" || typeof b.accounts === "function") return false;
  if (a.accounts === undefined) return b.accounts === undefined || b.accounts.length > 0;
  if (b.accounts === undefined) return a.accounts.length > 0;
  const other = new Set(b.accounts);
  return a.accounts.some((id) => other.has(id));
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
  return history.slice(start).filter((message) => message.direction === "in");
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

  function matches(agent: ResolvedAgent, account: Account): boolean {
    const filter = agent.definition.accounts;
    if (filter === undefined) return true;
    if (Array.isArray(filter)) {
      return filter.includes(account.id) || filter.includes(account.phoneNumberId);
    }
    try {
      return filter(account);
    } catch (error) {
      logger.error(`[sendo] agent "${agent.name}": accounts predicate threw`, error);
      return false;
    }
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
          `sendo.agent: agents "${other.name}" and "${agent.name}" match the same accounts; only one agent can match an account.`,
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

  async function sendText(
    agent: ResolvedAgent,
    target: { account: Account; contact: Contact; conversation: Conversation },
    text: string,
    metadata: JsonObject,
  ): Promise<void> {
    const reply = createReply(ctx, { ...target, sender: "agent", senderRef: agent.name });
    const message = await reply.text(text);
    await adapter.messages.updateMetadata(message.id, metadata);
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
      const messages = await toModelMessages(adapter, ordered, { vision: agent.vision });
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
          await sendText(agent, input, agent.fallbackMessage, { ...baseMetadata, fallback: true });
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
      await sendText(agent, input, text, { ...baseMetadata, steps });
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
      await runTurn(
        agent,
        { account: input.account, contact: input.contact, conversation },
        history,
        pending,
      );
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
