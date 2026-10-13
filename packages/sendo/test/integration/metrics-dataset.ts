/**
 * Seeded dataset shared by `metrics.test.ts` (memory) and `metrics-parity.supabase.test.ts`
 * (memory vs the Supabase views vs `METRICS_SQL`). Every timestamp is fixed through a
 * `Stamper`: the memory adapter reads a movable clock, the Supabase seeder rewrites
 * `created_at` after each insert.
 *
 * Tenant T, account A (America/Guatemala, UTC-6) and account B (UTC), tags VIP and Ventas.
 * - c1 (A, `garita`, VIP): inbound 14:00Z Oct 5, a note and a draft (excluded), agent reply
 *   after 90 s, a second exchange, closed by a close line at 23:30Z. AI-resolved.
 * - c2 (A, no source, Ventas): inbound 05:30Z Oct 6 (local Oct 5), handoff (system line and
 *   a non-internal handoff message), ana replies after 600 s, luis on Oct 6, closed Oct 6.
 * - c3 (B, `ad:123`, VIP+Ventas): inbound 10:00Z Oct 6, an imported inbound (excluded), ana
 *   after 120 s. Open.
 * - c6 (A, no source, VIP): inbound 14:00Z Oct 6, ana after 300 s. Open.
 * - c4 (A, `garita`): inbound Oct 7, never answered, closed without a close line (closed at
 *   its last activity, 18:00Z). AI-resolved (no human message, never handed off).
 * - c5 (A, no source): inbound 16:00Z Oct 7, agent `ventas-bot` after 180 s, a phone reply
 *   (`business_app`), closed 20:00Z. Not AI-resolved.
 * - Tenant T2: one exchange on Oct 6 that no query of tenant T may return.
 */
import type { MetricsAdapterQuery, SendoAdapter } from "../../src/adapters/types";
import type { Account, Conversation, JsonObject } from "../../src/types/entities";
import type { OutboundSender } from "../../src/types/enums";

export interface Stamper {
  /** Moves the clock (memory) or remembers the time to stamp (Supabase). */
  at(date: Date): void;
  message(id: string, at: Date): Promise<void>;
  conversation(id: string, at: Date): Promise<void>;
}

/** Memory: the adapter's `now` reads `clock.current`. */
export function memoryStamper(clock: { current: Date }): Stamper {
  return {
    at(date) {
      clock.current = date;
    },
    message: async () => {},
    conversation: async () => {},
  };
}

export type Label = "T" | "T2" | "A" | "B" | "VIP" | "Ventas" | `c${number}`;

export interface Dataset {
  tenantId: string;
  ids: Record<string, string>;
  /** Replaces every seeded id in `value` with its label (to compare adapters). */
  label<T>(value: T): T;
}

const z = (iso: string): Date => new Date(iso);
let phoneSeq = 0;
const phone = (): string =>
  `+5025${String(Date.now() % 1e4).padStart(4, "0")}${String(++phoneSeq % 1000).padStart(3, "0")}`;

