import { MetaApiError } from "../errors/meta-api-error";
import { metaDirect, type MetaDirectTransport } from "../transport/meta-direct";
import type { Transport } from "../transport/types";
import type { Conversation, Template, WindowStatus } from "../types/entities";
import { createRedactingLogger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { WA_SCHEMA_VERSION } from "../utils/schema-version";
import { createAccountResolver } from "./accounts";
import { validateConfig, type WhatsAppConfig } from "./config";
import { attachContext, type WhatsAppContext } from "./context";
import { createEmitter, type WhatsAppEmitter } from "./events";
import { WHATSAPP_MODULES } from "./modules";
import { createSendApi, type AccountOption, type SendApi } from "./send";
import {
  createServices,
  type ByOption,
  type HandoffOptions,
  type TemplatesListQuery,
} from "./services";
import { createStubSlots, type WhatsAppSlots } from "./slots";

export interface TemplatesApi {
  /** Pulls templates from Meta (all active accounts when `account` is omitted). */
  sync(opts?: AccountOption): Promise<Template[]>;
  /** Active templates; `includeInactive` adds the ones removed on Meta. */
  list(query?: TemplatesListQuery): Promise<Template[]>;
}

export interface ConversationsApi {
  get(id: string): Promise<Conversation | null>;
  handoff(id: string, opts: HandoffOptions): Promise<Conversation>;
  returnToAgent(id: string, opts?: ByOption): Promise<Conversation>;
  close(id: string, opts?: ByOption): Promise<Conversation>;
  assign(id: string, userId: string | null, opts?: ByOption): Promise<Conversation>;
  windowStatus(id: string): Promise<WindowStatus>;
}

export interface WhatsApp {
  /** Subscribes to an event; returns an unsubscribe function. */
  on: WhatsAppEmitter["on"];
  send: SendApi;
  templates: TemplatesApi;
  conversations: ConversationsApi;
  handleWebhook: WhatsAppSlots["handleWebhook"];
  readonly events: WhatsAppSlots["events"];
  readonly maintenance: WhatsAppSlots["maintenance"];
  readonly inbox: WhatsAppSlots["inbox"];
  readonly agent: WhatsAppSlots["agent"];
}

function buildTransport(
  config: WhatsAppConfig,
  ctx: Pick<WhatsAppContext, "addSecret" | "logger">,
): Transport {
  if (config.transport !== undefined) {
    const transport = config.transport;
    if (transport.kind === "meta-direct") {
      const direct = transport as MetaDirectTransport;
      ctx.addSecret(direct.appSecret);
      ctx.addSecret(direct.verifyToken);
    }
    return transport;
  }
  ctx.addSecret(config.appSecret);
  ctx.addSecret(config.verifyToken);
  const resolveToken = config.resolveToken;
  return metaDirect({
    appSecret: config.appSecret,
    verifyToken: config.verifyToken,
    version: config.graphVersion,
    fetch: config.fetch,
    logger: ctx.logger,
    resolveToken: async (account) => {
      const token = await resolveToken(account);
      if (typeof token === "string") ctx.addSecret(token);
      return token;
    },
  });
}

/** Creates a wa-li client. Throws `ConfigError` on invalid configuration. */
export function createWhatsApp(config: WhatsAppConfig): WhatsApp {
  const resolved = validateConfig(config);
  const adapter = resolved.adapter;

  const knownSecrets = new Set<string>();
  const addSecret = (value: string): void => {
    if (value.trim() !== "") knownSecrets.add(value);
  };
  const secrets = (): readonly string[] => [...knownSecrets];
  const logger = createRedactingLogger(config.logger, secrets);
  const emitter = createEmitter(logger);
  const transport = buildTransport(config, { addSecret, logger });

  let schemaCheck: Promise<void> | undefined;
  async function checkSchema(): Promise<void> {
    try {
      const version = await adapter.schemaVersion();
      if (version === null) {
        logger.warn(
          "[wa-li] The wa_* tables are missing (schemaVersion() returned null). Install the wa-li-schema migration.",
        );
      } else if (version < WA_SCHEMA_VERSION) {
        logger.warn(
          `[wa-li] Database schema version ${version} is older than ${WA_SCHEMA_VERSION}. Apply the latest wa-li-schema migration.`,
        );
      }
    } catch (error) {
      logger.warn("[wa-li] Could not check the database schema version", error);
    }
  }

  // `services` reads `ctx` lazily, so it is assigned right after the context exists.
  const ctx = {
    config: resolved,
    adapter,
    transport,
    logger,
    emitter,
    resolveAccount: createAccountResolver(adapter),
    slots: createStubSlots(),
    ready: () => (schemaCheck ??= checkSchema()),
    async callTransport(account, fn) {
      try {
        return await fn();
      } catch (error) {
        if (error instanceof MetaApiError && error.isInvalidToken) {
          await emitter.emit("account.error", { account, error });
        }
        throw error;
      }
    },
    addSecret,
    secrets,
    normalizePhone: (input) => normalizePhone(input, { defaultCountry: resolved.defaultCountry }),
  } as WhatsAppContext;
  ctx.services = createServices(ctx);

  for (const install of WHATSAPP_MODULES) install(ctx);

  const { conversations } = ctx.services;
  const client: WhatsApp = {
    on: (event, handler) => emitter.on(event, handler),
    send: createSendApi(ctx),
    templates: {
      async sync(opts) {
        await ctx.ready();
        return ctx.services.templates.sync(opts);
      },
      async list(query) {
        await ctx.ready();
        return ctx.services.templates.list(query);
      },
    },
    conversations: {
      async get(id) {
        await ctx.ready();
        return adapter.conversations.get(id);
      },
      async handoff(id, opts) {
        await ctx.ready();
        return (await conversations.handoff(id, opts)).conversation;
      },
      async returnToAgent(id, opts) {
        await ctx.ready();
        return conversations.returnToAgent(id, opts);
      },
      async close(id, opts) {
        await ctx.ready();
        return conversations.close(id, opts);
      },
      async assign(id, userId, opts) {
        await ctx.ready();
        return conversations.assign(id, userId, opts);
      },
      async windowStatus(id) {
        await ctx.ready();
        return conversations.windowStatus(id);
      },
    },
    handleWebhook: (request, opts) => ctx.slots.handleWebhook(request, opts),
    get events() {
      return ctx.slots.events;
    },
    get maintenance() {
      return ctx.slots.maintenance;
    },
    get inbox() {
      return ctx.slots.inbox;
    },
    get agent() {
      return ctx.slots.agent;
    },
  };
  ctx.client = client;
  attachContext(client, ctx);
  return client;
}
