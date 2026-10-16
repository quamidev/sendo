import type { SendoAdapter } from "../adapters/types";
import {
  resolveConnectConfig,
  type ConnectConfig,
  type ResolvedConnectConfig,
} from "../connect/config";
import { ConfigError } from "../errors/errors";
import { resolveMediaStore } from "../media";
import type { MediaStore } from "../media/types";
import type { TeamConfig } from "../team/config";
import type { AccountsConfig } from "./accounts/config";
import type { ResolveToken } from "../transport/meta-direct";
import type { Transport } from "../transport/types";
import type { Account, Contact, Conversation } from "../types/entities";
import type { Logger } from "../utils/logger";
import { BUILT_IN_MESSAGES, SENDO_LOCALES, type SendoLocale } from "./messages";

/** The English built-in handoff message (`BUILT_IN_MESSAGES.en.handoff`). */
export const DEFAULT_HANDOFF_MESSAGE = BUILT_IN_MESSAGES.en.handoff;
export const DEFAULT_LOCALE: SendoLocale = "en";
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

interface SendoConfigBase extends TeamConfig, AccountsConfig, ConnectConfig {
  adapter: SendoAdapter;
  /**
   * Where media bytes are stored (`supabaseStorage()`, `s3Storage()` or your own `MediaStore`).
   * Default: the adapter's `storage` (Supabase bucket, memory map).
   */
  media?: MediaStore;
  linkContact?: LinkContact;
  resolveHandoffTargets?: ResolveHandoffTargets;
  agentDefaults?: Partial<AgentDefaults>;
  /** Days `sendo.maintenance.prune()` keeps in `sendo_events`. Default 30. */
  eventRetentionDays?: number;
  /** Console-like logger. Every message is redacted (tokens, secrets, Authorization). */
  logger?: Logger;
  /** ISO-2 country or calling code applied to national numbers (`"GT"`, `"502"`). */
  defaultCountry?: string;
  /**
   * Language of the built-in text sent to end customers (handoff message, opt-out
   * confirmation): `BUILT_IN_MESSAGES[locale]`. Default `"en"`.
   */
  locale?: SendoLocale;
  /** Sent on handoff. `null` sends nothing. Default `BUILT_IN_MESSAGES[locale].handoff`. */
  handoffMessage?: string | null;
}

/** Shorthand for `transport: metaDirect({ appSecret, verifyToken, resolveToken })`. */
export interface MetaDirectShorthandConfig extends SendoConfigBase {
  transport?: undefined;
  /** Meta app secret (verifies `X-Hub-Signature-256`). Required unless `connect` is set. */
  appSecret?: string;
  verifyToken: string;
  resolveToken: ResolveToken;
  /** Graph API version, default `GRAPH_API_VERSION`. */
  graphVersion?: string;
  fetch?: typeof fetch;
}

export interface CustomTransportConfig extends SendoConfigBase {
  transport: Transport;
}

export type SendoConfig = MetaDirectShorthandConfig | CustomTransportConfig;

/** `SendoConfig` after validation, with defaults applied. */
export interface ResolvedSendoConfig {
  adapter: SendoAdapter;
  /** `media`, else `adapter.storage`, else `null` (inbound media is stored as `failed`). */
  media: MediaStore | null;
  linkContact: LinkContact | null;
  resolveHandoffTargets: ResolveHandoffTargets | null;
  agentDefaults: AgentDefaults;
  eventRetentionDays: number;
  defaultCountry: string | undefined;
  locale: SendoLocale;
  handoffMessage: string | null;
  /** `connect`, validated; `null` = webhooks signed by Meta and signup with your own app. */
  connect: ResolvedConnectConfig | null;
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

/** Throws `ConfigError` unless `locale` is omitted or one of `SENDO_LOCALES`. */
export function resolveLocale(locale: unknown): SendoLocale {
  if (locale === undefined) return DEFAULT_LOCALE;
  if (typeof locale === "string" && (SENDO_LOCALES as readonly string[]).includes(locale)) {
    return locale as SendoLocale;
  }
  throw new ConfigError(
    `createSendo: \`locale\` must be one of ${SENDO_LOCALES.map((l) => `"${l}"`).join(", ")}.`,
  );
}

/** Throws `ConfigError` on missing or invalid configuration. */
export function validateConfig(config: SendoConfig): ResolvedSendoConfig {
  // Runtime guard: JS callers may pass anything.
  const raw = config as Partial<SendoConfig> | undefined;
  if (raw === undefined || typeof raw !== "object") {
    throw new ConfigError("createSendo needs a config object.");
  }
  if (raw.adapter === undefined || typeof raw.adapter !== "object") {
    throw new ConfigError("createSendo: `adapter` is required.");
  }
  const connect = resolveConnectConfig(raw);
  if (raw.transport === undefined) {
    const shorthand = raw as Partial<MetaDirectShorthandConfig>;
    if (connect === null && !isNonEmptyString(shorthand.appSecret)) {
      throw new ConfigError(
        "createSendo: `appSecret` is required unless `transport` or `connect` is set.",
      );
    }
    if (!isNonEmptyString(shorthand.verifyToken)) {
      throw new ConfigError("createSendo: `verifyToken` is required unless `transport` is set.");
    }
    if (typeof shorthand.resolveToken !== "function") {
      throw new ConfigError("createSendo: `resolveToken` is required unless `transport` is set.");
    }
  }
  if (connect !== null && raw.transport !== undefined && raw.transport.kind !== "meta-direct") {
    throw new ConfigError(
      `createSendo: \`connect\` sends straight to Meta and needs the meta-direct transport, not "${raw.transport.kind}". Remove \`transport\` or pass metaDirect().`,
    );
  }
  if (raw.handoffMessage !== undefined && raw.handoffMessage !== null) {
    if (!isNonEmptyString(raw.handoffMessage)) {
      throw new ConfigError("createSendo: `handoffMessage` must be a non-empty string or null.");
    }
  }
  const locale = resolveLocale(raw.locale);
  const defaults = raw.agentDefaults ?? {};
  return {
    adapter: raw.adapter,
    media: resolveMediaStore(raw.media, raw.adapter.storage),
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
    locale,
    handoffMessage:
      raw.handoffMessage === undefined ? BUILT_IN_MESSAGES[locale].handoff : raw.handoffMessage,
    connect,
  };
}
