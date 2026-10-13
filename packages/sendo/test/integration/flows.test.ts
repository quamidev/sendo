/**
 * Cross-flow E2E scenarios on the memory adapter (SND-6.1). The scenarios live in `flows.ts`;
 * `flows.supabase.test.ts` runs the same ones against local Supabase under `pnpm test:supabase`.
 *
 * Ways the integrated product could fail that no single-feature suite sees (one test each):
 * [FLOW-A]  Quickstart: a manually added number is not the default, `doctor` isn't green, the
 *           agent doesn't answer the first message, or status ticks don't reach "read".
 * [FLOW-B]  Embedded Signup: the first number isn't the default, an unknown billing state is
 *           reported as known, the first 131042 send doesn't resolve it, or re-checking doesn't
 *           clear it; the token lands in a row.
 * [FLOW-DE] Team day: routing, auto-assign, step-in, note, draft approval and pause/resume don't
 *           compose (a stale draft survives a step-in, the note reaches the model, an agent
 *           pauses the AI, or the AI catches up on what arrived during the pause).
 * [FLOW-F]  Rules synced from code don't drive the tick: escalation never fires, fires early, or
 *           fires twice for the same wait.
 * [FLOW-G]  A `links.create` text doesn't attribute the conversation, the agent sees the code, or
 *           metrics/sources don't count it.
 * [FLOW-H]  A broadcast across ticks ignores the rate, keeps sending to a contact who opted out
 *           mid-run, loses delivery statuses, never finishes, or hijacks replies.
 */
import { describe, it } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import { useGraphServer } from "../../src/core/test-utils";
import { flowA, flowB, flowDE, flowF, flowG, flowH, type FlowEnv } from "./flows";

const graph = useGraphServer();
const env: FlowEnv = { kind: "memory", server: graph.server, adapter: () => memoryAdapter() };

describe("cross-flow scenarios (memory adapter)", () => {
  it("[FLOW-A] quickstart: add a number, doctor is green, the agent answers, ticks reach read", () =>
    flowA(env));
  it("[FLOW-B] signup → default → billing unknown → the first failed send resolves it", () =>
    flowB(env));
  it("[FLOW-DE] route rule → auto-assign → step-in → note → draft approval → pause/resume without catch-up", () =>
    flowDE(env));
  it("[FLOW-F] rules sync, then the tick escalates once after afterMinutes", () => flowF(env));
  it("[FLOW-G] link → inbound → source → metrics and sources by source", () => flowG(env));
  it("[FLOW-H] broadcast across ticks with an opt-out mid-run", () => flowH(env));
});
