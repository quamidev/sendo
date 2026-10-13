/**
 * Metrics adapter surface (AC-MT-1, AC-CO-2): the seeded dataset in `metrics-dataset.ts`
 * through the memory adapter's `metrics.*`, checked against hand-computed values. The same
 * dataset runs against the Supabase views and `METRICS_SQL` in
 * `metrics-parity.supabase.test.ts`, which must match these results.
 *
 * Covered: notes and drafts never count as a first response or as messages, drafts count
 * for cost, history imports never count, days are the account's local days (c2 is Oct 6
 * UTC but Oct 5 in Guatemala), AI resolution (`ever_human` and human messages), close time
 * from the close line or the last activity, tag any-match, account and range filters, and
 * another tenant's rows never leak.
 *
 * `sendo.metrics.*` (SND-4.4), through `createSendo` on the same dataset. Ways it could fail:
 * [MT-API-1] An agent (or a user without a role) reads any metric instead of FORBIDDEN.
 * [MT-API-2] A supervisor sees money: `cost` answers, or `daily` carries cost or tokens.
 * [MT-API-3] The tenant comes from anywhere but the actor (another tenant's number or rows).
 * [MT-API-4] The tag cut or the number filter through the API differs from the adapter's.
 * [MT-API-5] Assignee names don't come from `resolveUsers`, or a failing hook breaks the call.
 * [MT-API-6] `metricsDayRange` days are not the account's local midnights, or bad input passes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { memoryAdapter } from "../../src/adapters/memory";
import type { MetricsAdapterQuery } from "../../src/adapters/types";
import { makeClient } from "../../src/core/test-utils";
import { isSendoError } from "../../src/errors/base";
import { metricsDayRange, type MetricsQuery } from "../../src/metrics";
import type { TeamUser } from "../../src/team/config";
import type { Role } from "../../src/team/permissions";
import {
  type Dataset,
  type MetricsSnapshot,
  gtMidnight,
  memoryStamper,
  metricsQueries,
  seedMetricsDataset,
  snapshot,
} from "./metrics-dataset";

const T = (iso: string) => new Date(iso).toISOString();

describe("metrics adapter surface (memory)", () => {
  let dataset: Dataset;
  let result: MetricsSnapshot;

  beforeAll(async () => {
    const clock = { current: new Date("2026-10-01T00:00:00Z") };
    const adapter = memoryAdapter({ now: () => clock.current });
    dataset = await seedMetricsDataset(adapter, memoryStamper(clock));
    result = await snapshot(adapter.metrics, dataset);
  });

  it("[MT-1] daily volume per account and local day, cost including drafts", () => {
    const zero = { costCents: 0, tokensIn: 0, tokensOut: 0, channel: "whatsapp" };
    expect(result.all?.daily).toEqual([
      {
        day: "2026-10-05",
        accountId: "A",
        channel: "whatsapp",
        inbound: 3,
        outbound: 4,
        conversationsStarted: 2,
        conversationsClosed: 1,
        costCents: 0.8734,
        tokensIn: 400,
        tokensOut: 170,
      },
      {
        ...zero,
        day: "2026-10-06",
        accountId: "A",
        inbound: 1,
        outbound: 2,
        conversationsStarted: 1,
        conversationsClosed: 1,
      },
      {
        ...zero,
        day: "2026-10-06",
        accountId: "B",
        inbound: 1,
        outbound: 1,
        conversationsStarted: 1,
        conversationsClosed: 0,
      },
      {
        day: "2026-10-07",
        accountId: "A",
        channel: "whatsapp",
        inbound: 2,
        outbound: 2,
        conversationsStarted: 2,
        conversationsClosed: 2,
        costCents: 0.3333,
        tokensIn: 50,
        tokensOut: 20,
      },
    ]);
  });

  it("[MT-2] first response skips notes and drafts and uses the first counted inbound", () => {
    const row = (
      id: string,
      account: string,
      source: string | null,
      tagIds: string[],
      day: string,
      firstIn: string,
      response: [string, "agent" | "human", string, number] | null,
    ) => ({
      conversationId: id,
      accountId: account,
      channel: "whatsapp",
      contactId: `${id}:contact`,
      assignedTo: null,
      source,
      tagIds,
      day,
      firstInboundAt: T(firstIn),
      firstResponseAt: response ? T(response[0]) : null,
      responder: response?.[1] ?? null,
      responderRef: response?.[2] ?? null,
      seconds: response?.[3] ?? null,
    });
    expect(result.all?.firstResponse).toEqual([
      row("c1", "A", "garita", ["VIP"], "2026-10-05", "2026-10-05T14:00:00Z", [
        "2026-10-05T14:01:30Z",
        "agent",
        "recepcion",
        90,
      ]),
      row("c2", "A", null, ["Ventas"], "2026-10-05", "2026-10-06T05:30:00Z", [
        "2026-10-06T05:40:00Z",
        "human",
        "ana",
        600,
      ]),
      row("c3", "B", "ad:123", ["VIP", "Ventas"], "2026-10-06", "2026-10-06T10:00:00Z", [
        "2026-10-06T10:02:00Z",
        "human",
        "ana",
        120,
      ]),
      row("c6", "A", null, ["VIP"], "2026-10-06", "2026-10-06T14:00:00Z", [
        "2026-10-06T14:05:00Z",
        "human",
        "ana",
        300,
      ]),
      row("c4", "A", "garita", [], "2026-10-07", "2026-10-07T15:00:00Z", null),
      row("c5", "A", null, [], "2026-10-07", "2026-10-07T16:00:00Z", [
        "2026-10-07T16:03:00Z",
        "agent",
        "ventas-bot",
        180,
      ]),
    ]);
  });

  it("[MT-3] AI resolution: never handed off and no human message, closed at the close line", () => {
    const rows = result.all?.aiResolution as Record<string, unknown>[];
    expect(
      rows.map((r) => [
        r.conversationId,
        r.day,
        r.closedAt,
        r.humanMessages,
        r.agentMessages,
        r.aiResolved,
      ]),
    ).toEqual([
      ["c1", "2026-10-05", T("2026-10-05T23:30:00Z"), 0, 2, true],
      ["c2", "2026-10-06", T("2026-10-06T16:00:00Z"), 2, 0, false],
      ["c4", "2026-10-07", T("2026-10-07T18:00:00Z"), 0, 0, true],
      ["c5", "2026-10-07", T("2026-10-07T20:00:00Z"), 1, 1, false],
    ]);
    expect(rows.find((r) => r.conversationId === "c2")).toMatchObject({ everHuman: true });
  });

  it("[MT-4] per assignee: messages, conversations and an exact median across accounts", () => {
    expect(result.all?.byAssignee).toEqual([
      {
        day: "2026-10-05",
        assignee: "ana",
        conversations: 1,
        messagesSent: 1,
        firstResponses: 1,
        firstResponseSeconds: [600],
        medianFirstResponseSeconds: 600,
      },
      {
        day: "2026-10-06",
        assignee: "ana",
        conversations: 2,
        messagesSent: 2,
        firstResponses: 2,
        firstResponseSeconds: [120, 300],
        medianFirstResponseSeconds: 210,
      },
      {
        day: "2026-10-06",
        assignee: "luis",
        conversations: 1,
        messagesSent: 1,
        firstResponses: 0,
        firstResponseSeconds: [],
        medianFirstResponseSeconds: null,
      },
      {
        day: "2026-10-07",
        assignee: "business_app",
        conversations: 1,
        messagesSent: 1,
        firstResponses: 0,
        firstResponseSeconds: [],
        medianFirstResponseSeconds: null,
      },
    ]);
  });

  it("[MT-5] cost per AI agent and day, and conversations per source", () => {
    expect(result.all?.cost).toEqual([
      {
        day: "2026-10-05",
        agent: "recepcion",
        costCents: 0.8734,
        tokensIn: 400,
        tokensOut: 170,
        turns: 3,
      },
      {
        day: "2026-10-07",
        agent: "ventas-bot",
        costCents: 0.3333,
        tokensIn: 50,
        tokensOut: 20,
        turns: 1,
      },
    ]);
    expect(result.all?.bySource).toEqual([
      { day: "2026-10-05", source: "garita", conversations: 1 },
      { day: "2026-10-05", source: null, conversations: 1 },
      { day: "2026-10-06", source: "ad:123", conversations: 1 },
      { day: "2026-10-06", source: null, conversations: 1 },
      { day: "2026-10-07", source: "garita", conversations: 1 },
      { day: "2026-10-07", source: null, conversations: 1 },
    ]);
  });

  it("[MT-6] tag cut (any match), account filter, local-day range and empty range", () => {
    const ids = (rows: unknown) =>
      (rows as { conversationId: string }[]).map((r) => r.conversationId);
    expect(ids(result.ventas?.firstResponse)).toEqual(["c2", "c3"]);
    expect(ids(result.vipOrVentas?.firstResponse)).toEqual(["c1", "c2", "c3", "c6"]);
    expect(result.ventas?.daily).toMatchObject([
      { day: "2026-10-05", accountId: "A", inbound: 1, outbound: 2, conversationsStarted: 1 },
      { day: "2026-10-06", accountId: "A", inbound: 0, outbound: 1, conversationsClosed: 1 },
      { day: "2026-10-06", accountId: "B", inbound: 1, outbound: 1, conversationsStarted: 1 },
    ]);
    expect(result.ventas?.cost).toEqual([]);
    expect(ids(result.ventas?.aiResolution)).toEqual(["c2"]);

    expect(result.accountB?.daily).toMatchObject([{ day: "2026-10-06", accountId: "B" }]);
    expect(result.accountB?.byAssignee).toMatchObject([
      {
        day: "2026-10-06",
        assignee: "ana",
        firstResponseSeconds: [120],
        medianFirstResponseSeconds: 120,
      },
    ]);

    // Oct 6 in Guatemala: account B's UTC day starts before the range, c2 started on Oct 5.
    expect(result.oct6?.daily).toMatchObject([{ day: "2026-10-06", accountId: "A" }]);
    expect(result.oct6?.daily).toHaveLength(1);
    expect(ids(result.oct6?.firstResponse)).toEqual(["c3", "c6"]);
    expect(ids(result.oct6?.aiResolution)).toEqual(["c2"]);
    expect(result.oct6?.byAssignee).toMatchObject([
      { assignee: "ana", conversations: 1, firstResponseSeconds: [300] },
      { assignee: "luis" },
    ]);

    expect(
      Object.values(result.empty ?? {}).every((rows) => Array.isArray(rows) && rows.length === 0),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("x1");
    expect(JSON.stringify(result)).not.toContain(dataset.ids.T2);
  });
});

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

const METHODS = [
  "daily",
  "byAssignee",
  "firstResponse",
  "aiResolution",
  "bySource",
  "cost",
] as const;

describe("metrics API (sendo.metrics)", () => {
  let dataset: Dataset;
  let client: ReturnType<typeof makeClient>;
  const roles = new Map<string, Role>();
  let users: (ids: string[]) => Promise<TeamUser[]> = () => Promise.resolve([]);
  const requestedIds: string[][] = [];

  beforeAll(async () => {
    const clock = { current: new Date("2026-10-01T00:00:00Z") };
    client = makeClient({
      memory: { now: () => clock.current },
      resolveRole: ({ userId, tenantId }) => {
        const role = roles.get(`${tenantId ?? ""}:${userId}`);
        return Promise.resolve(role === undefined ? null : { role });
      },
      resolveUsers: (ids) => {
        requestedIds.push(ids);
        return users(ids);
      },
    });
    dataset = await seedMetricsDataset(client.adapter, memoryStamper(clock));
    roles.set(`${dataset.tenantId}:alma`, "admin");
    roles.set(`${dataset.tenantId}:sofia`, "supervisor");
    roles.set(`${dataset.tenantId}:ana`, "agent");
    roles.set(`${dataset.ids.T2 ?? ""}:bruno`, "admin");
  });

  const query = (name: string): MetricsAdapterQuery => {
    const q = metricsQueries(dataset)[name];
    if (!q) throw new Error(`no query ${name}`);
    return q;
  };
  const actor = (userId: string, tenantId: string = dataset.tenantId) =>
    client.sendo.actor(userId, tenantId);
  const range = () => ({ from: gtMidnight(5), to: gtMidnight(8) });

  it("[MT-API-1] agents get FORBIDDEN from every metric", async () => {
    const ana = await actor("ana");
    for (const method of METHODS) {
      const error = await errorOf(client.sendo.metrics[method]({ actor: ana, ...range() }));
      expect(isSendoError(error) && error.code, method).toBe("FORBIDDEN");
      expect(error).toMatchObject({ capability: "metrics.view", role: "agent" });
    }
    expect(await errorOf(actor("nobody"))).toMatchObject({ code: "FORBIDDEN" });
  });

  it("[MT-API-2] supervisors see volume without money; admins see cost per day and per agent", async () => {
    const sofia = await actor("sofia");
    const daily = await client.sendo.metrics.daily({ actor: sofia, ...range() });
    expect(daily.length).toBeGreaterThan(0);
    for (const row of daily) {
      expect(row).toMatchObject({ costCents: null, tokensIn: null, tokensOut: null });
    }
    expect(JSON.stringify(daily)).not.toContain("0.8734");
    const error = await errorOf(client.sendo.metrics.cost({ actor: sofia, ...range() }));
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      capability: "costs.view",
      role: "supervisor",
    });

    const alma = await actor("alma");
    const adminDaily = await client.sendo.metrics.daily({ actor: alma, ...range() });
    expect(adminDaily.find((r) => r.day === "2026-10-05")).toMatchObject({
      costCents: 0.8734,
      tokensIn: 400,
    });
    expect(dataset.label(await client.sendo.metrics.cost({ actor: alma, ...range() }))).toEqual(
      dataset.label(await client.adapter.metrics.cost(query("all"))),
    );
  });

  it("[MT-API-3] the tenant is the actor's: no foreign rows, foreign numbers are not found", async () => {
    const bruno = await actor("bruno", dataset.ids.T2);
    const rows = await client.sendo.metrics.firstResponse({ actor: bruno, ...range() });
    expect(rows.map((r) => r.conversationId)).toEqual([dataset.ids.x1]);

    const alma = await actor("alma");
    const foreign = await errorOf(
      client.sendo.metrics.daily({ actor: alma, ...range(), account: dataset.ids.X ?? "" }),
    );
    expect(foreign).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
    const own = await client.sendo.metrics.firstResponse({ actor: alma, ...range() });
    expect(own.map((r) => r.conversationId)).not.toContain(dataset.ids.x1);
  });

  it("[MT-API-4] tag cut and number filter match the adapter (by id or phone number id)", async () => {
    const alma = await actor("alma");
    const viaApi = async (extra: Partial<MetricsQuery>) => {
      const q = { actor: alma, ...range(), ...extra };
      return dataset.label({
        daily: await client.sendo.metrics.daily(q),
        firstResponse: await client.sendo.metrics.firstResponse(q),
        aiResolution: await client.sendo.metrics.aiResolution(q),
        bySource: await client.sendo.metrics.bySource(q),
        cost: await client.sendo.metrics.cost(q),
      });
    };
    const viaAdapter = async (q: MetricsAdapterQuery) =>
      dataset.label({
        daily: await client.adapter.metrics.daily(q),
        firstResponse: await client.adapter.metrics.firstResponse(q),
        aiResolution: await client.adapter.metrics.aiResolution(q),
        bySource: await client.adapter.metrics.bySource(q),
        cost: await client.adapter.metrics.cost(q),
      });

    const ventas = await viaApi({ tagIds: [dataset.ids.Ventas ?? ""] });
    expect(ventas).toEqual(await viaAdapter(query("ventas")));
    expect(ventas.firstResponse.map((r) => r.conversationId)).toEqual(["c2", "c3"]);
    expect(await viaApi({ tagIds: [dataset.ids.VIP ?? "", dataset.ids.Ventas ?? ""] })).toEqual(
      await viaAdapter(query("vipOrVentas")),
    );
    expect(await viaApi({ tagIds: [] })).toEqual(await viaAdapter(query("all")));

    const accountB = await client.adapter.accounts.getById(dataset.ids.B ?? "");
    expect(await viaApi({ account: accountB?.phoneNumberId ?? "" })).toEqual(
      await viaAdapter(query("accountB")),
    );

    const bad = await errorOf(
      client.sendo.metrics.daily({ actor: alma, from: gtMidnight(8), to: gtMidnight(5) }),
    );
    expect(bad).toMatchObject({ code: "INVALID_PAYLOAD", field: "to" });
  });

  it("[MT-API-5] assignee names come from resolveUsers; a failing hook leaves names null", async () => {
    const sofia = await actor("sofia");
    users = (ids) =>
      Promise.resolve(ids.flatMap((id) => (id === "ana" ? [{ id, name: "Ana López" }] : [])));
    requestedIds.length = 0;
    const rows = await client.sendo.metrics.byAssignee({ actor: sofia, ...range() });
    expect(rows.map((r) => [r.day, r.assignee, r.name])).toEqual([
      ["2026-10-05", "ana", "Ana López"],
      ["2026-10-06", "ana", "Ana López"],
      ["2026-10-06", "luis", null],
      ["2026-10-07", "business_app", null],
    ]);
    expect(requestedIds).toEqual([["ana", "luis"]]);
    expect(rows[1]).toMatchObject({
      firstResponseSeconds: [120, 300],
      medianFirstResponseSeconds: 210,
    });

    users = () => Promise.reject(new Error("directory down"));
    const fallback = await client.sendo.metrics.byAssignee({ actor: sofia, ...range() });
    expect(fallback.map((r) => r.name)).toEqual([null, null, null, null]);
    expect(client.logs.of("warn").some((l) => l.includes("resolveUsers failed"))).toBe(true);
  });

  it("[MT-API-6] metricsDayRange gives local midnights with both days included", async () => {
    expect(
      metricsDayRange({ from: "2026-10-05", to: "2026-10-07", timeZone: "America/Guatemala" }),
    ).toEqual({ from: gtMidnight(5), to: gtMidnight(8) });
    // DST: New York leaves daylight time on Nov 1, 2026 (a 25-hour day).
    expect(
      metricsDayRange({ from: "2026-11-01", to: "2026-11-01", timeZone: "America/New_York" }),
    ).toEqual({ from: new Date("2026-11-01T04:00:00Z"), to: new Date("2026-11-02T05:00:00Z") });
    for (const input of [
      { from: "2026-10-07", to: "2026-10-05", timeZone: "UTC" },
      { from: "2026-02-30", to: "2026-03-01", timeZone: "UTC" },
      { from: "2026-10-05", to: "2026-10-07", timeZone: "Mars/Olympus" },
    ]) {
      expect(() => metricsDayRange(input)).toThrow(/Invalid (from|to|timeZone)/);
    }

    const alma = await actor("alma");
    const oct6 = metricsDayRange({
      from: "2026-10-06",
      to: "2026-10-06",
      timeZone: "America/Guatemala",
    });
    const rows = await client.sendo.metrics.firstResponse({ actor: alma, ...oct6 });
    expect(dataset.label(rows).map((r) => r.conversationId)).toEqual(["c3", "c6"]);
  });
});
