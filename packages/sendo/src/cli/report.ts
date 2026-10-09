import type { Account } from "../types/entities";
import { redactText } from "../utils/redact";
import type { CheckResult } from "./doctor";

const PASS = "OK";
const FAIL = "FALLA";
const WARN = "AVISO";

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

/** Plain-text pass/fail table (Spanish) with the fix and docs link under each failure. */
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
      `${pad(result.ok ? PASS : result.warning === true ? WARN : FAIL, statusWidth)}  ${pad(result.label, labelWidth)}  ${result.detail}`,
    );
    const indent = " ".repeat(statusWidth + 2);
    if (!result.ok && result.fix !== undefined) {
      lines.push(`${indent}  -> Solución: ${result.fix.detail}`);
      if (result.fix.docsUrl !== undefined) lines.push(`${indent}     Docs: ${result.fix.docsUrl}`);
    }
  }
  const failed = results.filter((r) => !r.ok && r.warning !== true).length;
  const warned = results.filter((r) => !r.ok && r.warning === true).length;
  const warnings = warned === 0 ? "" : ` ${warned} con aviso.`;
  lines.push("");
  lines.push(
    failed === 0
      ? warned === 0
        ? `Todo en orden: ${results.length} revisiones pasaron.`
        : `Todo en orden: ${results.length - warned} de ${results.length} revisiones pasaron.${warnings}`
      : `${failed} de ${results.length} revisiones fallaron.${warnings}`,
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
