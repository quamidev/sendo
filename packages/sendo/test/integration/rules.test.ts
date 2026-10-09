/**
 * Product spec 3.5 "Workflows" (SND-3.4). End to end: rules are written through
 * `sendo.rules.*` (or `sendo rules sync`), inbound messages go through `sendo.handleWebhook`
 * (signed payloads, msw for Meta), timed rules run through `sendo.maintenance.tick()`. The clock
 * is faked (`Date` only) so business hours, time zones and DST are deterministic.
 *
 * [AC-WF-1] Five rule types scoped per tenant (and optionally per account), validated by the
 *           package zod schemas; `sendo.rules.*` needs `rules.manage`; invalid stored rules are
 *           listed as invalid and ignored by the engine.
 * [AC-WF-2] `route` rules run in order on a new conversation, first match wins, keywords are
 *           case- and accent-insensitive; they set queue/tags and hand off; no match keeps
 *           today's behaviour. `auto_assign` (least_open, round_robin) on entering `human`.
 * [AC-WF-3] Outside business hours (time zones, DST, holidays): the after-hours message is sent
 *           at most once per closed period and only inside the 24 h window; `appliesTo: "all"`
 *           holds the agent; escalation and auto-assign timers don't run.
 * [AC-WF-4] `tick()` runs escalations, auto-close, after-hours transitions, billing re-checks
 *           and the daily prune; it is lock-guarded (two concurrent ticks: one skips) and
 *           idempotent (a re-run does nothing new).
 * [AC-WF-5] `sendo rules sync --config` inserts missing rules by key (`origin: "code"`) and never
 *           overwrites screen edits without `--force`.
 * [AC-WF-6] Every rule action writes a system line and emits `conversation.status` /
 *           `conversation.assigned` / `rule.applied` with `by: "rule:<key>"`; `notify` emits
 *           `escalation`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scriptedModel, textResult } from "../../src/agents/test-helpers";
import { runCli } from "../../src/cli/main";
import type {
  ConversationAssignedEvent,
  EscalationEvent,
  RuleAppliedEvent,
} from "../../src/team/events";
import type { ConversationStatusEvent } from "../../src/core/events";
import { GRAPH, acceptSends, accountInput, type ClientOptions } from "../../src/core/test-utils";
import { useGraphServer } from "../../src/core/test-utils";
import type { RuleInput } from "../../src/rules";
import type { BusinessHoursParams } from "../../src/rules/schemas";
import type { Conversation } from "../../src/types/entities";
import { FIXTURE_IDS, loadWebhookFixtureText } from "../support/fixtures";
import { createHarness } from "./harness";

const graph = useGraphServer();

const NAMES: Record<string, string> = { ana: "Ana Gómez", beto: "Beto Ruiz" };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Guatemala (UTC-6, no DST): Monday–Friday 08:00–17:00 local = 14:00–23:00 UTC. */
const FRI_OPEN = "2026-10-09T16:00:00Z";
const FRI_LATE = "2026-10-09T22:50:00Z"; // 16:50 local, 10 minutes before closing
const SAT = "2026-10-10T16:00:00Z";
const MON_OPEN = "2026-10-12T16:00:00Z";
const MON_NIGHT = "2026-10-12T23:30:00Z"; // 17:30 local

function hours(overrides: Partial<BusinessHoursParams> = {}): BusinessHoursParams {
  const day: [string, string][] = [["08:00", "17:00"]];
  return {
    timezone: "America/Guatemala",
    schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] },
    outsideMessage: "Estamos fuera de horario; te respondemos el lunes a las 8:00.",
    appliesTo: "human",
    ...overrides,
  };
}

