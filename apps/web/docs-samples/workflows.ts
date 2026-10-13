import type { Actor, RuleDefinition } from "@quami/sendo";
import { sendo } from "./sendo";

declare const admin: Actor;

// #region code
// lib/sendo-rules.ts: no Next.js imports, so `sendo rules sync --config` can load it.
export const rules: RuleDefinition[] = [
  {
    key: "Horario oficina",
    type: "business_hours",
    params: {
      timezone: "America/Guatemala",
      schedule: {
        mon: [
          ["08:00", "13:00"],
          ["14:00", "18:00"],
        ],
        tue: [
          ["08:00", "13:00"],
          ["14:00", "18:00"],
        ],
        wed: [
          ["08:00", "13:00"],
          ["14:00", "18:00"],
        ],
        thu: [
          ["08:00", "13:00"],
          ["14:00", "18:00"],
        ],
        fri: [
          ["08:00", "13:00"],
          ["14:00", "18:00"],
        ],
        sat: [["09:00", "13:00"]],
        sun: [],
      },
      holidays: ["2026-12-25", "2027-01-01"],
      outsideMessage: "¡Hola! Te respondemos el próximo día hábil a partir de las 8:00.",
      appliesTo: "human", // "all" also holds the AI agent outside hours
    },
  },
  {
    key: "Cobranza",
    type: "route",
    params: {
      match: { keywords: ["factura", "pago", "estado de cuenta"] },
      action: { queue: "cobranza", tags: ["cobranza"], to: "human", reason: "Pregunta por pagos" },
    },
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
  { key: "Cierre automático", type: "auto_close", params: { afterDays: 3 } },
];
// #endregion code

// #region api
// What the rules screen's server actions call. Every method needs `rules.manage` (admins).
const list = await sendo.rules.list({ actor: admin }); // RuleView[]: StoredRule & { valid, error }
await sendo.rules.upsert(
  { key: "Cierre automático", type: "auto_close", params: { afterDays: 7 } },
  { actor: admin },
); // by (tenant, key); records updatedBy = admin.userId
const first = list[0];
if (first !== undefined) {
  await sendo.rules.toggle(first.id, false, { actor: admin });
  await sendo.rules.reorder(list.map((rule) => rule.id).reverse(), { actor: admin });
}
// #endregion api

// #region tick
const report = await sendo.maintenance.tick(); // { now?, budgetMs? } for tests
if (!report.skipped) {
  console.log(report.steps.escalations.count, report.steps.autoClose.count, report.durationMs);
}
// #endregion tick