export async function seedMetricsDataset(adapter: SendoAdapter, stamp: Stamper): Promise<Dataset> {
  const ids: Record<string, string> = {};
  const tenantId = crypto.randomUUID();
  const otherTenant = crypto.randomUUID();
  ids.T = tenantId;
  ids.T2 = otherTenant;

  const account = async (label: string, tenant: string, timezone: string) => {
    const a = await adapter.accounts.insert({
      tenantId: tenant,
      phoneNumberId: `pn${crypto.randomUUID()}`,
      wabaId: "waba-metrics",
      displayPhone: "+502 5555 0000",
      tokenRef: "SENDO_TEST_TOKEN",
      timezone,
    });
    ids[label] = a.id;
    return a;
  };

  const open = async (label: string, a: Account, at: Date, source: string | null = null) => {
    stamp.at(at);
    const { contact } = await adapter.contacts.upsert({
      accountId: a.id,
      tenantId: a.tenantId,
      phone: phone(),
    });
    const { conversation } = await adapter.conversations.getOpenOrCreate({
      contactId: contact.id,
      accountId: a.id,
      tenantId: a.tenantId,
    });
    await stamp.conversation(conversation.id, at);
    ids[label] = conversation.id;
    ids[`${label}:contact`] = contact.id;
    if (source !== null) await adapter.conversations.update(conversation.id, { source });
    return conversation;
  };

  const inbound = async (c: Conversation, at: Date, metadata: JsonObject = {}) => {
    stamp.at(at);
    const m = await adapter.messages.insertInbound({
      tenantId: c.tenantId,
      conversationId: c.id,
      type: "text",
      content: { body: "Hola" },
      text: "Hola",
      metaMessageId: `wamid.metrics.${crypto.randomUUID()}`,
      sentAt: at,
      metadata,
    });
    if (!m) throw new Error("inbound not stored");
    await stamp.message(m.id, at);
  };

  const outbound = async (
    c: Conversation,
    at: Date,
    sender: OutboundSender,
    senderRef: string | null,
    extra: {
      internal?: boolean;
      draft?: boolean;
      costCents?: number;
      tokensIn?: number;
      tokensOut?: number;
      metadata?: JsonObject;
    } = {},
  ) => {
    stamp.at(at);
    const m = await adapter.messages.insertOutbound({
      tenantId: c.tenantId,
      conversationId: c.id,
      type: "text",
      content: { body: "Respuesta" },
      text: "Respuesta",
      sender,
      senderRef,
      ...(extra.internal ? { status: "sent" as const } : {}),
      ...extra,
    });
    await stamp.message(m.id, at);
  };

  const closeLine = (c: Conversation, at: Date) =>
    outbound(c, at, "system", null, {
      internal: true,
      metadata: { kind: "system", event: "closed", by: "system" },
    });

  const tag = async (label: "VIP" | "Ventas") => {
    const t = await adapter.tags.upsert({ tenantId, name: label, color: "blue" });
    ids[label] = t.id;
    return t;
  };

  const A = await account("A", tenantId, "America/Guatemala");
  const B = await account("B", tenantId, "UTC");
  const X = await account("X", otherTenant, "America/Guatemala");
  const vip = await tag("VIP");
  const ventas = await tag("Ventas");

  // c1: AI conversation with a note and a draft that must not count as the first response.
  const c1 = await open("c1", A, z("2026-10-05T14:00:00Z"), "garita");
  await inbound(c1, z("2026-10-05T14:00:00Z"));
  await outbound(c1, z("2026-10-05T14:00:30Z"), "human", "ana", { internal: true });
  await outbound(c1, z("2026-10-05T14:00:40Z"), "agent", "recepcion", {
    draft: true,
    costCents: 0.1234,
    tokensIn: 100,
    tokensOut: 50,
  });
  await outbound(c1, z("2026-10-05T14:01:30Z"), "agent", "recepcion", {
    costCents: 0.5,
    tokensIn: 200,
    tokensOut: 80,
  });
  await inbound(c1, z("2026-10-05T14:05:00Z"));
  await outbound(c1, z("2026-10-05T14:06:00Z"), "agent", "recepcion", {
    costCents: 0.25,
    tokensIn: 100,
    tokensOut: 40,
  });
  await adapter.tags.addToConversation(c1.id, vip.id);
  await adapter.conversations.update(c1.id, { status: "closed" });
  await closeLine(c1, z("2026-10-05T23:30:00Z"));

  // c2: handed off, answered by ana (local Oct 5, UTC Oct 6), then luis, closed Oct 6.
  const c2 = await open("c2", A, z("2026-10-06T05:30:00Z"));
  await inbound(c2, z("2026-10-06T05:30:00Z"));
  await adapter.conversations.update(c2.id, { status: "human", everHuman: true });
  await outbound(c2, z("2026-10-06T05:31:00Z"), "system", null, {
    internal: true,
    metadata: { kind: "system", event: "handoff", by: "agent:recepcion" },
  });
  await outbound(c2, z("2026-10-06T05:31:30Z"), "system", null);
  await outbound(c2, z("2026-10-06T05:40:00Z"), "human", "ana");
  await outbound(c2, z("2026-10-06T15:00:00Z"), "human", "luis");
  await adapter.tags.addToConversation(c2.id, ventas.id);
  await adapter.conversations.update(c2.id, { status: "closed" });
  await closeLine(c2, z("2026-10-06T16:00:00Z"));

  // c3: account B (UTC); an imported message never counts.
  const c3 = await open("c3", B, z("2026-10-06T10:00:00Z"), "ad:123");
  await inbound(c3, z("2026-10-06T10:00:00Z"));
  await inbound(c3, z("2026-10-06T10:01:00Z"), { imported: true });
  await outbound(c3, z("2026-10-06T10:02:00Z"), "human", "ana");
  await adapter.tags.addToConversation(c3.id, vip.id);
  await adapter.tags.addToConversation(c3.id, ventas.id);

  // c6: ana's second first response of Oct 6, on another account and tag set.
  const c6 = await open("c6", A, z("2026-10-06T14:00:00Z"));
  await inbound(c6, z("2026-10-06T14:00:00Z"));
  await outbound(c6, z("2026-10-06T14:05:00Z"), "human", "ana");
  await adapter.tags.addToConversation(c6.id, vip.id);

  // c4: never answered, closed without a close line.
  const c4 = await open("c4", A, z("2026-10-07T15:00:00Z"), "garita");
  await inbound(c4, z("2026-10-07T15:00:00Z"));
  await adapter.conversations.update(c4.id, {
    status: "closed",
    lastActivityAt: z("2026-10-07T18:00:00Z"),
  });

  // c5: AI reply, then the business answered from the phone.
  const c5 = await open("c5", A, z("2026-10-07T16:00:00Z"));
  await inbound(c5, z("2026-10-07T16:00:00Z"));
  await outbound(c5, z("2026-10-07T16:03:00Z"), "agent", "ventas-bot", {
    costCents: 0.3333,
    tokensIn: 50,
    tokensOut: 20,
  });
  await outbound(c5, z("2026-10-07T16:10:00Z"), "human", "business_app", {
    metadata: { origin: "business_app" },
  });
  await adapter.conversations.update(c5.id, { status: "closed" });
  await closeLine(c5, z("2026-10-07T20:00:00Z"));

  // Another tenant on the same days.
  const x1 = await open("x1", X, z("2026-10-06T12:00:00Z"), "garita");
  await inbound(x1, z("2026-10-06T12:00:00Z"));
  await outbound(x1, z("2026-10-06T12:01:00Z"), "human", "ana", { costCents: 9 });

  const byId = new Map(Object.entries(ids).map(([label, id]) => [id, label]));
  // Labels replace uuids, so orderings that depended on them are re-sorted: tag sets, and
  // daily rows of one day across accounts.
  const label = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value), (key, v: unknown) => {
      if (typeof v === "string") return byId.get(v) ?? v;
      if (key === "tagIds" && Array.isArray(v)) return [...(v as string[])].sort();
      return v;
    }) as T;
  return { tenantId, ids, label };
}