function setNow(iso: string | Date): void {
  vi.setSystemTime(typeof iso === "string" ? new Date(iso) : iso);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

interface Inbound {
  id: string;
  body: string;
  from?: string;
  at?: Date;
}

function inboundBody(p: Inbound): string {
  const json = JSON.parse(loadWebhookFixtureText("text")) as {
    entry: { changes: { value: Record<string, unknown> }[] }[];
  };
  const value = json.entry[0]?.changes[0]?.value as {
    contacts: { wa_id: string }[];
    messages: { id: string; from: string; timestamp: string; text: { body: string } }[];
  };
  const message = value.messages[0];
  const contact = value.contacts[0];
  if (!message || !contact) throw new Error("text fixture changed");
  message.id = p.id;
  message.text.body = p.body;
  message.timestamp = String(Math.floor((p.at ?? new Date()).getTime() / 1000));
  if (p.from !== undefined) {
    message.from = p.from;
    contact.wa_id = p.from;
  }
  return JSON.stringify(json);
}

async function setup(options: ClientOptions = {}) {
  const sent: { to?: string; text?: { body: string } }[] = [];
  graph.server.use(acceptSends(sent));
  const h = await createHarness({
    handoffMessage: null,
    resolveRole: ({ userId }) =>
      Promise.resolve(userId.startsWith("admin") ? { role: "admin" } : { role: "agent" }),
    resolveAssignees: () => Promise.resolve(["ana", "beto"]),
    resolveUsers: (ids) => Promise.resolve(ids.map((id) => ({ id, name: NAMES[id] ?? id }))),
    ...options,
  });
  const admin = await h.sendo.actor("admin-1", "tenant-a");
  const events = {
    applied: [] as RuleAppliedEvent[],
    assigned: [] as ConversationAssignedEvent[],
    status: [] as ConversationStatusEvent[],
    escalation: [] as EscalationEvent[],
  };
  h.sendo.on("rule.applied", (e) => void events.applied.push(e));
  h.sendo.on("conversation.assigned", (e) => void events.assigned.push(e));
  h.sendo.on("conversation.status", (e) => void events.status.push(e));
  h.sendo.on("escalation", (e) => void events.escalation.push(e));

  let seq = 0;
  /** Delivers a signed text webhook; returns the conversation as stored afterwards. */
  async function inbound(body: string, opts: Omit<Inbound, "id" | "body"> = {}) {
    const id = `wamid.RULE${String(++seq)}`;
    await h.deliver(inboundBody({ id, body, ...opts }));
    const message = await h.adapter.messages.getByMetaId(id);
    if (!message) throw new Error("inbound not stored");
    return conversation(message.conversationId);
  }
  async function conversation(id: string): Promise<Conversation> {
    const found = await h.adapter.conversations.get(id);
    if (!found) throw new Error("conversation missing");
    return found;
  }
  function rule(input: RuleInput) {
    return h.sendo.rules.upsert(input, { actor: admin });
  }
  function systemLines(conversationId?: string): string[] {
    return h
      .messages("out")
      .filter(
        (m) =>
          m.internal &&
          m.metadata.kind === "rule" &&
          (conversationId === undefined || m.conversationId === conversationId),
      )
      .map((m) => m.text ?? "");
  }
  function sentTexts(): string[] {
    return sent.map((s) => s.text?.body ?? "");
  }
  return { ...h, admin, events, sent, inbound, conversation, rule, systemLines, sentTexts };
}

describe("rules: routing and assignment", () => {
  it("[AC-WF-2][AC-WF-6] route rules run in order, first match wins, keywords ignore case and accents", async () => {
    setNow(FRI_OPEN);
    const h = await setup();
    const cobro = await h.rule({
      key: "cobros",
      type: "route",
      params: {
        match: { keywords: ["cobro", "pago pendiente"] },
        action: { queue: "cobranza", tags: ["Cobranza"], to: "human", reason: "Tema de cobro" },
      },
    });
    const citas = await h.rule({
      key: "citas",
      type: "route",
      params: { match: { keywords: ["cita"] }, action: { queue: "citas", to: "agent" } },
    });

    // Both match; `cobros` is first. "CÓBRO" matches "cobro".
    const first = await h.inbound("Hola, ¿el CÓBRO de mi cita ya salió?", { from: "50255550101" });
    expect(first).toMatchObject({
      status: "human",
      queue: "cobranza",
      handoffReason: "Tema de cobro",
    });
    const tags = await h.adapter.tags.forConversations([first.id]);
    expect(tags[first.id]?.map((t) => t.name)).toEqual(["Cobranza"]);
    expect(h.events.status).toContainEqual(
      expect.objectContaining({ from: "agent", to: "human", by: "rule:cobros" }),
    );
    expect(h.events.applied).toContainEqual(
      expect.objectContaining({
        action: "route",
        rule: { id: cobro.id, key: "cobros", type: "route" },
      }),
    );
    expect(h.systemLines(first.id)[0]).toBe(
      "Transferida a una persona por regla «cobros» (cola «cobranza»; etiquetas «Cobranza»)",
    );
    const line = h.messages("out").find((m) => m.internal && m.conversationId === first.id);
    expect(line).toMatchObject({
      sender: "system",
      status: "sent",
      metaMessageId: null,
      metadata: { kind: "rule", by: "rule:cobros", ruleKey: "cobros" },
    });
    // System lines never reach Meta.
    expect(h.sentTexts().some((t) => t.includes("regla"))).toBe(false);

    await h.sendo.rules.reorder([citas.id, cobro.id], { actor: h.admin });
    const second = await h.inbound("Hola, ¿el cobro de mi cita ya salió?", { from: "50255550102" });
    expect(second).toMatchObject({ status: "agent", queue: "citas" });

    // A keyword inside another word does not match; no match keeps today's behaviour.
    const none = await h.inbound("Necesito un recibo de mis citatorios", { from: "50255550103" });
    expect(none).toMatchObject({ status: "agent", queue: null, assignedTo: null });
    expect(h.systemLines(none.id)).toEqual([]);

    // Only the first message of a conversation is routed.
    const later = await h.inbound("ahora sí, un cobro", { from: "50255550103" });
    expect(later).toMatchObject({ id: none.id, status: "agent", queue: null });
  });

  it("[AC-WF-2][AC-WF-6] auto_assign round_robin and least_open on entering human", async () => {
    setNow(FRI_OPEN);
    const h = await setup();
    await h.rule({
      key: "a-caja",
      type: "route",
      params: { match: { keywords: ["persona"] }, action: { queue: "caja", to: "human" } },
    });
    const turno = await h.rule({
      key: "turno-caja",
      type: "auto_assign",
      params: { queue: "caja", strategy: "round_robin" },
    });

    const picks: (string | null)[] = [];
    for (const from of ["50255550201", "50255550202", "50255550203"]) {
      picks.push((await h.inbound("Quiero hablar con una persona", { from })).assignedTo);
    }
    expect(picks).toEqual(["ana", "beto", "ana"]);
    expect(h.events.assigned.map((e) => [e.from, e.to, e.by])).toEqual([
      [null, "ana", "rule:turno-caja"],
      [null, "beto", "rule:turno-caja"],
      [null, "ana", "rule:turno-caja"],
    ]);
    expect(h.systemLines()).toContain("Asignada a Beto Ruiz por regla «turno-caja»");
    expect(h.events.applied.filter((e) => e.action === "assign")).toHaveLength(3);

    // least_open: Ana already has two open human conversations, Beto one.
    await h.rule({
      key: "turno-caja",
      type: "auto_assign",
      params: { queue: "caja", strategy: "least_open" },
    });
    expect((await h.adapter.rules.get(turno.id))?.params).toEqual({
      queue: "caja",
      strategy: "least_open",
    });
    const next: (string | null)[] = [];
    for (const from of ["50255550204", "50255550205"]) {
      next.push((await h.inbound("una persona por favor", { from })).assignedTo);
    }
    expect(next).toEqual(["beto", "ana"]);
  });

  it("[AC-WF-3] auto-assign does not run outside business hours", async () => {
    setNow(SAT);
    const h = await setup();
    await h.rule({ key: "horario", type: "business_hours", params: hours() });
    await h.rule({
      key: "a-humano",
      type: "route",
      params: { match: { keywords: ["persona"] }, action: { to: "human" } },
    });
    await h.rule({ key: "turno", type: "auto_assign", params: { strategy: "round_robin" } });

    const conversation = await h.inbound("Una persona, por favor");
    expect(conversation).toMatchObject({ status: "human", assignedTo: null });
    expect(h.events.assigned).toEqual([]);
  });
});

describe("rules: business hours", () => {
  it("[AC-WF-3][AC-WF-6] sends the after-hours message once per closed period (appliesTo human)", async () => {
    setNow(SAT);
    const h = await setup();
    const message = hours().outsideMessage;
    await h.rule({ key: "horario", type: "business_hours", params: hours() });
    await h.rule({
      key: "a-humano",
      type: "route",
      params: { match: { keywords: ["persona"] }, action: { to: "human" } },
    });

    const human = await h.inbound("Necesito hablar con una persona", { from: "50255550301" });
    expect(human.status).toBe("human");
    expect(h.sentTexts()).toEqual([message]);
    expect(human.afterHoursNotifiedAt).toEqual(new Date(SAT));
    expect(h.systemLines(human.id)).toContain(
      "Mensaje fuera de horario enviado por regla «horario»",
    );
    const stored = h.messages("out").find((m) => m.text === message);
    expect(stored).toMatchObject({ sender: "system", senderRef: "rule:horario", internal: false });

    // An `agent` conversation is not told (appliesTo human): the AI keeps answering.
    const agentOne = await h.inbound("Hola", { from: "50255550302" });
    expect(agentOne.status).toBe("agent");
    expect(h.sentTexts()).toHaveLength(1);

    // Same closed period: no second message.
    setNow(new Date(new Date(SAT).getTime() + 3 * 60 * MINUTE));
    await h.inbound("¿Hola?", { from: "50255550301" });
    expect(h.sentTexts()).toHaveLength(1);

    // Open on Monday: nothing.
    setNow(MON_OPEN);
    await h.inbound("Buenos días", { from: "50255550301" });
    expect(h.sentTexts()).toHaveLength(1);

    // Monday night is a new closed period.
    setNow(MON_NIGHT);
    await h.inbound("¿Siguen ahí?", { from: "50255550301" });
    expect(h.sentTexts()).toEqual([message, message]);
    expect(h.events.applied.filter((e) => e.action === "after_hours_message")).toHaveLength(2);
  });

  it("[AC-WF-3][AC-WF-4] appliesTo all holds the agent; the first tick after opening hands it back", async () => {
    setNow(MON_NIGHT);
    const h = await setup();
    const model = scriptedModel(textResult("¡Buenos días! Ya estamos aquí."));
    h.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });
    await h.rule({ key: "horario", type: "business_hours", params: hours({ appliesTo: "all" }) });

    const conversation = await h.inbound("Hola, ¿atienden hoy?");
    expect(conversation.status).toBe("agent");
    expect(h.sentTexts()).toEqual([hours().outsideMessage]);
    expect(model.doGenerateCalls).toHaveLength(0);

    // Still closed: the tick does not wake the agent.
    setNow("2026-10-13T12:00:00Z"); // Tuesday 06:00 local
    expect((await h.sendo.maintenance.tick()).steps.afterHours.count).toBe(0);

    setNow("2026-10-13T14:01:00Z"); // Tuesday 08:01 local, inside the 24 h window
    const report = await h.sendo.maintenance.tick();
    expect(report.steps.afterHours).toEqual({ ran: true, count: 1, errors: 0 });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.sentTexts()).toEqual([hours().outsideMessage, "¡Buenos días! Ya estamos aquí."]);

    // Idempotent: the same opening is handled once.
    expect((await h.sendo.maintenance.tick()).steps.afterHours.count).toBe(0);
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("[AC-WF-3] evaluates hours in the rule's time zone across a DST change", async () => {
    // America/New_York moves to UTC-4 on Sunday 2026-03-08. 13:30 UTC is 08:30 EST on Friday
    // (closed) and 09:30 EDT on Monday (open).
    setNow("2026-03-06T13:30:00Z");
    const h = await setup();
    const model = scriptedModel(textResult("Hola, ¿en qué te ayudo?"));
    h.sendo.agent({ name: "recepcion", model, instructions: "Eres la recepcionista." });
    const day: [string, string][] = [["09:00", "17:00"]];
    await h.rule({
      key: "horario-ny",
      type: "business_hours",
      params: hours({
        timezone: "America/New_York",
        schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] },
        appliesTo: "all",
      }),
    });

    await h.inbound("Hola", { from: "50255550401" });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(h.sentTexts()).toEqual([hours().outsideMessage]);

    setNow("2026-03-09T13:30:00Z");
    await h.inbound("Hola", { from: "50255550402" });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(h.sentTexts()).toEqual([hours().outsideMessage, "Hola, ¿en qué te ayudo?"]);
  });

  it("[AC-WF-3] a holiday counts as closed all day", async () => {
    setNow("2026-10-20T16:00:00Z"); // Tuesday 10:00 local
    const h = await setup();
    await h.rule({
      key: "horario",
      type: "business_hours",
      params: hours({ appliesTo: "all", holidays: ["2026-10-20"] }),
    });
    await h.inbound("Hola");
    expect(h.sentTexts()).toEqual([hours().outsideMessage]);

    setNow("2026-10-21T16:00:00Z");
    await h.inbound("Hola", { from: "50255550501" });
    expect(h.sentTexts()).toHaveLength(1);
  });

  it("[AC-WF-3] does not send the after-hours message when the 24 h window is closed", async () => {
    setNow(SAT);
    const h = await setup();
    await h.rule({ key: "horario", type: "business_hours", params: hours({ appliesTo: "all" }) });

    // A delayed delivery of a message written 25 hours ago.
    const conversation = await h.inbound("Hola", { at: new Date(Date.now() - 25 * 60 * MINUTE) });
    expect(h.sent).toEqual([]);
    expect(conversation.afterHoursNotifiedAt).toBeNull();
    expect(h.logs.of("info").some((l) => l.includes("window is closed"))).toBe(true);
  });
});

