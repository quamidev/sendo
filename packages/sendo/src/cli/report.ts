import type { Account } from "../types/entities";
import { redactText } from "../utils/redact";
import type { CheckResult } from "./doctor";

const PASS = "OK";
const FAIL = "FALLA";

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

/** Plain-text pass/fail table (Spanish) with fix hints under each failure. */
export function formatDoctorReport(
  results: readonly CheckResult[],
  secrets: readonly string[] = [],
): string {
  const statusWidth = Math.max("Estado".length, FAIL.length);
  const labelWidth = Math.max(8, ...results.map((r) => r.label.length));
  const lines: string[] = [
    `${pad("Estado", statusWidth)}  ${pad("Revisión", labelWidth)}  Detalle`,
    `${"-".repeat(statusWidth)}  ${"-".repeat(labelWidth)}  ${"-".repeat(7)}`,
  ];
  for (const result of results) {
    lines.push(
      `${pad(result.ok ? PASS : FAIL, statusWidth)}  ${pad(result.label, labelWidth)}  ${result.detail}`,
    );
    if (!result.ok && result.hint !== undefined) {
      lines.push(`${" ".repeat(statusWidth + 2)}  -> Solución: ${result.hint}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  lines.push("");
  lines.push(
    failed === 0
      ? `Todo en orden: ${results.length} revisiones pasaron.`
      : `${failed} de ${results.length} revisiones fallaron.`,
  );
  return redactText(lines.join("\n"), secrets);
}

export function formatAccount(account: Account): string {
  return [
    "Cuenta registrada:",
    `  id:              ${account.id}`,
    `  phone_number_id: ${account.phoneNumberId}`,
    `  waba_id:         ${account.wabaId}`,
    `  display_phone:   ${account.displayPhone}`,
    `  token_ref:       ${account.tokenRef} (solo el nombre de la variable; el token no se guarda)`,
    `  tenant_id:       ${account.tenantId ?? "(sin tenant)"}`,
    `  timezone:        ${account.timezone}`,
  ].join("\n");
}
