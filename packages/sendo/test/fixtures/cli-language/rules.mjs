// `--config` module for `sendo rules sync` in the CLI language guard. `SENDO_LANG_RULES` picks the
// error path: "invalid" (every validation message), "not-array", "unknown-account" or "throws".
const mode = process.env.SENDO_LANG_RULES ?? "invalid";
if (mode === "throws") throw new Error("boom while loading the rules module");

const INVALID = [
  { key: "", type: "auto_close", params: { afterDays: 0 } },
  {
    key: "horario",
    type: "business_hours",
    params: {
      timezone: "Mars/Olympus",
      schedule: { mon: [["18:00", "09:00"]], tue: [["9", "18:00"]] },
      holidays: ["2026/12/25"],
      outsideMessage: "Estamos cerrados.",
      appliesTo: "sometimes",
    },
  },
  {
    key: "ruta",
    type: "route",
    params: { match: { source: "Not Valid!", keywords: "precio" }, action: { to: "robot" } },
  },
  { key: "teletransporte", type: "teleport", params: {} },
  {
    key: "escalar",
    type: "escalate",
    params: { afterMinutes: 1.5, action: "notify", queue: "q".repeat(65) },
  },
  { key: "asignar", type: "auto_assign", params: { strategy: "round_robin", queue: 7 } },
  { key: "doble", type: "auto_close", params: { afterDays: 3 } },
  { key: "doble", type: "auto_close", params: { afterDays: 3 } },
  {
    key: "lista",
    type: "business_hours",
    params: {
      timezone: "UTC",
      schedule: {},
      outsideMessage: "x",
      appliesTo: "all",
      holidays: Array.from({ length: 367 }, () => "2026-01-01"),
    },
  },
];

const UNKNOWN_ACCOUNT = [
  {
    key: "ventas",
    type: "route",
    account: "100000000000099",
    params: { match: {}, action: { to: "agent" } },
  },
];

export const rules =
  mode === "not-array" ? { key: "solo" } : mode === "unknown-account" ? UNKNOWN_ACCOUNT : INVALID;
