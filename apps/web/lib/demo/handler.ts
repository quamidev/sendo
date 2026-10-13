import type { InboxMessage } from "@quami/sendo";
import { deliverInbound, teamReply } from "./conversation";
import {
  budgetKey,
  budgetMicroUsd,
  centsToMicroUsd,
  clientIp,
  counterStore,
  dailyCap,
  dailyKey,
  ipKey,
  readSessionToken,
  sessionToken,
  type DemoLimitsEnv,
} from "./limits";
import { demoModel, fallbackModel } from "./model";
import {
  DEMO_CONVERSATION_ID,
  DEMO_IP_DAILY_LIMIT,
  DEMO_OPERATOR_ID,
  DEMO_SESSION_LIMIT,
  DEMO_TOKEN_HEADER,
  type DemoErrorResponse,
  type DemoFallbackReason,
  type DemoResponse,
  type DemoTurn,
} from "./protocol";
import { parseDemoRequest, replayTranscript } from "./replay";
import { inboxSnapshot } from "./snapshot";
import { createDemoWorld } from "./world";

/** The demo's environment variables (`process.env` in the route). */
export interface DemoEnv extends DemoLimitsEnv {
  [name: string]: string | undefined;
  /** Model id for the demo agent (e.g. `openai/gpt-5-mini`). Unset: the scripted fallback answers. */
  SENDO_DEMO_MODEL?: string | undefined;
  /** Monthly model budget in USD. Unset or 0: no model calls (fallback). */
  SENDO_DEMO_BUDGET_USD?: string | undefined;
  /** Model-answered messages per UTC day for all visitors together. Unset: no daily cap. */
  SENDO_DEMO_DAILY_CAP?: string | undefined;
}

const DAY_SECONDS = 24 * 60 * 60;
const MAX_BODY_BYTES = 64 * 1024;

function error(status: 400 | 403 | 405 | 500, body: DemoErrorResponse): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Cross-site callers can't use the demo (a browser on another origin always sends `Origin`). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** What the transcript gained in this request, as turns (the posted message, then what followed). */
function turnsOf(messages: InboxMessage[], handoffReason: string | null): DemoTurn[] {
  const turns: DemoTurn[] = [];
  for (const message of messages) {
    const at = (message.sentAt ?? message.createdAt).toISOString();
    if (message.direction === "in") {
      turns.push({ role: "contact", text: message.text ?? "", at });
    } else if (message.internal && message.systemLine?.event === "handoff") {
      turns.push({ role: "handoff", text: handoffReason ?? "", at });
    } else if (!message.internal && !message.draft && message.sender === "agent") {
      turns.push({ role: "agent", text: message.text ?? "", at });
    } else if (!message.internal && message.sender === "human") {
      turns.push({ role: "team", text: message.text ?? "", at });
    }
  }
  return turns;
}

async function checkLimits(
  request: Request,
  env: DemoEnv,
  sessionCount: number,
  now: Date,
): Promise<DemoFallbackReason | null> {
  if (sessionCount >= DEMO_SESSION_LIMIT) return "session_limit";
  const budget = budgetMicroUsd(env.SENDO_DEMO_BUDGET_USD);
  const store = counterStore(env);
  try {
    if (budget === 0 || (await store.get(budgetKey(now))) >= budget) return "budget";
    const ipCount = await store.incrBy(ipKey(clientIp(request.headers), now), 1, 2 * DAY_SECONDS);
    if (ipCount > DEMO_IP_DAILY_LIMIT) return "ip_limit";
    const cap = dailyCap(env.SENDO_DEMO_DAILY_CAP);
    if (cap !== null && (await store.incrBy(dailyKey(now), 1, 2 * DAY_SECONDS)) > cap) {
      return "daily_cap";
    }
  } catch (cause) {
    // A broken counter store must not turn into unmetered model calls.
    console.error("[sendo demo] limit counters unavailable", cause);
    return "budget";
  }
  return null;
}