/** Local midnight of Oct `day` in Guatemala (account A). */
export const gtMidnight = (day: number): Date =>
  new Date(`2026-10-${String(day).padStart(2, "0")}T06:00:00.000Z`);

/** The queries both suites run, built from a dataset's ids. */
export function metricsQueries(d: Dataset): Record<string, MetricsAdapterQuery> {
  const base = { tenantId: d.tenantId, from: gtMidnight(5), to: gtMidnight(8) };
  return {
    all: base,
    ventas: { ...base, tagIds: [d.ids.Ventas ?? ""] },
    vipOrVentas: { ...base, tagIds: [d.ids.VIP ?? "", d.ids.Ventas ?? ""] },
    accountB: { ...base, accountId: d.ids.B ?? "" },
    oct6: { tenantId: d.tenantId, from: gtMidnight(6), to: gtMidnight(7) },
    empty: { ...base, from: gtMidnight(20), to: gtMidnight(21) },
  };
}

export type MetricsSnapshot = Record<string, Record<string, unknown>>;

/** Every metric for every query, with ids replaced by labels. */
export async function snapshot(
  metrics: SendoAdapter["metrics"],
  d: Dataset,
): Promise<MetricsSnapshot> {
  const out: MetricsSnapshot = {};
  for (const [name, q] of Object.entries(metricsQueries(d))) {
    const daily = d
      .label(await metrics.daily(q))
      .sort((a, b) => (a.day + a.accountId < b.day + b.accountId ? -1 : 1));
    out[name] = d.label({
      daily,
      byAssignee: await metrics.byAssignee(q),
      firstResponse: await metrics.firstResponse(q),
      aiResolution: await metrics.aiResolution(q),
      bySource: await metrics.bySource(q),
      cost: await metrics.cost(q),
    });
  }
  return out;
}
