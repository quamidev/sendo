import type { Account } from "../types/entities";
import { redactText } from "../utils/redact";
import type { CheckResult } from "./doctor";

const PASS = "OK";
const FAIL = "FAIL";
const WARN = "WARN";

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

/** Plain-text pass/fail table with the fix and docs link under each failure. */
export function formatDoctorReport(
  results: readonly CheckResult[],
  secrets: readonly string[] = [],
): string {
  const statusWidth = Math.max("Status".length, FAIL.length);
  const labelWidth = Math.max(8, ...results.map((r) => r.label.length));
  const lines: string[] = [
    `${pad("Status", statusWidth)}  ${pad("Check", labelWidth)}  Detail`,
    `${"-".repeat(statusWidth)}  ${"-".repeat(labelWidth)}  ${"-".repeat(6)}`,
  ];
  for (const result of results) {
    lines.push(
      `${pad(result.ok ? PASS : result.warning === true ? WARN : FAIL, statusWidth)}  ${pad(result.label, labelWidth)}  ${result.detail}`,
    );
    const indent = " ".repeat(statusWidth + 2);
    if (!result.ok && result.fix !== undefined) {
      lines.push(`${indent}  -> Fix: ${result.fix.detail}`);
      if (result.fix.docsUrl !== undefined) lines.push(`${indent}     Docs: ${result.fix.docsUrl}`);
    }
  }
  const failed = results.filter((r) => !r.ok && r.warning !== true).length;
  const warned = results.filter((r) => !r.ok && r.warning === true).length;
  const warnings = warned === 0 ? "" : ` ${warned} with a warning.`;
  lines.push("");
  lines.push(
    failed === 0
      ? warned === 0
        ? `All good: ${results.length} checks passed.`
        : `All good: ${results.length - warned} of ${results.length} checks passed.${warnings}`
      : `${failed} of ${results.length} checks failed.${warnings}`,
  );
  return redactText(lines.join("\n"), secrets);
}

export function formatAccount(account: Account, reconnected = false): string {
  return [
    reconnected
      ? "Account reconnected (same id; its contacts, conversations and messages are kept):"
      : "Account registered:",
    `  id:              ${account.id}`,
    `  phone_number_id: ${account.phoneNumberId}`,
    `  waba_id:         ${account.wabaId}`,
    `  display_phone:   ${account.displayPhone}`,
    `  token_ref:       ${account.tokenRef} (only the variable name; the token is not stored)`,
    `  tenant_id:       ${account.tenantId ?? "(no tenant)"}`,
    `  timezone:        ${account.timezone}`,
    `  default:         ${account.isDefault ? "yes" : "no (pick it with `sendo accounts set-default <id>`)"}`,
  ].join("\n");
}
