/**
 * Product spec 4.6 "Voice notes and cost". Cost (SND-3.2, SND-4.10) and voice-note transcription
 * (SND-4.10). End to end: signed webhook (msw Graph media download) → transcription on a scripted
 * transcription model → agent turn on a scripted model that reports usage → stored reply →
 * `sendo.inbox.thread` / `sendo.inbox.cost`.
 *
 * Ways it could fail (one test each):
 * [AC-VN-1a] The voice note is not transcribed, or is transcribed after the agent turn: the
 *            transcript is not in `text`, `metadata.transcription = { model, ms }` is missing,
 *            the `message` event or the agent don't see it, or the model gets other bytes.
 * [AC-VN-1b] A model that never answers blocks the pipeline (no timeout) instead of leaving
 *            `text` null with `metadata.transcription.error = "timeout"`.
 * [AC-VN-1c] A voice note over 25 MB is sent to the model instead of being skipped (`too_large`).
 * [AC-VN-2a] A failing model fails the event or the agent turn, instead of `text` null + `failed`
 *            and the agent reading "[untranscribed voice note]"; the inbox doesn't expose it.
 * [AC-VN-2b] Without `transcribe`, audio is still sent somewhere or gets a transcription record.
 * [AC-VN-2c] An invalid `transcribe` config is accepted.
 * [AC-CO-1a] The provider's reported cost (`providerMetadata.openrouter.usage.cost`, USD) is
 *            ignored, not converted to cents, or loses to `pricing`.
 * [AC-CO-1b] Without a provider cost, `pricing` (USD per million tokens) is not applied to the
 *            turn's total input/output tokens.
 * [AC-CO-1c] With neither, `costCents` is invented instead of `null`; tokens are not stored.
 * [AC-CO-1d] A multi-step turn (tool call, then text) stores only the last step's usage or cost.
 * [AC-CO-1e] An invalid `pricing` is accepted.
 * [AC-CO-2a] Non-admins read token counts or cost from `sendo.inbox.thread`.
 * [AC-CO-2b] `sendo.inbox.cost` misses turns beyond the first thread page, counts notes or
 *            inbound messages, invents a cost for unpriced turns, or answers non-admins.
 */
import { http, HttpResponse } from "msw";
import { MockTranscriptionModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentTool } from "../../src/agents/runtime";
import {
  promptOf,
  scriptedModel,
  textResult,
  textWebhook,
  toolCallResult,
  type GenerateResult,
} from "../../src/agents/test-helpers";
import type { AgentDefinition } from "../../src/agents/types";
import { acceptSends, GRAPH, useGraphServer } from "../../src/core/test-utils";
import { ConfigError } from "../../src/errors/errors";
import type { ResolveRole, TranscribeConfig } from "../../src/team/config";
import {
  createHarness,
  FIXTURE_MEDIA,
  freshFixture,
  LOOKASIDE,
  MEDIA_BYTES,
  mediaHandlers,
} from "./harness";

const graph = useGraphServer();

function withUsage(
  result: GenerateResult,
  tokens: { input: number; output: number },
  providerCostUsd?: number,
): GenerateResult {
  return {
    ...result,
    usage: {
      inputTokens: {
        total: tokens.input,
        noCache: tokens.input,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: tokens.output, text: tokens.output, reasoning: undefined },
    },
    ...(providerCostUsd !== undefined && {
      providerMetadata: { openrouter: { usage: { cost: providerCostUsd } } },
    }),
  };
}

const resolveRole: ResolveRole = ({ userId }) =>
  Promise.resolve(
    userId === "alma" ? { role: "admin" } : userId === "sofia" ? { role: "supervisor" } : null,
  );

async function turn(definition: Partial<AgentDefinition>) {
  graph.server.use(acceptSends());
  const h = await createHarness({ resolveRole });
  h.sendo.agent({
    name: "recepcion",
    model: scriptedModel(textResult("Hola")),
    instructions: "Eres la recepcionista.",
    ...definition,
  });
  await h.deliver(textWebhook({ id: `wamid.CO${String(Date.now())}`, body: "¿Precio?" }));
  const reply = h.messages("out").find((m) => m.sender === "agent");
  if (!reply) throw new Error("no agent reply");
  return { ...h, reply };
}

