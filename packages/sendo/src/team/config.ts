import type { TranscriptionModel } from "ai";
import type { ResolveHandoffTargets } from "../core/config";
import { ConfigError } from "../errors/errors";
import type { RuleDefinition } from "../rules/schemas";
import type { Account, Contact, Conversation, TenantId } from "../types/entities";
import type { Role } from "./permissions";

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

/** Opt-out keywords (SND-4.2). Default keywords `["BAJA","STOP","ALTO","CANCELAR"]`. */
export interface OptOutConfig {
  keywords?: string[];
  /** Sent inside the window after an opt-out. `null` sends nothing. */
  confirmation?: string | null;
}

/** Voice-note transcription (SND-4.10). */
export interface TranscribeConfig {
  model: TranscriptionModel;
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
  optOut: OptOutConfig | null;
  transcribe: TranscribeConfig | null;
}

function optionalFunction<T>(name: string, value: T | undefined): T | null {
  if (value === undefined) return null;
  if (typeof value !== "function") {
    throw new ConfigError(`createSendo: \`${name}\` must be a function.`);
  }
  return value;
}

/** Throws `ConfigError` on invalid team keys. */
export function resolveTeamConfig(config: TeamConfig): ResolvedTeamConfig {
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
    optOut: config.optOut ?? null,
    transcribe: config.transcribe ?? null,
  };
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
