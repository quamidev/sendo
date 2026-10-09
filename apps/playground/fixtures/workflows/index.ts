import { formatRuleIssues, ruleParamsSchemas, type RuleType } from "@quami/sendo";
import type { RuleNumberView, RuleRowView } from "@/components/sendo/workflows/types";

/**
 * `break-ui` datasets for the rules screen (`/dev/rules?data=<key>`, dev only). Each one enters
 * through the same props the real page passes (`RuleRowView[]`, numbers). Validity is computed
 * with the package schemas, exactly like `sendo.rules.list` does.
 */
export interface WorkflowsFixture {
  label: string;
  numbers: RuleNumberView[];
  rules: RuleRowView[];
}

export const FIXTURE_USER_ID = "dev-user";

const recepcion: RuleNumberView = {
  id: "num-recepcion",
  label: "Recepción",
  displayPhone: "+502 2222 3333",
  phoneNumberId: "100000000000001",
  active: true,
};
const cobranza: RuleNumberView = {
  id: "num-cobranza",
  label: "Cobranza",
  displayPhone: "+502 2222 4444",
  phoneNumberId: "100000000000002",
  active: true,
};

interface RuleSeed {
  key: string;
  type: RuleType;
  params: Record<string, unknown>;
  accountId?: string | null;
  active?: boolean;
  origin?: "code" | "screen";
  updatedBy?: string | null;
  updatedByName?: string | null;
}

function rules(seeds: RuleSeed[]): RuleRowView[] {
  return seeds.map((seed, position) => {
    const result = ruleParamsSchemas[seed.type].safeParse(seed.params);
    return {
      id: `rule-${String(position + 1)}`,
      key: seed.key,
      type: seed.type,
      params: seed.params,
      accountId: seed.accountId ?? null,
      position,
      active: seed.active ?? true,
      origin: seed.origin ?? "screen",
      valid: result.success,
      error: result.success ? null : formatRuleIssues(result.error),
      updatedBy: seed.updatedBy === undefined ? FIXTURE_USER_ID : seed.updatedBy,
      updatedByName: seed.updatedByName ?? null,
      updatedAt: new Date(Date.UTC(2026, 9, 1 + position, 15)).toISOString(),
    };
  });
}

const weekdays = (ranges: [string, string][]) => ({
  mon: ranges,
  tue: ranges,
  wed: ranges,
  thu: ranges,
  fri: ranges,
});

const demoRules: RuleSeed[] = [
  {
    key: "Horario oficina",
    type: "business_hours",
    origin: "code",
    updatedBy: null,
    params: {
      timezone: "America/Guatemala",
      schedule: {
        ...weekdays([
          ["08:00", "13:00"],
          ["14:00", "18:00"],
        ]),
        sat: [["09:00", "13:00"]],
        sun: [],
      },
      holidays: ["2026-12-24", "2026-12-25", "2027-01-01"],
      outsideMessage:
        "¡Hola! Nuestro horario es de lunes a viernes de 8:00 a 18:00 y sábados de 9:00 a 13:00. Te respondemos al abrir.",
      appliesTo: "human",
    },
  },
  {
    key: "Cobranza",
    type: "route",
    updatedByName: "Ana López",
    updatedBy: "user-ana",
    params: {
      match: { keywords: ["factura", "pago", "cobro", "estado de cuenta", "mora"] },
      action: { queue: "cobranza", tags: ["cobranza"], to: "human", reason: "Pregunta por pagos" },
    },
  },
  {
    key: "Garita",
    type: "route",
    accountId: recepcion.id,
    params: { match: { source: "garita" }, action: { tags: ["visitas"], to: "agent" } },
  },
  {
    key: "Turno cobranza",
    type: "auto_assign",
    params: { queue: "cobranza", strategy: "round_robin" },
  },
  {
    key: "Sin respuesta 15 min",
    type: "escalate",
    params: { afterMinutes: 15, action: "reassign" },
  },
  {
    key: "Avisar a supervisión",
    type: "escalate",
    active: false,
    params: { afterMinutes: 60, queue: null, action: "notify" },
  },
  { key: "Cierre automático", type: "auto_close", params: { afterDays: 3 } },
];

const manyKeywords = [
  "factura",
  "facturación",
  "pago",
  "pagos",
  "cobro",
  "cobranza",
  "estado de cuenta",
  "saldo",
  "mora",
  "recargo",
  "transferencia bancaria",
  "depósito",
  "comprobante",
  "recibo",
  "cuota de mantenimiento",
  "abono",
  "convenio de pago",
  "tarjeta de crédito",
  "débito automático",
  "multa",
  "intereses moratorios acumulados del trimestre anterior",
  ...Array.from({ length: 79 }, (_, index) => `cuota-${String(index + 1)}`),
];