describe("Turn usage and cost (AC-CO-1)", () => {
  it("[AC-CO-1a] the provider's reported cost wins over pricing", async () => {
    const { reply } = await turn({
      model: scriptedModel(withUsage(textResult("Q100"), { input: 1000, output: 200 }, 0.0015)),
      pricing: { inputPerMTok: 100, outputPerMTok: 100 },
    });
    expect(reply).toMatchObject({ tokensIn: 1000, tokensOut: 200, costCents: 0.15 });
  });

  it("[AC-CO-1b] without a provider cost, pricing prices the turn's tokens", async () => {
    const { reply } = await turn({
      model: scriptedModel(withUsage(textResult("Q100"), { input: 1000, output: 200 })),
      pricing: { inputPerMTok: 0.25, outputPerMTok: 2 },
    });
    // (1000 × 0.25 + 200 × 2) / 1e6 USD = 0.00065 USD = 0.065 cents
    expect(reply).toMatchObject({ tokensIn: 1000, tokensOut: 200, costCents: 0.065 });
  });

  it("[AC-CO-1c] with neither, cost is null and tokens are still stored", async () => {
    const { reply } = await turn({
      model: scriptedModel(withUsage(textResult("Q100"), { input: 860, output: 18 })),
    });
    expect(reply).toMatchObject({ tokensIn: 860, tokensOut: 18, costCents: null });
  });

  it("[AC-CO-1d] a multi-step turn stores the whole turn's usage and summed provider cost", async () => {
    const { reply } = await turn({
      model: scriptedModel(
        withUsage(
          toolCallResult("precio", { item: "consulta" }),
          { input: 500, output: 20 },
          0.001,
        ),
        withUsage(textResult("La consulta cuesta Q100"), { input: 700, output: 30 }, 0.002),
      ),
      tools: {
        precio: agentTool({
          input: z.object({ item: z.string() }),
          run: () => Promise.resolve({ precio: 100 }),
        }),
      },
    });
    expect(reply).toMatchObject({
      text: "La consulta cuesta Q100",
      tokensIn: 1200,
      tokensOut: 50,
      costCents: 0.3,
    });
  });

  it("[AC-CO-1e] pricing must be non-negative numbers", async () => {
    const h = await createHarness();
    for (const pricing of [
      { inputPerMTok: -1, outputPerMTok: 1 },
      { inputPerMTok: 1 },
      { inputPerMTok: "1", outputPerMTok: 1 },
    ]) {
      expect(() =>
        h.sendo.agent({
          name: "recepcion",
          model: scriptedModel(textResult("Hola")),
          instructions: "x",
          pricing: pricing as unknown as AgentDefinition["pricing"],
        }),
      ).toThrow(ConfigError);
    }
  });

  it("[AC-CO-2a] only admins read usage and cost in the inbox thread", async () => {
    const h = await turn({
      model: scriptedModel(withUsage(textResult("Q100"), { input: 1000, output: 200 }, 0.0015)),
    });
    const conversationId = h.reply.conversationId;
    const admin = await h.sendo.actor("alma", "tenant-a");
    const supervisor = await h.sendo.actor("sofia", "tenant-a");
    const read = async (actor: typeof admin) =>
      (await h.sendo.inbox.thread(conversationId, { actor })).items.find(
        (m) => m.id === h.reply.id,
      );
    expect(await read(admin)).toMatchObject({ tokensIn: 1000, tokensOut: 200, costCents: 0.15 });
    expect(await read(supervisor)).toMatchObject({
      tokensIn: null,
      tokensOut: null,
      costCents: null,
    });
  });
});

