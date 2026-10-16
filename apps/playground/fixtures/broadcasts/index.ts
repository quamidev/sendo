import type {
  BroadcastNumberView,
  BroadcastRecipientRowView,
  BroadcastSummaryView,
  BroadcastTemplateView,
  RecipientCounts,
  RecipientErrorView,
  RecipientStatus,
} from "@/components/sendo/broadcasts/types";

/**
 * `break-ui` datasets for the Envíos screen (`/dev/broadcasts?data=<key>`, dev only). They enter
 * through the same props and action results the real page uses. Recipients are generated
 * deterministically from the counts, so 10,000 rows cost nothing until a page is asked for.
 */

/** How an audience splits by eligibility (the package decides this for real lists). */
export interface FixtureAudience {
  id: string;
  label: string;
  description: string | null;
  size: number | null;
  optedIn: number;
  noDecision: number;
  optedOut: number;
  invalidPhone: number;
}

export interface FixtureBroadcast {
  summary: BroadcastSummaryView;
  /** Recipient states in id order (generated rows follow it). */
  plan: [RecipientStatus, number][];
  /** Advance pending recipients on every `getBroadcast` (a live "Enviando"). */
  live?: boolean;
}

export interface BroadcastsFixture {
  label: string;
  numbers: BroadcastNumberView[];
  templates: BroadcastTemplateView[];
  audiences: FixtureAudience[];
  broadcasts: FixtureBroadcast[];
  /** Opens this broadcast's progress view first. */
  open?: string;
  /** Opens the composer first. */
  compose?: boolean;
}

const recepcion: BroadcastNumberView = {
  id: "num-recepcion",
  label: "Recepción",
  displayPhone: "+502 2222 3333",
  isDefault: true,
  active: true,
  billingReady: true,
};
const cobranzaSinPago: BroadcastNumberView = {
  id: "num-cobranza",
  label: "Cobranza y administración del Condominio Jardines de la Montaña, Torre B",
  displayPhone: "+502 2222 4444",
  isDefault: false,
  active: true,
  billingReady: false,
};
const viejo: BroadcastNumberView = {
  id: "num-viejo",
  label: null,
  displayPhone: "+502 2222 9999",
  isDefault: false,
  active: false,
  billingReady: null,
};

const TEMPLATES: BroadcastTemplateView[] = [
  {
    id: "tpl-recordatorio",
    name: "recordatorio_cita",
    language: "es",
    category: "UTILITY",
    variableCount: 2,
    body: "Hola {{1}}, te recordamos tu cita el {{2}}. Responde SÍ para confirmar.",
  },
  {
    id: "tpl-novedades",
    name: "novedades",
    language: "es",
    category: "MARKETING",
    variableCount: 1,
    body: "Hola {{1}}, este mes tenemos 20% de descuento en limpiezas dentales. Responde BAJA si no quieres recibir promociones.",
  },
  {
    id: "tpl-long",
    name: "recordatorio_de_pago_de_cuota_de_mantenimiento_mensual_torre_b_noviembre_2026",
    language: "es_MX",
    category: "UTILITY",
    variableCount: 0,
    body: "Estimado residente: le recordamos que la cuota de mantenimiento de noviembre vence el día 10. Puede pagar en https://pagos.condominio-jardines-de-la-montana.example.com/cuotas/2026/noviembre/torre-b o en administración.",
  },
];

const ZERO_COUNTS: RecipientCounts = {
  pending: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
};

function countsOf(plan: [RecipientStatus, number][]): RecipientCounts {
  const counts = { ...ZERO_COUNTS };
  for (const [status, count] of plan) counts[status] += count;
  return counts;
}

