import { MetaApiError } from "../errors/meta-api-error";
import { createActorResolver, type ActorResolver } from "../team/actor";
import { resolveTeamConfig } from "../team/config";
import { metaDirect, type MetaDirectTransport } from "../transport/meta-direct";
import type { Transport } from "../transport/types";
import type { Conversation, Template, WindowStatus } from "../types/entities";
import { createRedactingLogger } from "../utils/logger";
import { normalizePhone } from "../utils/phone";
import { SENDO_SCHEMA_VERSION, schemaDriftMessage } from "../utils/schema-version";
import {
  createAccountResolver,
  createAccountsApi,
  resolveAccountsConfig,
  type AccountOption,
  type AccountsApi,
} from "./accounts";
import { validateConfig, type SendoConfig } from "./config";
import { attachContext, createNoopRulesHooks, type SendoContext } from "./context";
import { createEmitter, type SendoEmitter } from "./events";
import { SENDO_MODULES } from "./modules";
import { createSendApi, type SendApi } from "./send";
import {
  createServices,
  type ByOption,
  type HandoffOptions,
  type TemplatesListQuery,
} from "./services";
import { createStubSlots, type MaintenanceApi, type SendoSlots } from "./slots";

export interface TemplatesApi {
  /**
   * Pulls templates from Meta: the given `account`, else every active account of `tenant`,
   * else every active account.
   */
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
  /**
   * Pauses (or resumes) the agent on one conversation: no turns run while paused, and on resume
   * it does not answer what arrived during the pause. Emits `conversation.agent_paused` on change.
   */
  pauseAgent(id: string, paused: boolean, opts?: ByOption): Promise<Conversation>;
  windowStatus(id: string): Promise<WindowStatus>;
}

export interface Sendo {
  /** Subscribes to an event; returns an unsubscribe function. */
  on: SendoEmitter["on"];
  send: SendApi;
  templates: TemplatesApi;
  /** Numbers: list, add, default, label, agent pause/mode, disconnect, purge, Embedded Signup. */
  accounts: AccountsApi;
  conversations: ConversationsApi;
  handleWebhook: SendoSlots["handleWebhook"];
  readonly events: SendoSlots["events"];
  readonly maintenance: MaintenanceApi;
  readonly inbox: SendoSlots["inbox"];
  readonly agent: SendoSlots["agent"];
  /**
   * Resolves the acting user through `resolveRole`. Fails closed: throws `ForbiddenError`
   * when `resolveRole` is missing or returns `null`.
   */
  actor: ActorResolver;
  readonly snippets: SendoSlots["snippets"];
  readonly tags: SendoSlots["tags"];
  readonly rules: SendoSlots["rules"];
  readonly links: SendoSlots["links"];
  readonly broadcasts: SendoSlots["broadcasts"];
  readonly contacts: SendoSlots["contacts"];
  readonly metrics: SendoSlots["metrics"];
}

function buildTransport(
  config: SendoConfig,
  ctx: Pick<SendoContext, "addSecret" | "logger">,
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
  const appSecret = config.appSecret ?? "";
  ctx.addSecret(appSecret);
  ctx.addSecret(config.verifyToken);
  const resolveToken = config.resolveToken;
  return metaDirect({
    appSecret,
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

/** Creates a sendo client. Throws `ConfigError` on invalid configuration. */
export function createSendo(config: SendoConfig): Sendo {
  const resolved = validateConfig(config);
  const team = resolveTeamConfig(config);
  const accountsConfig = resolveAccountsConfig(config);
  const adapter = resolved.adapter;

  const knownSecrets = new Set<string>();
  const addSecret = (value: string): void => {
    if (value.trim() !== "") knownSecrets.add(value);
  };
  const secrets = (): readonly string[] => [...knownSecrets];
  const logger = createRedactingLogger(config.logger, secrets);
  if (resolved.connect !== null)
    [resolved.connect.apiKey, resolved.connect.signingSecret].forEach(addSecret);
  const emitter = createEmitter(logger);
  const transport = buildTransport(config, { addSecret, logger });

  let schemaCheck: Promise<void> | undefined;
  async function checkSchema(): Promise<void> {
    try {
      const version = await adapter.schemaVersion();
      if (version === null) {
        logger.warn(
          "[sendo] The sendo_* tables are missing (schemaVersion() returned null). Install the migrations with npx shadcn add @sendo/schema and apply them.",
        );
      } else if (version < SENDO_SCHEMA_VERSION) {
        logger.warn(`[sendo] ${schemaDriftMessage(version)}`);
      }
    } catch (error) {
      logger.warn("[sendo] Could not check the database schema version", error);
    }
  }

  // `services` reads `ctx` lazily, so it is assigned right after the context exists.
  const ctx = {
    config: resolved,
    team,
    accountsConfig,
    rulesHooks: createNoopRulesHooks(),
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
  } as SendoContext;
  ctx.services = createServices(ctx);

  for (const install of SENDO_MODULES) install(ctx);

  const { conversations } = ctx.services;
  const client: Sendo = {
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
    accounts: createAccountsApi(ctx),
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
      async pauseAgent(id, paused, opts) {
        await ctx.ready();
        return conversations.pauseAgent(id, paused, opts);
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
    maintenance: {
      prune: (opts) => ctx.slots.maintenance.prune(opts),
      tick: (opts) => ctx.slots.tick(opts),
    },
    get inbox() {
      return ctx.slots.inbox;
    },
    get agent() {
      return ctx.slots.agent;
    },
    actor: createActorResolver(ctx),
    get snippets() {
      return ctx.slots.snippets;
    },
    get tags() {
      return ctx.slots.tags;
    },
    get rules() {
      return ctx.slots.rules;
    },
    get links() {
      return ctx.slots.links;
    },
    get broadcasts() {
      return ctx.slots.broadcasts;
    },
    get contacts() {
      return ctx.slots.contacts;
    },
    get metrics() {
      return ctx.slots.metrics;
    },
  };
  ctx.client = client;
  attachContext(client, ctx);
  return client;
}