describe("Agent cost of a whole conversation (AC-CO-2)", () => {
  it("[AC-CO-2b] inbox.cost totals every agent turn across thread pages, admins only", async () => {
    const h = await turn({
      model: scriptedModel(withUsage(textResult("Q100"), { input: 1000, output: 200 }, 0.0015)),
    });
    const { conversationId } = h.reply;
    const base = { tenantId: "tenant-a", conversationId, type: "text" as const };
    // 120 more agent turns (beyond one 100-message page): 100 priced at 0.01 ¢, 20 unpriced.
    for (let i = 0; i < 120; i++) {
      await h.adapter.messages.insertOutbound({
        ...base,
        content: { body: `r${String(i)}` },
        text: `r${String(i)}`,
        sender: "agent",
        senderRef: "recepcion",
        tokensIn: 10,
        tokensOut: 2,
        costCents: i < 100 ? 0.01 : null,
      });
    }
    // Neither notes nor operator replies are agent turns.
    await h.adapter.messages.insertOutbound({
      ...base,
      content: { body: "nota" },
      text: "nota",
      sender: "human",
      senderRef: "alma",
      internal: true,
      status: "sent",
    });
    await h.adapter.messages.insertOutbound({
      ...base,
      content: { body: "hola" },
      text: "hola",
      sender: "human",
      senderRef: "alma",
      tokensIn: 999,
      costCents: 99,
    });

    const admin = await h.sendo.actor("alma", "tenant-a");
    const cost = await h.sendo.inbox.cost(conversationId, { actor: admin });
    expect(cost.turns).toBe(121);
    expect(cost.tokensIn).toBe(1000 + 120 * 10);
    expect(cost.tokensOut).toBe(200 + 120 * 2);
    expect(cost.unpricedTurns).toBe(20);
    expect(cost.costCents).toBeCloseTo(0.15 + 100 * 0.01, 6);

    const supervisor = await h.sendo.actor("sofia", "tenant-a");
    await expect(h.sendo.inbox.cost(conversationId, { actor: supervisor })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

const TRANSCRIPT = "Hola, quiero saber el precio de la consulta";

type TranscriptionResult = Awaited<ReturnType<MockTranscriptionModelV3["doGenerate"]>>;

function transcriptionResult(text: string): TranscriptionResult {
  return {
    text,
    segments: [],
    language: "es",
    durationInSeconds: 4,
    warnings: [],
    response: { timestamp: new Date(), modelId: "whisper-test" },
  };
}

type TranscriptionCall = Parameters<MockTranscriptionModelV3["doGenerate"]>[0];

/** A scripted transcription model that records its calls. */
function transcriptionModel(
  answer: (call: TranscriptionCall) => PromiseLike<TranscriptionResult> = () =>
    Promise.resolve(transcriptionResult(TRANSCRIPT)),
) {
  const calls: TranscriptionCall[] = [];
  const model = new MockTranscriptionModelV3({
    modelId: "whisper-test",
    doGenerate: (call) => {
      calls.push(call);
      return answer(call);
    },
  });
  return Object.assign(model, { calls });
}

/** Text of every prompt part the agent model received. */
function agentPrompt(model: ReturnType<typeof scriptedModel>): string {
  return JSON.stringify(promptOf(model));
}

/** A voice note through the signed webhook, with an agent and optionally `transcribe`. */
async function voiceNote(transcribe?: TranscribeConfig) {
  graph.server.use(acceptSends());
  const h = await createHarness({ resolveRole, ...(transcribe && { transcribe }) });
  const agentModel = scriptedModel(textResult("Claro, la consulta cuesta Q100"));
  h.sendo.agent({ name: "recepcion", model: agentModel, instructions: "Eres la recepcionista." });
  const event = await h.deliver(freshFixture("audio-voice"));
  const [note] = h.messages("in");
  if (!note) throw new Error("voice note not stored");
  const admin = await h.sendo.actor("alma", "tenant-a");
  const inbox = (await h.sendo.inbox.thread(note.conversationId, { actor: admin })).items.find(
    (m) => m.id === note.id,
  );
  return { ...h, event, note, agentModel, inbox };
}

describe("Voice-note transcription (AC-VN-1, AC-VN-2)", () => {
  it("[AC-VN-1a] the voice note is transcribed before the agent turn", async () => {
    graph.server.use(...mediaHandlers());
    const model = transcriptionModel();
    const h = await voiceNote({ model });

    expect(h.event.status).toBe("processed");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.audio).toEqual(MEDIA_BYTES);
    expect(h.note.text).toBe(TRANSCRIPT);
    const { transcription } = h.note.metadata as { transcription: Record<string, unknown> };
    expect(Object.keys(transcription).sort()).toEqual(["model", "ms"]);
    expect(transcription.model).toBe("whisper-test");
    expect(typeof transcription.ms).toBe("number");
    expect(h.messageEvents[0]?.message.text).toBe(TRANSCRIPT);
    expect(agentPrompt(h.agentModel)).toContain(`[voice note] ${TRANSCRIPT}`);
    expect(h.messages("out").find((m) => m.sender === "agent")?.text).toBe(
      "Claro, la consulta cuesta Q100",
    );
    expect(h.inbox).toMatchObject({
      text: TRANSCRIPT,
      transcription: { model: "whisper-test", error: null },
      media: { downloadStatus: "done" },
    });
  });

  it("[AC-VN-1b] a model that never answers times out; the agent still runs", async () => {
    graph.server.use(...mediaHandlers());
    let aborted = false;
    const model = transcriptionModel(
      ({ abortSignal }) =>
        new Promise<TranscriptionResult>(() => {
          abortSignal?.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    );
    const h = await voiceNote({ model, timeoutMs: 50 });

    expect(h.event.status).toBe("processed");
    expect(aborted).toBe(true);
    expect(h.note.text).toBeNull();
    expect(h.note.metadata.transcription).toMatchObject({
      model: "whisper-test",
      error: "timeout",
    });
    expect(agentPrompt(h.agentModel)).toContain("[untranscribed voice note]");
    expect(h.logs.of("warn").join("\n")).toContain("(timeout)");
  });

  it("[AC-VN-1c] a voice note over 25 MB is skipped without calling the model", async () => {
    const tooLarge = 25 * 1024 * 1024 + 1;
    // Earlier handlers win: Meta reports the oversized file, the download itself stays small.
    graph.server.use(
      http.get(`${GRAPH}/:mediaId`, ({ params }) =>
        HttpResponse.json({
          id: String(params.mediaId),
          url: `${LOOKASIDE}/${String(params.mediaId)}`,
          mime_type: FIXTURE_MEDIA["300000000000002"],
          file_size: tooLarge,
        }),
      ),
      ...mediaHandlers(),
    );
    const model = transcriptionModel();
    const h = await voiceNote({ model });

    expect(model.calls).toHaveLength(0);
    expect(h.note.text).toBeNull();
    expect(h.note.metadata.transcription).toMatchObject({ error: "too_large" });
    expect(agentPrompt(h.agentModel)).toContain("[untranscribed voice note]");
    expect(h.inbox).toMatchObject({ text: null, transcription: { error: "too_large" } });
  });

  it("[AC-VN-2a] a failing model leaves text null and the agent reads the marker", async () => {
    graph.server.use(...mediaHandlers());
    const model = transcriptionModel(() => Promise.reject(new Error("provider down")));
    const h = await voiceNote({ model });

    expect(h.event.status).toBe("processed");
    expect(h.note.text).toBeNull();
    expect(h.note.metadata.transcription).toMatchObject({ model: "whisper-test", error: "failed" });
    expect(agentPrompt(h.agentModel)).toContain("[untranscribed voice note]");
    expect(agentPrompt(h.agentModel)).not.toContain("provider down");
    expect(h.messages("out").some((m) => m.sender === "agent")).toBe(true);
    expect(h.inbox).toMatchObject({ text: null, transcription: { error: "failed" } });
  });

  it("[AC-VN-2b] without transcribe nothing is transcribed and the agent reads the marker", async () => {
    graph.server.use(...mediaHandlers());
    const h = await voiceNote();

    expect(h.note.text).toBeNull();
    expect(h.note.metadata.transcription).toBeUndefined();
    expect(h.inbox).toMatchObject({ transcription: null });
    expect(agentPrompt(h.agentModel)).toContain("[untranscribed voice note]");
  });

  it("[AC-VN-2c] an invalid transcribe config fails createSendo", async () => {
    for (const transcribe of [
      {},
      { model: "" },
      { model: { modelId: "x" } },
      { model: transcriptionModel(), timeoutMs: 0 },
      { model: transcriptionModel(), timeoutMs: 60_000 },
    ]) {
      await expect(
        createHarness({
          transcribe: transcribe as unknown as TranscribeConfig,
        }),
      ).rejects.toBeInstanceOf(ConfigError);
    }
  });
});