/**
 * `POST /api/demo` (AC-ST-2). Stateless: every request builds a fresh Sendo (memory adapter,
 * fake Meta), replays the browser's transcript, delivers the new message through the signed
 * webhook path and runs one agent turn (or, for `from: "team"`, a step-in reply from the inbox),
 * then returns the new turns and the conversation as the inbox shows it. Names, the scripted
 * fallback and the handoff message follow `lang`; the agent greets in it. A limit never fails the
 * request: the scripted fallback answers and `fallback` says why. The session counter travels as
 * a signed token in `DEMO_TOKEN_HEADER` and `DemoResponse.token`; no cookie is set (AC-ST-15).
 */
export async function handleDemoRequest(request: Request, env: DemoEnv): Promise<Response> {
  if (request.method !== "POST") {
    return error(405, { error: "invalid_request", message: "Use POST." });
  }
  if (!sameOrigin(request)) {
    return error(403, { error: "forbidden_origin", message: "The demo only answers sendo.dev." });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return error(400, { error: "invalid_request", message: "Request too large." });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, { error: "invalid_request", message: "Body must be JSON." });
  }
  const now = new Date();
  const input = parseDemoRequest(body, now, request.url);
  if (typeof input === "string") return error(400, { error: "invalid_request", message: input });

  const contactsBefore = input.transcript.filter((turn) => turn.role === "contact").length;
  const tokenCount = readSessionToken(request.headers.get(DEMO_TOKEN_HEADER), env);
  const sessionCount = Math.max(tokenCount, contactsBefore);
  const model = demoModel(env.SENDO_DEMO_MODEL);

  let fallback: DemoFallbackReason | null = null;
  if (input.from === "contact") {
    fallback = model === null ? "no_model" : await checkLimits(request, env, sessionCount, now);
  }

  try {
    const world = await createDemoWorld(input.lang);
    let conversationId = await replayTranscript(world, input.transcript);
    const before = new Set<string>();
    if (conversationId !== null) {
      const page = await world.sendo.inbox.thread(conversationId, {
        actor: world.actor,
        limit: 100,
      });
      for (const message of page.items) before.add(message.id);
    }

    if (input.from === "team" && conversationId !== null) {
      await teamReply(world, conversationId, DEMO_OPERATOR_ID, input.text, null);
    } else {
      world.startAgent(fallback === null && model !== null ? model : fallbackModel(input.lang));
      conversationId = (await deliverInbound(world, world.visitor, input.text, null)).id;
    }
    if (conversationId === null) throw new Error("demo conversation missing");

    const conversation = await world.sendo.inbox.get(conversationId, { actor: world.actor });
    const page = await world.sendo.inbox.thread(conversationId, { actor: world.actor, limit: 100 });
    const added = [...page.items].reverse().filter((message) => !before.has(message.id));
    const [turn, ...messages] = turnsOf(added, conversation.handoffReason);
    if (turn === undefined) throw new Error("the posted message was not stored");

    if (input.from === "contact" && fallback === null) {
      const cents = added.reduce((sum, message) => sum + (message.costCents ?? 0), 0);
      if (cents > 0) {
        await counterStore(env)
          .incrBy(budgetKey(now), centsToMicroUsd(cents), 40 * DAY_SECONDS)
          .catch((cause: unknown) => {
            console.error("[sendo demo] could not record the spend", cause);
          });
      }
    }

    const snapshot = await inboxSnapshot(world, { [DEMO_CONVERSATION_ID]: conversationId });
    const view = snapshot.conversations[0];
    if (view === undefined) throw new Error("demo conversation missing from the inbox");
    const nextCount = input.from === "contact" ? sessionCount + 1 : sessionCount;
    const response: DemoResponse = {
      turn,
      messages,
      fallback,
      remaining: Math.max(0, DEMO_SESSION_LIMIT - nextCount),
      token: sessionToken(nextCount, env),
      inbox: {
        conversation: view,
        thread: snapshot.threads[DEMO_CONVERSATION_ID] ?? [],
        names: snapshot.names,
      },
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[sendo demo] request failed", cause);
    return error(500, { error: "server_error", message: "The demo could not answer. Try again." });
  }
}