let sequence = 0;
function broadcast(
  seed: Partial<BroadcastSummaryView> & { plan: [RecipientStatus, number][]; live?: boolean },
): FixtureBroadcast {
  sequence++;
  const { plan, live, ...rest } = seed;
  const createdAt = new Date(Date.UTC(2026, 9, 9 - sequence, 15, 4)).toISOString();
  return {
    plan,
    ...(live === true && { live }),
    summary: {
      id: `bc-${String(sequence)}`,
      accountId: recepcion.id,
      templateName: "recordatorio_cita",
      language: "es",
      category: "UTILITY",
      status: "done",
      pauseReason: null,
      ratePerMinute: 60,
      createdBy: "dev-user",
      createdAt,
      startedAt: createdAt,
      finishedAt: null,
      ...rest,
      counts: countsOf(plan),
    },
  };
}

const DEMO_AUDIENCES: FixtureAudience[] = [
  {
    id: "pacientes",
    label: "Pacientes activos",
    description: "Con cita en los últimos 12 meses.",
    size: 1240,
    optedIn: 410,
    noDecision: 790,
    optedOut: 28,
    invalidPhone: 12,
  },
  {
    id: "citas-manana",
    label: "Citas de mañana",
    description: null,
    size: 37,
    optedIn: 5,
    noDecision: 32,
    optedOut: 0,
    invalidPhone: 0,
  },
];

const WORST_AUDIENCES: FixtureAudience[] = [
  {
    id: "morosos",
    label:
      "Residentes con cuota de mantenimiento pendiente de pago al día 5 del mes (Torres A, B y C, incluye locales comerciales)",
    description:
      "Filtro guardado por Bartholomew Fitzgerald: saldo mayor a Q0.00, sin convenio de pago vigente, sin notificación en los últimos 7 días y con teléfono registrado en el sistema de administración.",
    size: 10_000,
    optedIn: 0,
    noDecision: 9_120,
    optedOut: 830,
    invalidPhone: 50,
  },
  {
    id: "uno",
    label: "Jo",
    description: null,
    size: 1,
    optedIn: 0,
    noDecision: 0,
    optedOut: 1,
    invalidPhone: 0,
  },
];

export const BROADCASTS_FIXTURES = {
  demo: {
    label: "Demo",
    numbers: [recepcion, cobranzaSinPago, viejo],
    templates: TEMPLATES.slice(0, 2),
    audiences: DEMO_AUDIENCES,
    broadcasts: [
      broadcast({
        status: "sending",
        live: true,
        plan: [
          ["read", 120],
          ["delivered", 260],
          ["sent", 40],
          ["failed", 6],
          ["skipped", 12],
          ["pending", 802],
        ],
      }),
      broadcast({
        templateName: "novedades",
        category: "MARKETING",
        status: "done",
        plan: [
          ["read", 210],
          ["delivered", 160],
          ["sent", 4],
          ["failed", 3],
          ["skipped", 863],
        ],
      }),
      broadcast({
        status: "cancelled",
        plan: [
          ["delivered", 30],
          ["cancelled", 7],
        ],
      }),
      broadcast({ accountId: viejo.id, status: "done", plan: [["read", 1]] }),
      broadcast({
        templateName: "novedades",
        category: "MARKETING",
        status: "failed",
        plan: [
          ["delivered", 12],
          ["cancelled", 30],
        ],
      }),
    ],
  },
  zero: {
    label: "0 eligible",
    numbers: [recepcion],
    templates: [TEMPLATES[1] as BroadcastTemplateView],
    audiences: WORST_AUDIENCES,
    broadcasts: [],
    compose: true,
  },
  huge: {
    label: "10,000",
    numbers: [recepcion, cobranzaSinPago],
    templates: TEMPLATES,
    audiences: [...DEMO_AUDIENCES, ...WORST_AUDIENCES],
    broadcasts: [
      broadcast({
        id: "bc-huge",
        templateName: TEMPLATES[2]?.name ?? "",
        language: "es_MX",
        accountId: cobranzaSinPago.id,
        status: "sending",
        ratePerMinute: 1000,
        plan: [
          ["read", 2_310],
          ["delivered", 3_402],
          ["sent", 288],
          ["failed", 41],
          ["skipped", 880],
          ["pending", 3_079],
        ],
      }),
    ],
    open: "bc-huge",
  },
  failed: {
    label: "All failed",
    numbers: [recepcion],
    templates: TEMPLATES,
    audiences: DEMO_AUDIENCES,
    broadcasts: [
      broadcast({
        id: "bc-failed",
        status: "done",
        templateName: "novedades",
        category: "MARKETING",
        plan: [["failed", 64]],
      }),
    ],
    open: "bc-failed",
  },
  paused: {
    label: "Paused for payment",
    numbers: [recepcion, cobranzaSinPago],
    templates: TEMPLATES,
    audiences: DEMO_AUDIENCES,
    broadcasts: [
      broadcast({
        id: "bc-paused",
        accountId: cobranzaSinPago.id,
        status: "paused",
        pauseReason: "billing",
        plan: [
          ["delivered", 1],
          ["failed", 1],
          ["pending", 318],
        ],
      }),
    ],
    open: "bc-paused",
  },
  empty: {
    label: "No broadcasts",
    numbers: [recepcion],
    templates: [],
    audiences: [],
    broadcasts: [],
  },
} satisfies Record<string, BroadcastsFixture>;

