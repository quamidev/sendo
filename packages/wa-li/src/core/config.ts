import type { WhatsAppAdapter } from "../adapters/types";
import { ConfigError } from "../errors/errors";
import type { ResolveToken } from "../transport/meta-direct";
import type { Transport } from "../transport/types";
import type { Account, Contact, Conversation } from "../types/entities";
import type { Logger } from "../utils/logger";

export const DEFAULT_HANDOFF_MESSAGE = "Te comunico con una persona del equipo.";
export const DEFAULT_EVENT_RETENTION_DAYS = 30;

export interface AgentDefaults {
  /** Messages of the conversation passed to the model. Default 20. */
  historyLimit: number;
  /** `stopWhen: stepCountIs(n)`. Default 5. */
  maxStepsPerTurn: number;
  /** Inbound messages per contact per minute before agent turns are skipped. Default 10. */
  maxMessagesPerMinutePerContact: number;
}

export const DEFAULT_AGENT_DEFAULTS: Readonly<AgentDefaults> = {
  historyLimit: 20,
  maxStepsPerTurn: 5,
  maxMessagesPerMinutePerContact: 10,
};

export interface LinkContactInput {
  /** E.164. */
  phone: string;
  account: Account;
  contact: Contact;
}

/** Returns the app's own entity id for the contact (patient, user...), or `null`. */
export type LinkContact = (input: LinkContactInput) => string | null | Promise<string | null>;

export interface ResolveHandoffTargetsInput {
  /** The `to` given to `handoff` (e.g. a team or role name), if any. */
  to?: string;
  account: Account;
  conversation: Conversation;
  contact: Contact;
}

/** Returns the user ids that should receive a handed-off conversation. */
export type ResolveHandoffTargets = (
  input: ResolveHandoffTargetsInput,
) => string[] | Promise<string[]>;

interface WhatsAppConfigBase {
  adapter: WhatsAppAdapter;
  linkContact?: LinkContact;
  resolveHandoffTargets?: ResolveHandoffTargets;
  agentDefaults?: Partial<AgentDefaults>;
  /** Days `wa.maintenance.prune()` keeps in `wa_events`. Default 30. */
  eventRetentionDays?: number;
  /** Console-like logger. Every message is redacted (tokens, secrets, Authorization). */
  logger?: Logger;
  /** ISO-2 country or calling code applied to national numbers (`"GT"`, `"502"`). */
  defaultCountry?: string;
  /** Sent on handoff. `null` sends nothing. Default "Te comunico con una persona del equipo." */
  handoffMessage?: string | null;
}

/** Shorthand for `transport: metaDirect({ appSecret, verifyToken, resolveToken })`. */
export interface MetaDirectShorthandConfig extends WhatsAppConfigBase {
  transport?: undefined;
  appSecret: string;
  verifyToken: string;
  resolveToken: ResolveToken;
  /** Graph API version, default `GRAPH_API_VERSION`. */
  graphVersion?: string;
  fetch?: typeof fetch;
}

export interface CustomTransportConfig extends WhatsAppConfigBase {
  transport: Transport;
}

export type WhatsAppConfig = MetaDirectShorthandConfig | CustomTransportConfig;

/** `WhatsAppConfig` after validation, with defaults applied. */
export interface ResolvedWhatsAppConfig {
  adapter: WhatsAppAdapter;
  linkContact: LinkContact | null;
  resolveHandoffTargets: ResolveHandoffTargets | null;
  agentDefaults: AgentDefaults;
  eventRetentionDays: number;
  defaultCountry: string | undefined;
  handoffMessage: string | null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function positiveInteger(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} must be a positive integer.`);
  }
  return value;
}

/** Throws `ConfigError` on missing or invalid configuration. */
export function validateConfig(config: WhatsAppConfig): ResolvedWhatsAppConfig {
  // Runtime guard: JS callers may pass anything.
  const raw = config as Partial<WhatsAppConfig> | undefined;
  if (raw === undefined || typeof raw !== "object") {
    throw new ConfigError("createWhatsApp needs a config object.");
  }
  if (raw.adapter === undefined || typeof raw.adapter !== "object") {
    throw new ConfigError("createWhatsApp: `adapter` is required.");
  }
  if (raw.transport === undefined) {
    const shorthand = raw as Partial<MetaDirectShorthandConfig>;
    if (!isNonEmptyString(shorthand.appSecret)) {
      throw new ConfigError("createWhatsApp: `appSecret` is required unless `transport` is set.");
    }
    if (!isNonEmptyString(shorthand.verifyToken)) {
      throw new ConfigError("createWhatsApp: `verifyToken` is required unless `transport` is set.");
    }
    if (typeof shorthand.resolveToken !== "function") {
      throw new ConfigError(
        "createWhatsApp: `resolveToken` is required unless `transport` is set.",
      );
    }
  }
  if (raw.handoffMessage !== undefined && raw.handoffMessage !== null) {
    if (!isNonEmptyString(raw.handoffMessage)) {
      throw new ConfigError("createWhatsApp: `handoffMessage` must be a non-empty string or null.");
    }
  }
  const defaults = raw.agentDefaults ?? {};
  return {
    adapter: raw.adapter,
    linkContact: raw.linkContact ?? null,
    resolveHandoffTargets: raw.resolveHandoffTargets ?? null,
    agentDefaults: {
      historyLimit: positiveInteger(
        "agentDefaults.historyLimit",
        defaults.historyLimit,
        DEFAULT_AGENT_DEFAULTS.historyLimit,
      ),
      maxStepsPerTurn: positiveInteger(
        "agentDefaults.maxStepsPerTurn",
        defaults.maxStepsPerTurn,
        DEFAULT_AGENT_DEFAULTS.maxStepsPerTurn,
      ),
      maxMessagesPerMinutePerContact: positiveInteger(
        "agentDefaults.maxMessagesPerMinutePerContact",
        defaults.maxMessagesPerMinutePerContact,
        DEFAULT_AGENT_DEFAULTS.maxMessagesPerMinutePerContact,
      ),
    },
    eventRetentionDays: positiveInteger(
      "eventRetentionDays",
      raw.eventRetentionDays,
      DEFAULT_EVENT_RETENTION_DAYS,
    ),
    defaultCountry: raw.defaultCountry,
    handoffMessage: raw.handoffMessage === undefined ? DEFAULT_HANDOFF_MESSAGE : raw.handoffMessage,
  };
}
