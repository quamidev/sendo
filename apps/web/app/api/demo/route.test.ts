/**
 * Live demo (AC-ST-2, AC-ST-9, AC-ST-15), driven through `app/api/demo/route.ts` with real Sendo
 * internals (memory adapter, fake Meta transport, signed webhooks, agent runtime). The model is a
 * scripted `MockLanguageModelV3` registered as the AI SDK default provider, so `SENDO_DEMO_MODEL`
 * resolves to it exactly like a real model id would. Counters use the in-memory store.
 *
 * Ways the language, cap and cookie-free changes (SNL-4.3) can fail, one test each:
 *
 * 1. The demo ignores the page language: the scripted reply (the greeting without a model), the
 *    visitor's name and apartment or the handoff message don't follow `lang` (body, else
 *    `?lang=`, else `en`), or the agent isn't told to greet in the page language and then follow
 *    the visitor's language.
 * 2. `SENDO_DEMO_DAILY_CAP` is ignored, or going past it fails the request instead of answering
 *    with the scripted fallback and `fallback: "daily_cap"` (the chat's "demo limit reached" note).
 * 3. A demo response sets a cookie (AC-ST-15), on success or on error.
 * 4. The session counter doesn't round-trip: the token a response returns isn't honoured when sent
 *    back in `x-sendo-demo`, or a forged or missing token isn't counted as 0.
 */
import { MockLanguageModelV3, MockProviderV3 } from "ai/test";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoFallbackText } from "@/lib/demo/copy";
import {
  DEMO_CONVERSATION_ID,
  DEMO_IP_DAILY_LIMIT,
  DEMO_SESSION_LIMIT,
  DEMO_TOKEN_HEADER,
  type DemoRequest,
  type DemoResponse,
  type DemoTurn,
} from "@/lib/demo/protocol";
import { demo } from "@/lib/i18n/dictionaries/demo";
import { POST } from "./route";

const FALLBACK_EN = demoFallbackText("en");
const FALLBACK_ES = demoFallbackText("es");

type Model = InstanceType<typeof MockLanguageModelV3>;
type GenerateResult = Awaited<ReturnType<Model["doGenerate"]>>;
type CallOptions = Model["doGenerateCalls"][number];

const MODEL_ID = "scripted/demo";
const usage = (input: number, output: number): GenerateResult["usage"] => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: output, text: output, reasoning: undefined },
});

function text(value: string): GenerateResult {
  return {
    content: [{ type: "text", text: value }],
    finishReason: { unified: "stop", raw: undefined },
    usage: usage(900, 40),
    warnings: [],
  };
}