export type BroadcastsFixtureKey = keyof typeof BROADCASTS_FIXTURES;

export function broadcastsFixture(data: string | undefined): {
  key: BroadcastsFixtureKey;
  fixture: BroadcastsFixture;
} {
  const key = (
    data !== undefined && data in BROADCASTS_FIXTURES ? data : "demo"
  ) as BroadcastsFixtureKey;
  return { key, fixture: BROADCASTS_FIXTURES[key] };
}

const NAMES: (string | null)[] = [
  "Aleksandra Wiśniewska-Kowalczyk",
  "Jo",
  null,
  "María José de los Ángeles Hernández Castellanos de Rodríguez",
  "محمد عبد الرحمن",
  "🦷 Dra. Paz",
  "Luis",
  "Ana Lucía Pérez",
];

const META_ERRORS: RecipientErrorView[] = [
  {
    code: 131026,
    title: "Message undeliverable",
    message: "Unable to deliver message",
    details:
      "Message Undeliverable: the recipient's phone number is not a WhatsApp phone number, has not accepted the latest Terms of Service, or is using an old WhatsApp version.",
  },
  {
    code: 131049,
    title: "This message was not delivered to maintain healthy ecosystem engagement.",
    message: "Meta chose not to deliver this marketing message",
    details: null,
  },
  {
    code: null,
    title: null,
    message:
      "The send was interrupted before it was confirmed; it is not retried, to avoid duplicates.",
    details: null,
  },
  {
    code: 132001,
    title: "Template name does not exist in the translation",
    message:
      "template name (recordatorio_de_pago_de_cuota_de_mantenimiento_mensual_torre_b_noviembre_2026) does not exist in es_MX",
    details: null,
  },
];

const SKIPS = ["no_opt_in", "opted_out", "invalid_phone"] as const;

/** Row `index` of a broadcast whose states follow `plan` in id order. */
export function fixtureRecipient(
  broadcastId: string,
  plan: [RecipientStatus, number][],
  index: number,
): BroadcastRecipientRowView {
  let offset = index;
  let status: RecipientStatus = "pending";
  for (const [planned, count] of plan) {
    if (offset < count) {
      status = planned;
      break;
    }
    offset -= count;
  }
  const name = NAMES[index % NAMES.length] ?? null;
  const phone = index % 97 === 13 ? null : `+502 5${String(1000000 + index).slice(-7)}`;
  return {
    id: `${broadcastId}-r${String(index)}`,
    contactId: `c-${String(index)}`,
    name,
    phone,
    appRef: name === null ? `PAC-${String(10_000 + index)}` : null,
    status,
    skipReason: status === "skipped" ? (SKIPS[index % SKIPS.length] ?? null) : null,
    error: status === "failed" ? (META_ERRORS[index % META_ERRORS.length] ?? null) : null,
    updatedAt: new Date(Date.UTC(2026, 9, 9, 15, 5) + index * 1000).toISOString(),
  };
}

export function totalOfPlan(plan: [RecipientStatus, number][]): number {
  return plan.reduce((sum, [, count]) => sum + count, 0);
}