describe("rules: tick", () => {
  async function waitingHuman(h: Awaited<ReturnType<typeof setup>>, from: string) {
    return h.inbound("Quiero hablar con una persona", { from });
  }

  it("[AC-WF-4][AC-WF-6] escalate reassign: waits afterMinutes, reassigns once, then stays quiet", async () => {
    setNow(MON_OPEN);
    const h = await setup();
    await h.rule({ key: "horario", type: "business_hours", params: hours() });
    await h.rule({
      key: "a-humano",
      type: "route",
      params: { match: { keywords: ["persona"] }, action: { to: "human" } },
    });
    await h.rule({ key: "turno", type: "auto_assign", params: { strategy: "round_robin" } });
    const rule = await h.rule({
      key: "sin-respuesta",
      type: "escalate",
      params: { afterMinutes: 30, action: "reassign" },
    });
    const conversation = await waitingHuman(h, "50255550601");
    expect(conversation.assignedTo).toBe("ana");

    setNow(new Date(new Date(MON_OPEN).getTime() + 20 * MINUTE));
    expect((await h.sendo.maintenance.tick()).steps.escalations.count).toBe(0);

    setNow(new Date(new Date(MON_OPEN).getTime() + 31 * MINUTE));
    const report = await h.sendo.maintenance.tick();
    expect(report.steps.escalations).toEqual({ ran: true, count: 1, errors: 0 });
    expect(report.escalations).toEqual({ reassigned: 1, notified: 0, returnedToAgent: 0 });
    expect(await h.conversation(conversation.id)).toMatchObject({
      assignedTo: "beto",
      escalatedAt: new Date(Date.now()),
    });
    expect(h.events.assigned.at(-1)).toMatchObject({
      from: "ana",
      to: "beto",
      by: "rule:sin-respuesta",
    });
    expect(h.systemLines(conversation.id)).toContain(
      "Reasignada a Beto Ruiz por regla «sin-respuesta» (31 min sin respuesta)",
    );
    expect(h.events.applied.at(-1)).toMatchObject({
      action: "escalate:reassign",
      rule: { id: rule.id, key: "sin-respuesta", type: "escalate" },
    });

    setNow(new Date(new Date(MON_OPEN).getTime() + 90 * MINUTE));
    expect((await h.sendo.maintenance.tick()).steps.escalations.count).toBe(0);
  });

  it("[AC-WF-3][AC-WF-4] escalate notify only counts minutes inside business hours", async () => {
    setNow(FRI_LATE);
    const h = await setup();
    await h.rule({ key: "horario", type: "business_hours", params: hours() });
    await h.rule({
      key: "a-humano",
      type: "route",
      params: { match: { keywords: ["persona"] }, action: { to: "human" } },
    });
    await h.rule({
      key: "aviso",
      type: "escalate",
      params: { afterMinutes: 30, action: "notify" },
    });
    const conversation = await waitingHuman(h, "50255550701");

    setNow(SAT); // closed: the timer is stopped
    expect((await h.sendo.maintenance.tick()).steps.escalations.count).toBe(0);
    setNow("2026-10-12T14:15:00Z"); // Monday 08:15: 10 + 15 open minutes
    expect((await h.sendo.maintenance.tick()).steps.escalations.count).toBe(0);
    setNow("2026-10-12T14:25:00Z"); // 10 + 25 = 35
    const report = await h.sendo.maintenance.tick();
    expect(report.escalations.notified).toBe(1);
    expect(h.events.escalation).toEqual([
      expect.objectContaining({
        conversation: expect.objectContaining({ id: conversation.id }) as unknown,
        rule: expect.objectContaining({ key: "aviso", type: "escalate" }) as unknown,
        minutesWaiting: 35,
      }),
    ]);
    expect(h.systemLines(conversation.id)).toContain(
      "Escalada por regla «aviso» (35 min sin respuesta)",
    );
  });

  it("[AC-WF-4][AC-WF-6] escalate return_to_agent and auto_close", async () => {
    setNow(MON_OPEN);
    const h = await setup();
    await h.rule({
      key: "a-humano",
      type: "route",
      params: { match: { keywords: ["persona"] }, action: { to: "human" } },
    });
    await h.rule({
      key: "devolver",
      type: "escalate",
      params: { afterMinutes: 60, action: "return_to_agent" },
    });
    await h.rule({ key: "auto-cierre", type: "auto_close", params: { afterDays: 7 } });
    const waiting = await waitingHuman(h, "50255550801");
    const quiet = await h.inbound("Gracias", { from: "50255550802" });

    setNow(new Date(new Date(MON_OPEN).getTime() + 61 * MINUTE));
    const first = await h.sendo.maintenance.tick();
    expect(first.escalations.returnedToAgent).toBe(1);
    expect(await h.conversation(waiting.id)).toMatchObject({ status: "agent", assignedTo: null });
    expect(h.events.status).toContainEqual(
      expect.objectContaining({ from: "human", to: "agent", by: "rule:devolver" }),
    );
    expect(first.steps.autoClose.count).toBe(0);

    setNow(new Date(new Date(MON_OPEN).getTime() + 8 * DAY));
    const later = await h.sendo.maintenance.tick();
    expect(later.steps.autoClose).toEqual({ ran: true, count: 2, errors: 0 });
    expect((await h.conversation(quiet.id)).status).toBe("closed");
    expect(h.events.status).toContainEqual(
      expect.objectContaining({ to: "closed", by: "rule:auto-cierre" }),
    );
    expect(h.systemLines(quiet.id)).toContain(
      "Cerrada por regla «auto-cierre» tras 7 días sin actividad",
    );
    expect((await h.sendo.maintenance.tick()).steps.autoClose.count).toBe(0);
  });

  it("[AC-WF-4] two concurrent ticks: one runs, one skips, no duplicate actions", async () => {
    setNow(MON_OPEN);
    const h = await setup();
    await h.rule({
      key: "a-humano",
      type: "route",
      params: { match: { keywords: ["persona"] }, action: { to: "human" } },
    });
    await h.rule({ key: "aviso", type: "escalate", params: { afterMinutes: 5, action: "notify" } });
    await waitingHuman(h, "50255550901");
    setNow(new Date(new Date(MON_OPEN).getTime() + 10 * MINUTE));

    const reports = await Promise.all([h.sendo.maintenance.tick(), h.sendo.maintenance.tick()]);
    expect(reports.map((r) => r.skipped).sort()).toEqual([false, true]);
    expect(h.events.escalation).toHaveLength(1);
    expect(h.systemLines().filter((l) => l.startsWith("Escalada"))).toHaveLength(1);

    // The lock is released afterwards; another tick runs and finds nothing new.
    const again = await h.sendo.maintenance.tick();
    expect(again.skipped).toBe(false);
    expect(again.escalations.notified).toBe(0);

    // A tick still holding the lock (e.g. another instance) makes this one skip.
    expect(await h.adapter.locks.acquire("tick", 120_000)).toBe(true);
    expect((await h.sendo.maintenance.tick()).skipped).toBe(true);
  });

  it("[AC-WF-4] re-checks billing hourly and prunes events once a day", async () => {
    setNow(new Date(new Date(MON_OPEN).getTime() - 40 * DAY));
    const h = await setup();
    await h.adapter.events.insert({ payload: { old: true } });
    setNow(MON_OPEN);
    await h.adapter.events.insert({ payload: { fresh: true } });
    const unfunded = await h.adapter.accounts.update(h.account.id, {
      billingReady: false,
      billingCheckedAt: null,
    });
    graph.server.use(
      http.get(`${GRAPH}/:waba`, ({ params }) =>
        HttpResponse.json({ id: params.waba, primary_funding_id: "FUND1" }),
      ),
    );

    const first = await h.sendo.maintenance.tick();
    expect(first.steps.billing).toEqual({ ran: true, count: 1, errors: 0 });
    expect((await h.adapter.accounts.getById(unfunded.id))?.billingReady).toBe(true);
    expect(first.steps.prune).toEqual({ ran: true, count: 1, errors: 0 });

    // Checked less than an hour ago: skipped. Prune already ran today.
    await h.adapter.accounts.update(h.account.id, {
      billingReady: false,
      billingCheckedAt: new Date(Date.now() - 10 * MINUTE),
    });
    const second = await h.sendo.maintenance.tick();
    expect(second.steps.billing.count).toBe(0);
    expect(second.steps.prune.ran).toBe(false);

    setNow(new Date(new Date(MON_OPEN).getTime() + 2 * 60 * MINUTE));
    expect((await h.sendo.maintenance.tick()).steps.billing.count).toBe(1);
  });

  it("[AC-WF-4] stops when the budget is spent and releases the lock", async () => {
    setNow(MON_OPEN);
    const h = await setup();
    const spent = await h.sendo.maintenance.tick({ budgetMs: 0 });
    expect(spent.budgetExhausted).toBe(true);
    expect(Object.values(spent.steps).every((s) => !s.ran)).toBe(true);
    expect((await h.sendo.maintenance.tick()).skipped).toBe(false);
  });
});

