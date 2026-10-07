import { describe, expect, it } from "vitest";
import { memoryAdapter } from "../adapters/memory";
import { ConfigError } from "../errors/errors";
import { quamiCloud } from "../transport/quami-cloud";
import { metaDirect } from "../transport/meta-direct";
import { WA_SCHEMA_VERSION } from "../utils/schema-version";
import type { WhatsAppConfig } from "./config";
import { getContext } from "./context";
import { createWhatsApp } from "./create-whatsapp";
import {
  accountInput,
  acceptSends,
  captureLogger,
  makeClient,
  openConversation,
  TOKENS,
  useGraphServer,
} from "./test-utils";

const graph = useGraphServer();

const shorthand = () => ({
  adapter: memoryAdapter(),
  appSecret: "secret",
  verifyToken: "verify",
  resolveToken: () => "token",
});

describe("createWhatsApp config", () => {
  it.each([
    ["adapter", { ...shorthand(), adapter: undefined }],
    ["appSecret", { ...shorthand(), appSecret: undefined }],
    ["appSecret (empty)", { ...shorthand(), appSecret: "" }],
    ["verifyToken", { ...shorthand(), verifyToken: undefined }],
    ["resolveToken", { ...shorthand(), resolveToken: undefined }],
    ["eventRetentionDays", { ...shorthand(), eventRetentionDays: 0 }],
    ["agentDefaults.historyLimit", { ...shorthand(), agentDefaults: { historyLimit: -1 } }],
  ])("throws ConfigError for an invalid %s", (_name, config) => {
    expect(() => createWhatsApp(config as unknown as WhatsAppConfig)).toThrow(ConfigError);
  });

  it("applies defaults", () => {
    const ctx = getContext(createWhatsApp(shorthand()));
    expect(ctx.config.agentDefaults).toEqual({
      historyLimit: 20,
      maxStepsPerTurn: 5,
      maxMessagesPerMinutePerContact: 10,
    });
    expect(ctx.config.eventRetentionDays).toBe(30);
    expect(ctx.config.handoffMessage).toBe("Te comunico con una persona del equipo.");
    expect(ctx.transport.kind).toBe("meta-direct");
  });

  it("keeps overrides, including a null handoff message", () => {
    const ctx = getContext(
      createWhatsApp({
        ...shorthand(),
        agentDefaults: { historyLimit: 5 },
        eventRetentionDays: 7,
        handoffMessage: null,
      }),
    );
    expect(ctx.config.agentDefaults.historyLimit).toBe(5);
    expect(ctx.config.agentDefaults.maxStepsPerTurn).toBe(5);
    expect(ctx.config.eventRetentionDays).toBe(7);
    expect(ctx.config.handoffMessage).toBeNull();
  });

  it("accepts a custom transport without appSecret/verifyToken", () => {
    const transport = quamiCloud({ apiKey: "k" });
    const wa = createWhatsApp({ adapter: memoryAdapter(), transport });
    expect(getContext(wa).transport).toBe(transport);
  });

  it("rejects objects that are not clients in getContext", () => {
    expect(() => getContext({})).toThrow(TypeError);
  });

  it("redacts resolved tokens and configured secrets from logs", async () => {
    graph.server.use(acceptSends());
    const { wa, ctx, adapter, logs } = makeClient();
    const account = await adapter.accounts.insert(accountInput());
    await openConversation(ctx, account);
    await wa.send.text("+50255550001", "Hola");
    ctx.logger.error(`leak ${TOKENS.WA_TOKEN_A ?? ""} app-secret-value verify-token-value`);
    const [line] = logs.of("error");
    expect(line).toContain("[REDACTED]");
    expect(line).not.toContain("token-account-a-secret");
    expect(line).not.toContain("app-secret-value");
    expect(line).not.toContain("verify-token-value");
  });

  it("registers the secrets of a custom metaDirect transport", () => {
    const { logger, logs } = captureLogger();
    const wa = createWhatsApp({
      adapter: memoryAdapter(),
      transport: metaDirect({
        appSecret: "custom-secret",
        verifyToken: "v-token",
        resolveToken: () => "t",
      }),
      logger,
    });
    getContext(wa).logger.info("custom-secret v-token");
    expect(logs.of("info")[0]).toBe("[REDACTED] [REDACTED]");
  });
});

describe("lazy schema check", () => {
  it("warns once when the schema is older than WA_SCHEMA_VERSION", async () => {
    const { wa, logs } = makeClient({ memory: { schemaVersion: WA_SCHEMA_VERSION - 1 } });
    expect(logs.of("warn")).toHaveLength(0);
    await wa.templates.list();
    await wa.templates.list();
    await wa.conversations.get("00000000-0000-4000-8000-000000000000");
    expect(logs.of("warn")).toHaveLength(1);
    expect(logs.of("warn")[0]).toContain("older than");
  });

  it("warns that tables are missing when schemaVersion() is null", async () => {
    const { wa, logs } = makeClient({ memory: { schemaVersion: null } });
    await wa.templates.list();
    expect(logs.of("warn")).toEqual([expect.stringContaining("tables are missing")]);
  });

  it("stays quiet when the schema is current", async () => {
    const { wa, logs } = makeClient();
    await wa.templates.list();
    expect(logs.of("warn")).toHaveLength(0);
  });
});
