/**
 * The installed sendo-workflows item end to end in fixtures mode: the real rules server actions
 * (`app/(protected)/inbox/rules/actions.ts`), `sendo.actor` with the playground's `resolveRole`,
 * the package rules API and engine on the memory adapter, and the installed tick route
 * (`app/api/sendo/tick/route.ts`) driven like Vercel Cron / pg_cron would.
 *
 * [WF-1] An admin creates one rule of each of the five types; the list comes back in order with
 *        `updatedBy` and the editor's name; a duplicate name, invalid params and a renamed rule
 *        are refused with the right codes (and Spanish field errors).
 * [WF-2] Toggle, reorder and delete go through and the list follows.
 * [WF-3] A stored rule with invalid params is listed as `valid: false` with its problems; the
 *        other rules are unaffected.
 * [WF-4] AC-WF-4: the tick route answers 401 without the bearer (nothing runs), and with it runs
 *        `sendo.maintenance.tick`: an auto-close rule closes a conversation idle for 3 days,
 *        leaves an active one open and writes a rule system line.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as ActionsModule from "@/app/(protected)/inbox/rules/actions";
import type * as TickRouteModule from "@/app/api/sendo/tick/route";
import type { RuleRowView, SaveRuleInput } from "@/components/sendo/workflows/types";
import { DEV_USER_EMAIL, FIXTURES_DEV_USER_ID, PLAYGROUND_TENANT_ID } from "@/lib/playground-env";
import type * as SendoLib from "@/lib/sendo";

const CRON_SECRET = "workflows-test-cron-secret";
const DAY_MS = 24 * 60 * 60 * 1000;

let actions: typeof ActionsModule;
let tickRoute: typeof TickRouteModule;
let lib: typeof SendoLib;

function data<T>(result: { ok: true; data: T } | { ok: false; code: string; message: string }): T {
  if (!result.ok) throw new Error(`action failed: ${result.code} ${result.message}`);
  return result.data;
}

const keys = (rules: RuleRowView[]) => rules.map((rule) => rule.key);

const RULES: SaveRuleInput[] = [
  {
    id: null,
    key: "Horario oficina",
    type: "business_hours",
    account: null,
    params: {
      timezone: "America/Guatemala",
      schedule: {
        mon: [["00:00", "24:00"]],
        tue: [["00:00", "24:00"]],
        wed: [["00:00", "24:00"]],
        thu: [["00:00", "24:00"]],
        fri: [["00:00", "24:00"]],
        sat: [["00:00", "24:00"]],
        sun: [["00:00", "24:00"]],
      },
      holidays: [],
      outsideMessage: "Te respondemos al abrir.",
      appliesTo: "human",
    },
  },
  {
    id: null,
    key: "Cobranza",
    type: "route",
    account: null,
    params: { match: { keywords: ["factura"] }, action: { queue: "cobranza", to: "human" } },
  },
  {
    id: null,
    key: "Turno cobranza",
    type: "auto_assign",
    account: null,
    params: { queue: "cobranza", strategy: "round_robin" },
  },
  {
    id: null,
    key: "Sin respuesta",
    type: "escalate",
    account: null,
    params: { afterMinutes: 30, action: "notify" },
  },
  {
    id: null,
    key: "Cierre automático",
    type: "auto_close",
    account: null,
    params: { afterDays: 1 },
  },
];

function tickRequest(method: "GET" | "POST", authorization?: string): Request {
  return new Request("http://localhost:3000/api/sendo/tick", {
    method,
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeAll(async () => {
  vi.stubEnv("SENDO_PLAYGROUND_MODE", "fixtures");
  vi.stubEnv("SENDO_AGENT_MODEL", "");
  vi.stubEnv("SENDO_CRON_SECRET", CRON_SECRET);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "debug").mockImplementation(() => undefined);
  actions = await import("@/app/(protected)/inbox/rules/actions");
  tickRoute = await import("@/app/api/sendo/tick/route");
  lib = await import("@/lib/sendo");
  await lib.playground.ready;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendo-workflows in the playground", () => {
  it("[WF-1] creates the five rule types and refuses duplicates, invalid params and renames", async () => {
    let rules: RuleRowView[] = data(await actions.listRules());
    expect(rules).toEqual([]);
    for (const input of RULES) rules = data(await actions.saveRule(input));

    expect(keys(rules)).toEqual(RULES.map((rule) => rule.key));
    expect(rules.map((rule) => rule.type)).toEqual([
      "business_hours",
      "route",
      "auto_assign",
      "escalate",
      "auto_close",
    ]);
    for (const rule of rules) {
      expect(rule).toMatchObject({
        valid: true,
        active: true,
        origin: "screen",
        updatedBy: FIXTURES_DEV_USER_ID,
        updatedByName: DEV_USER_EMAIL,
      });
    }

    const duplicate = await actions.saveRule({ ...RULES[4]!, params: { afterDays: 5 } });
    expect(duplicate).toMatchObject({ ok: false, code: "DUPLICATE" });

    const invalid = await actions.saveRule({
      id: null,
      key: "Escalar",
      type: "escalate",
      account: null,
      params: { afterMinutes: 0, action: "page" },
    });
    expect(invalid).toMatchObject({
      ok: false,
      code: "INVALID",
      fieldErrors: { afterMinutes: "Mínimo 1.", action: "Elige una opción." },
    });

    const closeRule = rules.find((rule) => rule.type === "auto_close")!;
    const renamed = await actions.saveRule({ ...RULES[4]!, id: closeRule.id, key: "Otro nombre" });
    expect(renamed).toMatchObject({ ok: false, code: "INVALID" });

    const edited = data(
      await actions.saveRule({ ...RULES[4]!, id: closeRule.id, params: { afterDays: 2 } }),
    );
    expect(edited.find((rule) => rule.id === closeRule.id)?.params).toEqual({ afterDays: 2 });
    expect(keys(data(await actions.listRules()))).toEqual(RULES.map((rule) => rule.key));
  });

  it("[WF-2] toggles, reorders and deletes", async () => {
    const before = data(await actions.listRules());
    const escalate = before.find((rule) => rule.type === "escalate")!;

    const toggled = data(await actions.toggleRule(escalate.id, false));
    expect(toggled.find((rule) => rule.id === escalate.id)?.active).toBe(false);

    const reversed = [...before].reverse().map((rule) => rule.id);
    const reordered = data(await actions.reorderRules(reversed));
    expect(reordered.map((rule) => rule.id)).toEqual(reversed);

    const deleted = data(await actions.deleteRule(escalate.id));
    expect(deleted.map((rule) => rule.id)).not.toContain(escalate.id);
    expect(await actions.deleteRule(escalate.id)).toMatchObject({ ok: false, code: "NOT_FOUND" });

    // Back to the creation order (minus the deleted rule) for the next tests.
    data(
      await actions.reorderRules(
        before.filter((rule) => rule.id !== escalate.id).map((rule) => rule.id),
      ),
    );
  });

  it("[WF-3] lists an invalid stored rule as an error, without hiding the others", async () => {
    const memory = lib.playground.memory!;
    await memory.rules.upsert({
      tenantId: PLAYGROUND_TENANT_ID,
      key: "Horario roto",
      type: "business_hours",
      params: {
        timezone: "Mars/Olympus",
        schedule: { mon: [["9", "18"]] },
        appliesTo: "sometimes",
      },
      origin: "code",
    });
    const rules = data(await actions.listRules());
    const broken = rules.find((rule) => rule.key === "Horario roto");
    expect(broken).toMatchObject({ valid: false, origin: "code" });
    expect(broken?.error).toContain("Zona horaria IANA desconocida.");
    expect(rules.filter((rule) => rule.valid)).toHaveLength(4);
  });

  it("[WF-4] the tick route needs the bearer and runs the rules engine", async () => {
    const memory = lib.playground.memory!;
    const open = await memory.conversations.list({
      tenantId: PLAYGROUND_TENANT_ID,
      status: ["agent", "human"],
      limit: 50,
    });
    const [idle, active] = open.items;
    if (idle === undefined || active === undefined)
      throw new Error("fixtures need two open conversations");
    const now = Date.now();
    await memory.conversations.update(idle.id, { lastActivityAt: new Date(now - 3 * DAY_MS) });
    await memory.conversations.update(active.id, { lastActivityAt: new Date(now - 60_000) });

    for (const response of [
      await tickRoute.GET(tickRequest("GET")),
      await tickRoute.POST(tickRequest("POST", "Bearer not-the-secret")),
    ]) {
      expect(response.status).toBe(401);
    }
    expect((await memory.conversations.get(idle.id))?.status).toBe(idle.status);

    const response = await tickRoute.POST(tickRequest("POST", `Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      skipped: boolean;
      steps: { autoClose: { ran: boolean; count: number; errors: number } };
    };
    expect(report.skipped).toBe(false);
    expect(report.steps.autoClose).toMatchObject({ ran: true, errors: 0 });
    expect(report.steps.autoClose.count).toBeGreaterThanOrEqual(1);

    expect((await memory.conversations.get(idle.id))?.status).toBe("closed");
    expect((await memory.conversations.get(active.id))?.status).toBe(active.status);
    const lines = await memory.messages.history(idle.id, 50);
    expect(
      lines.some(
        (message) =>
          message.internal &&
          message.metadata.kind === "rule" &&
          message.metadata.ruleKey === "Cierre automático",
      ),
    ).toBe(true);
  });
});
