import { describe, expect, it } from "vitest";
import { FIXTURE_IDS } from "../../test/support/fixtures";
import { getContext } from "../core/context";
import { createWhatsApp } from "../core/create-whatsapp";
import {
  acceptSends,
  accountInput,
  burstWebhook,
  makeClient,
  useGraphServer,
  type ClientOptions,
} from "../core/test-utils";
import type { Account } from "../types/entities";
import {
  scriptedModel,
  storeInbound,
  textResult,
  textWebhook,
  transcript,
  webhookRequest,
} from "./test-helpers";
import type { AgentDefinition } from "./types";

const graph = useGraphServer();

async function setup(options: ClientOptions = {}) {
  const client = makeClient(options);
  const account = await client.adapter.accounts.insert(
    accountInput({ phoneNumberId: FIXTURE_IDS.phoneNumberId, wabaId: FIXTURE_IDS.wabaId }),
  );
  const sent: unknown[] = [];
  graph.server.use(acceptSends(sent));

  /** Posts a signed webhook and waits for the background pipeline (and agent turns). */
  async function deliver(body: string) {
    const tasks: Promise<unknown>[] = [];
    const response = await client.wa.handleWebhook(webhookRequest(body), {
      waitUntil: (p) => tasks.push(p),
    });
    expect(response.status).toBe(200);
    await Promise.all(tasks);
  }

  function outbound() {
    return [...client.adapter.__state.messages.values()]
      .filter((m) => m.direction === "out")
      .sort((a, b) => a.seq - b.seq);
  }

  return { ...client, account, sent, deliver, outbound };
}

function agentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: "recepcion",
    model: scriptedModel(textResult("¡Hola! ¿En qué te ayudo?")),
    instructions: "Eres la recepcionista de la clínica.",
    ...overrides,
  };
}

describe("wa.agent — registration", () => {
  it("logs a ConfigError and runs no turn when predicates overlap at dispatch", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("hola"));
    t.wa.agent(agentDef({ name: "a", model, accounts: () => true }));
    t.wa.agent(agentDef({ name: "b", model, accounts: () => true }));
    await t.deliver(textWebhook({ id: "wamid.P1", body: "hola" }));
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(t.logs.of("error").some((line) => line.includes("only one agent"))).toBe(true);
  });

  it("filters accounts by id, phone number id or predicate", async () => {
    const t = await setup();
    const other: Account = await t.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OTHER", wabaId: "WABA_O", tokenRef: "WA_TOKEN_B" }),
    );
    const byPhone = scriptedModel(textResult("desde phone id"));
    const byPredicate = scriptedModel(textResult("desde predicado"));
    t.wa.agent(agentDef({ name: "a", model: byPhone, accounts: [FIXTURE_IDS.phoneNumberId] }));
    t.wa.agent(agentDef({ name: "b", model: byPredicate, accounts: (a) => a.id === other.id }));
    await t.deliver(textWebhook({ id: "wamid.F1", body: "hola" }));
    expect(byPhone.doGenerateCalls).toHaveLength(1);
    expect(byPredicate.doGenerateCalls).toHaveLength(0);

    const { message, ...target } = await storeInbound(t.ctx, other, { text: "hola" });
    await t.ctx.agentDispatcher?.handleInbound({ ...target, account: other, message });
    expect(byPredicate.doGenerateCalls).toHaveLength(1);

    const byId = makeClient();
    const acc = await byId.adapter.accounts.insert(accountInput());
    const idModel = scriptedModel(textResult("ok"));
    byId.wa.agent(agentDef({ model: idModel, accounts: [acc.id] }));
    const stored = await storeInbound(byId.ctx, acc);
    await byId.ctx.agentDispatcher?.handleInbound({ ...stored, account: acc });
    expect(idModel.doGenerateCalls).toHaveLength(1);
  });
});

describe("wa.agent — turns", () => {
  it("returns without a turn when the conversation lock is held", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    t.wa.agent(agentDef({ model }));
    const stored = await storeInbound(t.ctx, t.account);
    await t.adapter.locks.acquire(`conv:${stored.conversation.id}`, 60_000);
    await t.ctx.agentDispatcher?.handleInbound({ ...stored, account: t.account });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("answers a burst batched in one payload once, with every message in the prompt", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("¡Claro! ¿A qué hora mañana?"));
    t.wa.agent(agentDef({ model }));
    await t.deliver(
      burstWebhook([
        { id: "wamid.BURST1", body: "hola" },
        { id: "wamid.BURST2", body: "quiero cita" },
        { id: "wamid.BURST3", body: "mañana" },
      ]),
    );

    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = transcript(model).join("\n");
    expect(prompt).toContain("hola");
    expect(prompt).toContain("quiero cita");
    expect(prompt).toContain("mañana");
    expect(t.outbound()).toEqual([
      expect.objectContaining({ sender: "agent", text: "¡Claro! ¿A qué hora mañana?" }),
    ]);
    expect(t.sent).toHaveLength(1);
  });

  it("does not answer again for a message a previous turn covered", async () => {
    const t = await setup();
    const model = scriptedModel(textResult("ok"));
    t.wa.agent(agentDef({ model }));
    const stored = await storeInbound(t.ctx, t.account);
    await t.ctx.agentDispatcher?.handleInbound({ ...stored, account: t.account });

    // A second client (another process) shares the database: the coverage comes from metadata.
    const second = createWhatsApp({
      adapter: t.adapter,
      appSecret: "s",
      verifyToken: "v",
      resolveToken: () => "token-account-a-secret",
    });
    const otherModel = scriptedModel(textResult("otra vez"));
    second.agent(agentDef({ model: otherModel }));
    await getContext(second).agentDispatcher?.handleInbound({ ...stored, account: t.account });
    expect(otherModel.doGenerateCalls).toHaveLength(0);
  });
});