describe("rules: API and sync", () => {
  it("[AC-WF-1] rules.* needs rules.manage, validates params and lists invalid stored rules", async () => {
    setNow(MON_OPEN);
    const h = await setup();
    const agent = await h.sendo.actor("agent-1", "tenant-a");
    await expect(h.sendo.rules.list({ actor: agent })).rejects.toMatchObject({
      code: "FORBIDDEN",
      capability: "rules.manage",
    });

    await expect(
      h.rule({
        key: "horario",
        type: "business_hours",
        params: hours({ schedule: { ...hours().schedule, mon: [["17:00", "08:00"]] } }),
      }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD", field: "params.schedule.mon.0" });
    await expect(
      h.rule({ key: "x", type: "auto_close", params: { afterDays: 0 } }),
    ).rejects.toMatchObject({ code: "INVALID_PAYLOAD", field: "params.afterDays" });

    const ok = await h.rule({ key: "cierre", type: "auto_close", params: { afterDays: 3 } });
    expect(ok).toMatchObject({ origin: "screen", updatedBy: "admin-1", active: true });
    const off = await h.sendo.rules.toggle(ok.id, false, { actor: h.admin });
    expect(off).toMatchObject({ active: false, updatedBy: "admin-1" });

    // A row edited by hand into an invalid shape is listed as invalid and ignored by the engine.
    await h.adapter.rules.upsert({
      tenantId: "tenant-a",
      key: "roto",
      type: "route",
      params: { match: {}, action: { to: "robot" } },
    });
    const listed = await h.sendo.rules.list({ actor: h.admin });
    expect(listed.find((r) => r.key === "roto")).toMatchObject({
      valid: false,
      error: expect.stringContaining("action.to") as unknown,
    });
    const conversation = await h.inbound("Hola");
    expect(conversation.status).toBe("agent");
    expect(h.logs.of("warn").some((l) => l.includes('rule "roto"'))).toBe(true);

    // Another tenant's rule is invisible.
    const foreign = await h.adapter.rules.upsert({
      tenantId: "tenant-b",
      key: "cierre",
      type: "auto_close",
      params: { afterDays: 1 },
    });
    await expect(h.sendo.rules.delete(foreign.rule.id, { actor: h.admin })).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
    });
  });

  it("[AC-WF-5] sendo rules sync inserts missing rules and only overwrites with --force", async () => {
    setNow(MON_OPEN);
    const h = await setup();
    // The CLI's --tenant is a UUID (sendo_*.tenant_id is a uuid column).
    const tenant = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    const admin = await h.sendo.actor("admin-1", tenant);
    const account = await h.adapter.accounts.insert(
      accountInput({
        tenantId: tenant,
        phoneNumberId: FIXTURE_IDS.secondPhoneNumberId,
        wabaId: FIXTURE_IDS.secondWabaId,
      }),
    );
    const dir = mkdtempSync(join(tmpdir(), "sendo-rules-"));
    try {
      const write = (afterDays: number) => {
        writeFileSync(
          join(dir, "sendo-rules.ts"),
          [
            "type Rule = { key: string; type: string; account?: string; params: Record<string, unknown> };",
            "export const rules: Rule[] = [",
            `  { key: "auto-cierre", type: "auto_close", params: { afterDays: ${String(afterDays)} } },`,
            `  { key: "ventas", type: "route", account: "${FIXTURE_IDS.secondPhoneNumberId}",`,
            '    params: { match: { keywords: ["precio"] }, action: { queue: "ventas", to: "agent" } } },',
            "];",
          ].join("\n"),
        );
      };
      const cli = async (args: string[]) => {
        const out: string[] = [];
        const err: string[] = [];
        const code = await runCli(["rules", "sync", "--config", "sendo-rules.ts", ...args], {
          env: {},
          cwd: dir,
          stdout: (t) => out.push(t),
          stderr: (t) => err.push(t),
          readFile: () => null,
          createAdapter: () => Promise.resolve(h.adapter),
        });
        return { code, out: out.join(""), err: err.join("") };
      };

      write(7);
      const first = await cli(["--tenant", tenant]);
      expect(first.code).toBe(0);
      expect(first.out).toContain(`auto-cierre (auto_close, tenant ${tenant}): creada`);
      const stored = await h.sendo.rules.list({ actor: admin });
      expect(stored.map((r) => [r.key, r.origin, r.accountId, r.valid])).toEqual([
        ["auto-cierre", "code", null, true],
        ["ventas", "code", account.id, true],
      ]);

      // The admin edits a code rule from the screen; sync keeps the edit.
      await h.sendo.rules.upsert(
        { key: "auto-cierre", type: "auto_close", params: { afterDays: 30 } },
        { actor: admin },
      );
      const kept = await cli(["--tenant", tenant]);
      expect(kept.out).toContain(
        `auto-cierre (auto_close, tenant ${tenant}): ya existía, sin cambios`,
      );
      expect((await h.adapter.rules.list({ tenantId: tenant }))[0]?.params).toEqual({
        afterDays: 30,
      });

      // --force puts the code back (on/off state stays as the screen left it).
      const ventas = stored.find((r) => r.key === "ventas");
      await h.sendo.rules.toggle(ventas?.id ?? "", false, { actor: admin });
      write(14);
      const forced = await cli(["--tenant", tenant, "--force"]);
      expect(forced.code).toBe(0);
      const after = await h.adapter.rules.list({ tenantId: tenant });
      expect(after.map((r) => [r.key, r.params, r.origin, r.active])).toEqual([
        ["auto-cierre", { afterDays: 14 }, "code", true],
        ["ventas", expect.anything(), "code", false],
      ]);

      // Invalid definitions: nothing is written, exit code 1.
      writeFileSync(
        join(dir, "sendo-rules.ts"),
        'export const rules = [{ key: "nuevo", type: "auto_close", params: { afterDays: -1 } }];',
      );
      const bad = await cli(["--tenant", tenant]);
      expect(bad.code).toBe(1);
      expect(bad.err).toContain("nuevo: params.afterDays: Debe ser al menos 1.");
      expect((await h.adapter.rules.list({ tenantId: tenant })).map((r) => r.key)).toEqual([
        "auto-cierre",
        "ventas",
      ]);

      const missing = await runCli(["rules", "sync"], {
        env: {},
        cwd: dir,
        stdout: () => undefined,
        stderr: () => undefined,
        readFile: () => null,
        createAdapter: () => Promise.resolve(h.adapter),
      });
      expect(missing).toBe(2);

      const notUuid = await cli(["--tenant", "tenant-a"]);
      expect(notUuid.code).toBe(1);
      expect(notUuid.err).toContain("El tenant debe ser un UUID: tenant-a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