function toolCall(toolName: string, input: Record<string, string>): GenerateResult {
  return {
    content: [
      { type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: usage(900, 20),
    warnings: [],
  };
}

/** A model that plays `script` in order (the last step repeats). */
function scripted(...script: GenerateResult[]): Model {
  let step = 0;
  const model = new MockLanguageModelV3({
    doGenerate: () => {
      const result = script[Math.min(step, script.length - 1)];
      step += 1;
      if (result === undefined) throw new Error("empty script");
      return Promise.resolve(result);
    },
  });
  globalThis.AI_SDK_DEFAULT_PROVIDER = new MockProviderV3({
    languageModels: { [MODEL_ID]: model },
  });
  vi.stubEnv("SENDO_DEMO_MODEL", MODEL_ID);
  return model;
}

function promptText(call: CallOptions | undefined): string {
  return (call?.prompt ?? [])
    .flatMap((message) =>
      message.role === "system"
        ? [message.content]
        : message.content.flatMap((part) =>
            part.type === "text"
              ? [part.text]
              : part.type === "tool-result"
                ? [JSON.stringify(part.output)]
                : [],
          ),
    )
    .join("\n");
}

let ipSeq = 0;
function freshIp(): string {
  ipSeq += 1;
  return `203.0.113.${String(ipSeq)}`;
}

interface Sent {
  status: number;
  body: DemoResponse;
  /** The signed session counter the response returned (send it back as `token`). */
  token: string | null;
  setCookie: string | null;
}

async function send(
  body: DemoRequest,
  opts: { ip: string; token?: string | null; origin?: string; query?: string; post?: typeof POST },
): Promise<Sent> {
  const headers = new Headers({ "content-type": "application/json", host: "sendo.dev" });
  headers.set("x-forwarded-for", opts.ip);
  if (opts.token) headers.set(DEMO_TOKEN_HEADER, opts.token);
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  const response = await (opts.post ?? POST)(
    new Request(`https://sendo.dev/api/demo${opts.query ?? ""}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  const json = (await response.json()) as DemoResponse;
  return {
    status: response.status,
    body: json,
    token: typeof json.token === "string" ? json.token : null,
    setCookie: response.headers.get("set-cookie"),
  };
}

beforeEach(() => {
  vi.stubEnv("SENDO_DEMO_MODEL", "");
  vi.stubEnv("SENDO_DEMO_BUDGET_USD", "1000");
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
});

afterAll(() => {
  globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
});

describe("POST /api/demo", () => {
  it("[AC-ST-2] answers with the scripted fallback when SENDO_DEMO_MODEL is unset", async () => {
    const { status, body, token } = await send(
      { transcript: [], text: "Hello" },
      { ip: freshIp() },
    );
    expect(status).toBe(200);
    expect(body.fallback).toBe("no_model");
    expect(body.turn).toMatchObject({ role: "contact", text: "Hello" });
    expect(body.messages).toEqual([expect.objectContaining({ role: "agent", text: FALLBACK_EN })]);
    expect(FALLBACK_EN).toMatch(/^The demo is taking a short break; see the code at https:\/\//);
    // The demo inbox shows the same conversation, as the team sees it.
    expect(body.inbox.conversation.id).toBe(DEMO_CONVERSATION_ID);
    expect(body.inbox.conversation.contact.appRef).toBe("Apt 3C · Torre Vista");
    expect(body.inbox.thread.map((m) => [m.direction, m.sender, m.text])).toEqual([
      ["in", "contact", "Hello"],
      ["out", "agent", FALLBACK_EN],
    ]);
    expect(token).toMatch(/^1\./);
  });

  it("[AC-ST-9] [1] greets in the page language: scripted reply, names and handoff follow lang", async () => {
    const es = await send({ transcript: [], text: "Hola", lang: "es" }, { ip: freshIp() });
    expect(es.body.messages.map((m) => m.text)).toEqual([FALLBACK_ES]);
    expect(FALLBACK_ES).toMatch(/^El demo descansa un momento; mira el código en https:\/\//);
    expect(es.body.inbox.conversation.contact).toMatchObject({
      displayName: "Tú (visitante)",
      appRef: "Apto 3C · Torre Vista",
    });
    expect(es.body.inbox.names["demo-operator"]).toBe("Tú");

    const en = await send({ transcript: [], text: "Hi", lang: "en" }, { ip: freshIp() });
    expect(en.body.messages.map((m) => m.text)).toEqual([FALLBACK_EN]);
    expect(en.body.inbox.conversation.contact).toMatchObject({
      displayName: "You (visitor)",
      appRef: "Apt 3C · Torre Vista",
    });

    // `?lang=` when the body has none; anything unknown is English.
    const query = await send(
      { transcript: [], text: "Hola" },
      { ip: freshIp(), query: "?lang=es" },
    );
    expect(query.body.messages.map((m) => m.text)).toEqual([FALLBACK_ES]);
    expect(
      (await send({ transcript: [], text: "Hola" }, { ip: freshIp(), query: "?lang=fr" })).body
        .messages[0]?.text,
    ).toBe(FALLBACK_EN);
    expect(
      (await send({ transcript: [], text: "Hola", lang: "fr" as "en" }, { ip: freshIp() })).status,
    ).toBe(400);

    // With a model: the agent is told the page language and to follow the visitor's afterwards,
    // and the handoff message is in the page language.
    const model = scripted(
      toolCall("transferir_a_humano", { motivo: "Pide una persona." }),
      text("unused"),
    );
    const handoff = await send(
      { transcript: [], text: "Quiero hablar con una persona", lang: "es" },
      { ip: freshIp() },
    );
    const system = promptText(model.doGenerateCalls[0]);
    expect(system).toContain("greet them in Spanish");
    expect(system).toContain("reply in whatever language the visitor writes in");
    expect(handoff.body.inbox.thread.at(-1)?.text).toBe(demo.es.agent.handoffMessage);
    await send({ transcript: [], text: "Hi", lang: "en" }, { ip: freshIp() });
    expect(promptText(model.doGenerateCalls.at(-1))).toContain("greet them in English");
  });

  it("[AC-ST-2] runs one agent turn per request and keeps no state between requests", async () => {
    const model = scripted(
      toolCall("consultar_saldo", {}),
      text("Tu saldo es Q 1,250.00 y vence el 15 de octubre."),
      text("¡Con gusto! ¿Algo más?"),
    );
    const ip = freshIp();
    const first = await send({ transcript: [], text: "¿Cuánto debo?" }, { ip });
    expect(first.status).toBe(200);
    expect(first.body.fallback).toBeNull();
    expect(first.body.remaining).toBe(DEMO_SESSION_LIMIT - 1);
    expect(first.body.messages.map((m) => [m.role, m.text])).toEqual([
      ["agent", "Tu saldo es Q 1,250.00 y vence el 15 de octubre."],
    ]);
    // The tool read the app's own data for the linked apartment; every call is capped at 300 tokens.
    expect(promptText(model.doGenerateCalls[1])).toContain("Q 1,250.00");
    expect(model.doGenerateCalls.map((call) => call.maxOutputTokens)).toEqual([300, 300]);
    // Admins see the cost of the turn in the inbox.
    expect(first.body.inbox.thread.at(-1)?.costCents).toBeGreaterThan(0);

    // The second request carries the whole conversation; the server rebuilds it from scratch.
    const transcript: DemoTurn[] = [first.body.turn, ...first.body.messages];
    const second = await send({ transcript, text: "Gracias" }, { ip, token: first.token });
    expect(second.body.messages.map((m) => m.text)).toEqual(["¡Con gusto! ¿Algo más?"]);
    expect(second.body.remaining).toBe(DEMO_SESSION_LIMIT - 2);
    const history = promptText(model.doGenerateCalls[2]);
    expect(history).toContain("¿Cuánto debo?");
    expect(history).toContain("Tu saldo es Q 1,250.00");
    // Same ids for the same messages, so the inbox doesn't re-render the whole thread.
    expect(second.body.inbox.thread.slice(0, 2).map((m) => m.id)).toEqual(
      first.body.inbox.thread.map((m) => m.id),
    );
    expect(second.body.inbox.thread.map((m) => m.text)).toEqual([
      "¿Cuánto debo?",
      "Tu saldo es Q 1,250.00 y vence el 15 de octubre.",
      "Gracias",
      "¡Con gusto! ¿Algo más?",
    ]);
  });

  it("[AC-ST-2] replays a handoff: the agent stays silent and a person can step in from the inbox", async () => {
    const model = scripted(
      toolCall("transferir_a_humano", { motivo: "Pide hablar con administración." }),
      text("Esto ya no se envía: la conversación es de personas."),
    );
    const ip = freshIp();
    const first = await send({ transcript: [], text: "Quiero hablar con una persona" }, { ip });
    expect(first.body.messages).toEqual([
      expect.objectContaining({ role: "handoff", text: "Pide hablar con administración." }),
    ]);
    expect(first.body.inbox.conversation.status).toBe("human");
    expect(first.body.inbox.conversation.handoff?.reason).toBe("Pide hablar con administración.");
    expect(first.body.inbox.thread.at(-1)).toMatchObject({ text: demo.en.agent.handoffMessage });

    let transcript: DemoTurn[] = [first.body.turn, ...first.body.messages];
    const calls = model.doGenerateCalls.length;
    const waiting = await send({ transcript, text: "¿Hola?" }, { ip, token: first.token });
    expect(waiting.body.messages).toEqual([]);
    expect(waiting.body.inbox.conversation.status).toBe("human");
    // The replayed handoff is the same as the original one (stable ids, one handoff message).
    const shape = (m: DemoResponse["inbox"]["thread"][number]) => [
      m.id,
      m.sender,
      m.internal,
      m.text,
    ];
    expect(waiting.body.inbox.thread.slice(0, -1).map(shape)).toEqual(
      first.body.inbox.thread.map(shape),
    );
    expect(model.doGenerateCalls).toHaveLength(calls);

    transcript = [...transcript, waiting.body.turn];
    const reply = await send(
      { transcript, text: "Hola, soy Ana de administración.", from: "team" },
      { ip, token: waiting.token },
    );
    expect(reply.body.turn).toMatchObject({
      role: "team",
      text: "Hola, soy Ana de administración.",
    });
    expect(reply.body.inbox.thread.at(-1)).toMatchObject({ sender: "human", direction: "out" });
    expect(reply.body.remaining).toBe(waiting.body.remaining);
    expect(model.doGenerateCalls).toHaveLength(calls);
  });

  it(`[AC-ST-2] the ${String(DEMO_SESSION_LIMIT + 1)}st message of a session gets the fallback`, async () => {
    const model = scripted(text("Hola"));
    const ip = freshIp();
    let token: string | null = null;
    for (let i = 0; i < DEMO_SESSION_LIMIT; i++) {
      const sent: Sent = await send(
        { transcript: [], text: `Mensaje ${String(i + 1)}` },
        { ip, token },
      );
      expect(sent.body.fallback).toBeNull();
      token = sent.token;
    }
    expect(model.doGenerateCalls).toHaveLength(DEMO_SESSION_LIMIT);
    const over = await send({ transcript: [], text: "Uno más" }, { ip, token });
    expect(over.status).toBe(200);
    expect(over.body.fallback).toBe("session_limit");
    expect(over.body.messages.map((m) => m.text)).toEqual([FALLBACK_EN]);
    expect(over.body.remaining).toBe(0);
    expect(model.doGenerateCalls).toHaveLength(DEMO_SESSION_LIMIT);

    // A forged counter is ignored (counts as a new session, still bound by the IP limit).
    const forged = await send({ transcript: [], text: "Hola" }, { ip, token: "0.forged" });
    expect(forged.body.fallback).toBeNull();
  });

  it(`[AC-ST-2] an IP gets the fallback after ${String(DEMO_IP_DAILY_LIMIT)} messages a day (in-memory counter)`, async () => {
    const model = scripted(text("Hola"));
    const ip = freshIp();
    for (let i = 0; i < DEMO_IP_DAILY_LIMIT; i++) {
      const sent = await send({ transcript: [], text: "Hola" }, { ip });
      expect(sent.body.fallback).toBeNull();
    }
    const over = await send({ transcript: [], text: "Hola" }, { ip });
    expect(over.body.fallback).toBe("ip_limit");
    expect(over.body.messages.map((m) => m.text)).toEqual([FALLBACK_EN]);
    expect(model.doGenerateCalls).toHaveLength(DEMO_IP_DAILY_LIMIT);
    expect(
      (await send({ transcript: [], text: "Hola" }, { ip: freshIp() })).body.fallback,
    ).toBeNull();
  }, 60_000);

  it("[AC-ST-2] stops calling the model once the monthly budget is spent, and without a budget", async () => {
    vi.stubEnv("SENDO_DEMO_BUDGET_USD", "");
    const model = scripted(text("Hola"));
    expect((await send({ transcript: [], text: "Hola" }, { ip: freshIp() })).body.fallback).toBe(
      "budget",
    );
    expect(model.doGenerateCalls).toHaveLength(0);

    // 1 micro-dollar on a fresh instance (nothing spent yet): the first turn spends more than
    // that, the next one is refused.
    vi.resetModules();
    const { POST: post } = await import("./route");
    vi.stubEnv("SENDO_DEMO_BUDGET_USD", "0.000001");
    expect(
      (await send({ transcript: [], text: "Hola" }, { ip: freshIp(), post })).body.fallback,
    ).toBeNull();
    const over = await send({ transcript: [], text: "Hola" }, { ip: freshIp(), post });
    expect(over.body.fallback).toBe("budget");
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("[AC-ST-2] [2] past SENDO_DEMO_DAILY_CAP every visitor gets the scripted fallback with the limit note", async () => {
    // A fresh instance, so the in-memory daily counter starts at 0.
    vi.resetModules();
    const { POST: post } = await import("./route");
    vi.stubEnv("SENDO_DEMO_DAILY_CAP", "2");
    const model = scripted(text("Hola, ¿en qué te ayudo?"));
    for (let i = 0; i < 2; i++) {
      const sent = await send(
        { transcript: [], text: "Hola", lang: "es" },
        { ip: freshIp(), post },
      );
      expect(sent.body.fallback).toBeNull();
    }
    const over = await send({ transcript: [], text: "Hola", lang: "es" }, { ip: freshIp(), post });
    expect(over.status).toBe(200);
    expect(over.body.fallback).toBe("daily_cap");
    expect(over.body.messages.map((m) => m.text)).toEqual([FALLBACK_ES]);
    expect(demo.es.chat.fallbackNotes.daily_cap).toMatch(/^Límite de la demo alcanzado/);
    expect(demo.en.chat.fallbackNotes.daily_cap).toMatch(/^Demo limit reached/);
    expect(model.doGenerateCalls).toHaveLength(2);

    // Unset means no cap.
    vi.stubEnv("SENDO_DEMO_DAILY_CAP", "");
    expect(
      (await send({ transcript: [], text: "Hola" }, { ip: freshIp(), post })).body.fallback,
    ).toBeNull();
  });

  it("[AC-ST-15] [3] [4] sets no cookie; the session counter round-trips as a signed token", async () => {
    const model = scripted(text("Hola"));
    const ip = freshIp();
    const first = await send({ transcript: [], text: "Uno" }, { ip });
    expect(first.setCookie).toBeNull();
    expect(first.body.remaining).toBe(DEMO_SESSION_LIMIT - 1);

    // The returned token carries the count even when the transcript doesn't (after "start over").
    const second = await send({ transcript: [], text: "Dos" }, { ip, token: first.token });
    expect(second.setCookie).toBeNull();
    expect(second.body.remaining).toBe(DEMO_SESSION_LIMIT - 2);
    expect(second.token).toMatch(/^2\./);

    // Missing or forged: 0.
    expect((await send({ transcript: [], text: "Tres" }, { ip })).body.remaining).toBe(
      DEMO_SESSION_LIMIT - 1,
    );
    const forgedCount = `${String(DEMO_SESSION_LIMIT)}.${second.token?.split(".")[1] ?? ""}`;
    const forged = await send({ transcript: [], text: "Cuatro" }, { ip, token: forgedCount });
    expect(forged.body.remaining).toBe(DEMO_SESSION_LIMIT - 1);
    expect(forged.body.fallback).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(4);

    // Errors set no cookie either.
    const headers = { "content-type": "application/json", host: "sendo.dev" };
    for (const request of [
      new Request("https://sendo.dev/api/demo", { method: "POST", headers, body: "{" }),
      new Request("https://sendo.dev/api/demo", {
        method: "POST",
        headers: { ...headers, origin: "https://evil.example" },
        body: JSON.stringify({ transcript: [], text: "Hola" }),
      }),
    ]) {
      const response = await POST(request);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("rejects invalid bodies and other origins", async () => {
    const ip = freshIp();
    expect((await send({ transcript: [], text: "   " }, { ip })).status).toBe(400);
    expect((await send({ transcript: [], text: "x".repeat(501) }, { ip })).status).toBe(400);
    expect((await send({ transcript: [], text: "Hola", from: "team" }, { ip })).status).toBe(400);
    expect(
      (await send({ transcript: [], text: "Hola" }, { ip, origin: "https://evil.example" })).status,
    ).toBe(403);
  });
});
