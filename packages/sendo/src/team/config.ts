import type { TranscriptionModel } from "ai";
import type { ResolveHandoffTargets } from "../core/config";
import type { SendoLocale } from "../core/messages";
import {
  resolveOptOutConfig,
  type OptOutConfig,
  type ResolvedOptOutConfig,
} from "../broadcasts/opt-out";
import { TRANSCRIBE_TIMEOUT_MS } from "../core/pipeline/transcribe";
import { ConfigError } from "../errors/errors";
import type { RuleDefinition } from "../rules/schemas";
import type { Account, Contact, Conversation, TenantId } from "../types/entities";
import type { Role } from "./permissions";

export type { OptOutConfig } from "../broadcasts/opt-out";

export interface ResolveRoleInput {
  userId: string;
  tenantId: TenantId;
}

/** `null` means no access to the tenant. */
export type ResolveRoleResult = { role: Role; queues?: string[] } | null;

/** App-implemented (Sendo stores no users or roles). Product spec AC-RL-1. */
export type ResolveRole = (input: ResolveRoleInput) => Promise<ResolveRoleResult>;

export interface TeamUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

/** Names and avatars for user ids (assignees, `{{agente}}`). Unknown ids may be omitted. */
export type ResolveUsers = (ids: string[]) => Promise<TeamUser[]>;

export interface ResolveAssigneesInput {
  tenantId: TenantId;
  queue: string | null;
  account: Account;
}

/** User ids a conversation of `queue` can be assigned to (auto-assign, reassign picker). */
export type ResolveAssignees = (input: ResolveAssigneesInput) => Promise<string[]>;

export interface ResolveSnippetVariablesInput {
  contact: Contact;
  conversation: Conversation;
  account: Account;
}

/** App variables merged over the snippet built-ins (`nombre`, `telefono`, `agente`). */
export type ResolveSnippetVariables = (
  input: ResolveSnippetVariablesInput,
) => Promise<Record<string, string>>;

/**
 * Voice-note transcription (AC-VN-1): inbound audio is transcribed with this AI SDK
 * transcription model (e.g. `openai.transcription("whisper-1")`) before the agent turn.
 */
export interface TranscribeConfig {
  model: TranscriptionModel;
  /** Longest wait for the model, in ms (1–30000). Default 30000. */
  timeoutMs?: number;
}

/** Team, rules and reach keys of `SendoConfig` (`SendoConfigBase` extends this). */
export interface TeamConfig {
  resolveRole?: ResolveRole;
  resolveUsers?: ResolveUsers;
  /**
   * Supersedes `resolveHandoffTargets`, which is still honoured as a fallback for one
   * minor release when this is not set.
   */
  resolveAssignees?: ResolveAssignees;
  resolveSnippetVariables?: ResolveSnippetVariables;
  /** Code-defined rules; `sendo rules sync` stores them (SND-3.4). */
  rules?: RuleDefinition[];
  optOut?: OptOutConfig;
  transcribe?: TranscribeConfig;
}

export interface ResolvedTeamConfig {
  resolveRole: ResolveRole | null;
  resolveUsers: ResolveUsers | null;
  resolveAssignees: ResolveAssignees | null;
  resolveSnippetVariables: ResolveSnippetVariables | null;
  rules: RuleDefinition[];
  optOut: ResolvedOptOutConfig;
  transcribe: TranscribeConfig | null;
}

function optionalFunction<T>(name: string, value: T | undefined): T | null {
  if (value === undefined) return null;
  if (typeof value !== "function") {
    throw new ConfigError(`createSendo: \`${name}\` must be a function.`);
  }
  return value;
}

/** Throws `ConfigError` on invalid team keys. `locale` picks the built-in opt-out confirmation. */
export function resolveTeamConfig(
  config: TeamConfig,
  locale: SendoLocale = "en",
): ResolvedTeamConfig {
  if (config.rules !== undefined && !Array.isArray(config.rules)) {
    throw new ConfigError("createSendo: `rules` must be an array.");
  }
  return {
    resolveRole: optionalFunction("resolveRole", config.resolveRole),
    resolveUsers: optionalFunction("resolveUsers", config.resolveUsers),
    resolveAssignees: optionalFunction("resolveAssignees", config.resolveAssignees),
    resolveSnippetVariables: optionalFunction(
      "resolveSnippetVariables",
      config.resolveSnippetVariables,
    ),
    rules: config.rules ?? [],
    optOut: resolveOptOutConfig(config.optOut, locale),
    transcribe: resolveTranscribe(config.transcribe),
  };
}

function resolveTranscribe(value: TranscribeConfig | undefined): TranscribeConfig | null {
  if (value === undefined) return null;
  const model: unknown = (value as Partial<TranscribeConfig> | null)?.model;
  const validModel =
    (typeof model === "string" && model.trim() !== "") ||
    (typeof model === "object" &&
      model !== null &&
      typeof (model as { doGenerate?: unknown }).doGenerate === "function");
  if (!validModel) {
    throw new ConfigError(
      'createSendo: `transcribe.model` must be an AI SDK transcription model, e.g. `transcribe: { model: openai.transcription("whisper-1") }`.',
    );
  }
  const { timeoutMs } = value;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > TRANSCRIBE_TIMEOUT_MS)
  ) {
    throw new ConfigError(
      `createSendo: \`transcribe.timeoutMs\` must be a number of milliseconds between 1 and ${String(TRANSCRIBE_TIMEOUT_MS)}.`,
    );
  }
  return value;
}

export interface AssigneeLookup extends ResolveAssigneesInput {
  conversation: Conversation;
  contact: Contact;
}

/**
 * `resolveAssignees`, falling back to the deprecated `resolveHandoffTargets`
 * (called with `to: queue`), else no assignees.
 */
export async function resolveAssigneeIds(
  team: Pick<ResolvedTeamConfig, "resolveAssignees">,
  legacy: ResolveHandoffTargets | null,
  input: AssigneeLookup,
): Promise<string[]> {
  if (team.resolveAssignees) {
    return team.resolveAssignees({
      tenantId: input.tenantId,
      queue: input.queue,
      account: input.account,
    });
  }
  if (legacy) {
    return legacy({
      to: input.queue ?? undefined,
      account: input.account,
      conversation: input.conversation,
      contact: input.contact,
    });
  }
  return [];
}
