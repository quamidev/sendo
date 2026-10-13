import type {
  MetricsAiResolutionRow,
  MetricsAssignee,
  MetricsCostRow,
  MetricsDaily,
  MetricsFirstResponseRow,
  MetricsSourceRow,
  TagColor,
} from "@quami/sendo";
import { summarizeMetrics } from "@/components/sendo/metrics/summary";
import {
  daysBetween,
  presetRange,
  type MetricsFilters,
  type MetricsNumberView,
  type MetricsRaw,
  type MetricsReport,
  type MetricsTagView,
} from "@/components/sendo/metrics/types";
import { sendoLocale } from "@/lib/sendo-ui";

/**
 * `break-ui` datasets for the metrics screen (`/dev/metrics?data=<key>`, dev only). Each one
 * generates the rows `sendo.metrics.*` would return for any filter selection, deterministically
 * per day, and goes through the same `summarizeMetrics` the server action uses.
 */

export const FIXTURE_TODAY = "2026-10-09";
const TIME_ZONE = "America/Guatemala";

interface Profile {
  label: string;
  /** Admin sees cost; supervisor gets `cost: null` and no cost fields. */
  role: "admin" | "supervisor";
  numbers: MetricsNumberView[];
  tags: MetricsTagView[];
  /** User ids with their names (`null` = `resolveUsers` doesn't know them). */
  assignees: [string, string | null][];
  sources: (string | null)[];
  agents: (string | null)[];
  /** First period the screen opens with. */
  initialDays: number;
  /** New conversations on a day (index from the start of the year, deterministic). */
  conversationsOn: (day: string, rand: () => number) => number;
  messagesPerConversation: number;
  /** Share of conversations the AI answers first. */
  aiShare: number;
  /** Cost of one AI turn, in US cents. */
  centsPerTurn: number;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a small deterministic generator per (dataset, day). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(items: readonly T[], rand: () => number): T => {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("empty fixture list");
  return item;
};

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

const number = (
  id: string,
  label: string | null,
  displayPhone: string,
  extra: Partial<MetricsNumberView> = {},
): MetricsNumberView => ({
  id,
  label,
  displayPhone,
  isDefault: false,
  active: true,
  timezone: TIME_ZONE,
  ...extra,
});

const tag = (id: string, name: string, color: TagColor): MetricsTagView => ({ id, name, color });

const demoNumbers = [
  number("num-recepcion", "Recepción", "+502 2222 3333", { isDefault: true }),
  number("num-cobranza", "Cobranza", "+502 2222 4444"),
  number("num-viejo", "Sucursal Zona 10", "+502 2222 5555", { active: false }),
];
const demoTags = [
  tag("tag-vip", "VIP", "violet"),
  tag("tag-ventas", "Ventas", "green"),
  tag("tag-soporte", "Soporte", "blue"),
  tag("tag-queja", "Queja", "red"),
];

const demo: Profile = {
  label: "Demo",
  role: "admin",
  numbers: demoNumbers,
  tags: demoTags,
  assignees: [
    ["ana", "Ana López"],
    ["luis", "Luis Pérez"],
    ["sofia", "Sofía Ramírez"],
    ["business_app", null],
  ],
  sources: [null, null, "garita", "web", "ad:120210000000000001", "volante"],
  agents: ["recepcion", "cobranza-bot"],
  initialDays: 30,
  conversationsOn: (day, rand) => {
    const base = weekday(day) === 0 ? 3 : weekday(day) === 6 ? 6 : 14;
    return base + Math.floor(rand() * 8);
  },
  messagesPerConversation: 5,
  aiShare: 0.7,
  centsPerTurn: 0.42,
};

const longNames = [
  "Aleksandra Wiśniewska-Kowalczyk",
  "Bartholomew Fitzgerald-Montgomery III",
  "Jo",
  "María José de los Ángeles Hernández Castañeda",
  "李小龙",
  "Nguyễn Thị Minh Khai",
];

const worst: Profile = {
  label: "Peor caso",
  role: "admin",
  numbers: [
    number("num-1", "Residencial Torre Vista Norte · Cobranza y mantenimiento", "+502 5055 1204", {
      isDefault: true,
    }),
    number(
      "num-2",
      "Clínica Dra. Aleksandra Wiśniewska-Kowalczyk (urgencias 24 h)",
      "+502 5155 1214",
    ),
    number("num-3", null, "+502 5255 1224"),
    number(
      "num-4",
      "Administración del condominio Jardines de San Cristóbal III",
      "+502 5355 1234",
      {
        active: false,
      },
    ),
  ],
  tags: [
    tag("t-1", "Clientes corporativos con contrato anual vigente (renovación)", "violet"),
    tag("t-2", "VIP", "pink"),
    tag("t-3", "🔥 urgente", "red"),
    ...Array.from({ length: 37 }, (_, i) =>
      tag(
        `t-${String(i + 4)}`,
        `Etiqueta ${String(i + 4)}`,
        pick(["gray", "teal", "amber", "blue"] as const, rng(i)),
      ),
    ),
  ],
  assignees: [
    ...longNames.map((name, i): [string, string | null] => [`user-${String(i)}`, name]),
    ["0b4e7c2a-91d3-4f5e-8a6b-2c1d0e9f8a7b", null],
    ["business_app", null],
    ...Array.from({ length: 17 }, (_, i): [string, string | null] => [
      `agent-${String(i)}`,
      `Agente de turno ${String(i + 1)}`,
    ]),
  ],
  sources: [
    null,
    "navidad-2026-garita-norte-torreb",
    "ad:120210000000000001",
    "garita",
    ...Array.from({ length: 20 }, (_, i) => `volante-zona-${String(i + 1)}`),
  ],
  agents: ["asistente-virtual-de-cobranza-y-mantenimiento-torre-b", null, "recepcion"],
  initialDays: 30,
  conversationsOn: (_day, rand) => 1_800 + Math.floor(rand() * 900),
  messagesPerConversation: 7,
  aiShare: 0.55,
  centsPerTurn: 12.3456,
};

const empty: Profile = {
  ...demo,
  label: "Vacío",
  conversationsOn: () => 0,
};

const one: Profile = {
  ...demo,
  label: "Un día",
  numbers: [number("num-recepcion", "Recepción", "+502 2222 3333", { isDefault: true })],
  tags: [tag("tag-vip", "VIP", "violet")],
  assignees: [["ana", "Ana López"]],
  sources: ["garita"],
  agents: ["recepcion"],
  initialDays: 1,
  conversationsOn: () => 1,
  messagesPerConversation: 2,
  aiShare: 0,
  centsPerTurn: 0.0042,
};

const ninety: Profile = {
  ...demo,
  label: "90 días",
  initialDays: 90,
  conversationsOn: (day, rand) => {
    if (day.endsWith("-01")) return 0;
    const season = 1 + Math.sin(new Date(`${day}T00:00:00Z`).getTime() / 6.048e8) * 0.5;
    return Math.floor((weekday(day) === 0 ? 2 : 18) * season + rand() * 6);
  },
};

const heavy: Profile = {
  ...demo,
  label: "1 persona · 1.000",
  assignees: [["ana", "Ana López"]],
  conversationsOn: (day) =>
    day >= "2026-09-10" && day <= FIXTURE_TODAY ? 33 + (day.endsWith("0") ? 10 : 0) : 0,
  aiShare: 0,
};

const supervisor: Profile = { ...demo, label: "Supervisor", role: "supervisor" };

export const METRICS_FIXTURES = { demo, worst, empty, one, ninety, heavy, supervisor };
export type MetricsFixtureKey = keyof typeof METRICS_FIXTURES;

export function metricsFixture(key: string | undefined): {
  key: MetricsFixtureKey;
  fixture: Profile;
} {
  const k = (key ?? "demo") in METRICS_FIXTURES ? ((key ?? "demo") as MetricsFixtureKey) : "demo";
  return { key: k, fixture: METRICS_FIXTURES[k] };
}

export function initialFilters(fixture: Profile): MetricsFilters {
  return { ...presetRange(fixture.initialDays, FIXTURE_TODAY), account: null, tagIds: [] };
}

/** The rows `sendo.metrics.*` would return for `filters`. */
function rawRows(key: string, p: Profile, filters: MetricsFilters): MetricsRaw {
  const daily: MetricsDaily[] = [];
  const byAssignee: MetricsAssignee[] = [];
  const firstResponse: MetricsFirstResponseRow[] = [];
  const aiResolution: MetricsAiResolutionRow[] = [];
  const bySource: MetricsSourceRow[] = [];
  const cost: MetricsCostRow[] = [];
  const admin = p.role === "admin";
  const names = new Map(p.assignees);
  const numbers = p.numbers.filter((n) => filters.account === null || n.id === filters.account);

  for (const day of daysBetween(filters.from, filters.to)) {
    if (day > FIXTURE_TODAY) continue;
    const rand = rng(hash(`${key}:${day}`));
    const total = p.conversationsOn(day, rand);
    const perAssignee = new Map<
      string,
      { conversations: number; messages: number; seconds: number[] }
    >();
    const perSource = new Map<string | null, number>();
    const perAgent = new Map<string | null, { cents: number; turns: number }>();
    const perNumber = new Map<
      string,
      { inbound: number; outbound: number; started: number; closed: number; cents: number }
    >();

    for (let i = 0; i < total; i++) {
      const account = pick(p.numbers, rand);
      const tagIds = p.tags
        .filter(() => rand() < 0.3)
        .map((t) => t.id)
        .slice(0, 3);
      const source = pick(p.sources, rand);
      const ai = rand() < p.aiShare;
      const assignee = ai ? null : pick(p.assignees, rand)[0];
      const agent = pick(p.agents, rand);
      const seconds = ai ? 5 + Math.floor(rand() * 60) : 60 + Math.floor(rand() * 3_000);
      const answered = rand() > 0.06;
      const closed = rand() < 0.8;
      const inbound = Math.max(1, Math.round(p.messagesPerConversation * (0.5 + rand() * 0.4)));
      const outbound = answered ? Math.max(1, p.messagesPerConversation - inbound) : 0;
      const turns = ai ? outbound : 0;
      // Filters apply at the same grain as the views.
      if (!numbers.includes(account)) continue;
      if (filters.tagIds.length > 0 && !tagIds.some((id) => filters.tagIds.includes(id))) continue;

      const n = perNumber.get(account.id) ?? {
        inbound: 0,
        outbound: 0,
        started: 0,
        closed: 0,
        cents: 0,
      };
      n.inbound += inbound;
      n.outbound += outbound;
      n.started += 1;
      n.closed += closed ? 1 : 0;
      n.cents += turns * p.centsPerTurn;
      perNumber.set(account.id, n);
      perSource.set(source, (perSource.get(source) ?? 0) + 1);
      if (turns > 0) {
        const a = perAgent.get(agent) ?? { cents: 0, turns: 0 };
        a.cents += turns * p.centsPerTurn;
        a.turns += turns;
        perAgent.set(agent, a);
      }
      if (assignee !== null && answered) {
        const a = perAssignee.get(assignee) ?? { conversations: 0, messages: 0, seconds: [] };
        a.conversations += 1;
        a.messages += outbound;
        a.seconds.push(seconds);
        perAssignee.set(assignee, a);
      }
      const id = `${key}-${day}-${String(i)}`;
      const at = new Date(`${day}T15:00:00Z`);
      firstResponse.push({
        conversationId: id,
        accountId: account.id,
        channel: "whatsapp",
        contactId: `${id}:contact`,
        assignedTo: assignee,
        source,
        tagIds,
        day,
        firstInboundAt: at,
        firstResponseAt: answered ? new Date(at.getTime() + seconds * 1000) : null,
        responder: answered ? (ai ? "agent" : "human") : null,
        responderRef: answered ? (ai ? agent : assignee) : null,
        seconds: answered ? seconds : null,
      });
      if (closed) {
        aiResolution.push({
          conversationId: id,
          accountId: account.id,
          channel: "whatsapp",
          source,
          tagIds,
          day,
          createdAt: at,
          closedAt: new Date(at.getTime() + 3_600_000),
          everHuman: !ai,
          humanMessages: ai ? 0 : outbound,
          agentMessages: turns,
          aiResolved: ai,
        });
      }
    }

    for (const [accountId, n] of perNumber) {
      const cents = Math.round(n.cents * 10_000) / 10_000;
      daily.push({
        day,
        accountId,
        channel: "whatsapp",
        inbound: n.inbound,
        outbound: n.outbound,
        conversationsStarted: n.started,
        conversationsClosed: n.closed,
        costCents: admin ? cents : null,
        tokensIn: admin ? n.outbound * 900 : null,
        tokensOut: admin ? n.outbound * 120 : null,
      });
    }
    for (const [assignee, a] of perAssignee) {
      const sorted = [...a.seconds].sort((x, y) => x - y);
      byAssignee.push({
        day,
        assignee,
        conversations: a.conversations,
        messagesSent: a.messages,
        firstResponses: a.conversations,
        firstResponseSeconds: sorted,
        medianFirstResponseSeconds: sorted[Math.floor(sorted.length / 2)] ?? null,
        name: names.get(assignee) ?? null,
        avatarUrl: null,
      });
    }
    for (const [source, conversations] of perSource) bySource.push({ day, source, conversations });
    for (const [agent, a] of perAgent) {
      cost.push({
        day,
        agent,
        costCents: Math.round(a.cents * 10_000) / 10_000,
        tokensIn: a.turns * 900,
        tokensOut: a.turns * 120,
        turns: a.turns,
      });
    }
  }
  return { daily, byAssignee, firstResponse, aiResolution, bySource, cost: admin ? cost : null };
}

export function fixtureReport(key: MetricsFixtureKey, filters: MetricsFilters): MetricsReport {
  const fixture = METRICS_FIXTURES[key];
  return summarizeMetrics({
    filters,
    timeZone: TIME_ZONE,
    raw: rawRows(key, fixture, filters),
    tags: fixture.tags,
    formatLocale: sendoLocale,
  });
}