const longKey = "Atención prioritaria a residentes de la Torre Vista Norte con mora > 90";

const worstRules: RuleSeed[] = [
  {
    key: longKey.slice(0, 64),
    type: "route",
    accountId: "num-desconectado",
    updatedBy: "00000000-0000-4000-8000-0000000000ff",
    params: {
      match: {
        keywords: manyKeywords,
        source: "navidad-2026-garita-norte-torreb",
        channel: "whatsapp",
        account: "100000000000099",
      },
      action: {
        queue: "cobranza-prioritaria-torre-vista-norte-y-jardines-de-san-cristob",
        tags: Array.from({ length: 20 }, (_, index) =>
          index === 0 ? "Aleksandra Wiśniewska-Kowalczyk" : `etiqueta-${String(index + 1)}`,
        ),
        to: "human",
        reason:
          "El residente pregunta por un pago atrasado, un convenio o una multa; revisar el estado de cuenta en el sistema antes de responder y escalar a administración si supera 90 días.",
      },
    },
  },
  {
    key: "Horario con muchos tramos",
    type: "business_hours",
    origin: "code",
    params: {
      timezone: "America/Argentina/Buenos_Aires",
      schedule: {
        mon: Array.from({ length: 12 }, (_, index) => [
          `${String(index * 2).padStart(2, "0")}:00`,
          `${String(index * 2 + 1).padStart(2, "0")}:30`,
        ]),
        tue: [["00:00", "24:00"]],
        wed: [],
        thu: [["09:00", "18:00"]],
        fri: [["09:00", "18:00"]],
        sat: [],
        sun: [],
      },
      holidays: Array.from({ length: 40 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 0, 1 + index * 9));
        return date.toISOString().slice(0, 10);
      }),
      outsideMessage: `${"Gracias por escribir a la administración del condominio Jardines de San Cristóbal III. ".repeat(12)}bartholomew.fitzgerald@northwind-industries-holdings.example.com`,
      appliesTo: "all",
    },
  },
  {
    key: "Horario roto (editado a mano en SQL)",
    type: "business_hours",
    origin: "code",
    updatedBy: null,
    params: {
      timezone: "Mars/Olympus_Mons",
      schedule: { mon: [["9", "18"]], tue: [["18:00", "09:00"]] },
      outsideMessage: "",
      appliesTo: "sometimes",
    },
  },
  {
    key: "Escalamiento viejo",
    type: "escalate",
    params: { afterMinutes: "15", action: "page_the_manager" },
  },
  { key: "J", type: "auto_close", params: { afterDays: 1 } },
  {
    key: "Asignación sin cola",
    type: "auto_assign",
    params: { queue: null, strategy: "least_open" },
  },
  {
    key: "Escalar tras una semana",
    type: "escalate",
    active: false,
    params: {
      afterMinutes: 10_080,
      queue: "soporte-técnico-de-segundo-nivel",
      action: "return_to_agent",
    },
  },
];

export const WORKFLOWS_FIXTURES = {
  demo: { label: "Demo", numbers: [recepcion, cobranza], rules: rules(demoRules) },
  worst: {
    label: "Worst case",
    numbers: [
      recepcion,
      {
        id: "num-desconectado",
        label: "Residencial Torre Vista Norte · Cobranza y mantenimiento (urgencias 24 h)",
        displayPhone: "+502 5555 0000",
        phoneNumberId: "100000000000099",
        active: false,
      },
    ],
    rules: rules(worstRules),
  },
  empty: { label: "Empty", numbers: [recepcion], rules: [] },
  invalid: {
    label: "Invalid",
    numbers: [recepcion],
    rules: rules([worstRules[2], worstRules[3]].filter((rule) => rule !== undefined)),
  },
} satisfies Record<string, WorkflowsFixture>;

export type WorkflowsFixtureKey = keyof typeof WORKFLOWS_FIXTURES;

export function workflowsFixture(key: string | undefined): {
  key: WorkflowsFixtureKey;
  fixture: WorkflowsFixture;
} {
  const found =
    key !== undefined && key in WORKFLOWS_FIXTURES ? (key as WorkflowsFixtureKey) : "demo";
  return { key: found, fixture: WORKFLOWS_FIXTURES[found] };
}
