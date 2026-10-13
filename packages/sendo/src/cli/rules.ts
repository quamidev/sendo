import type { SendoAdapter } from "../adapters/types";
import { syncRules, type SyncRuleOutcome } from "../rules/sync";
import { loadRulesFromConfig } from "./config-loader";

export interface RulesSyncCliInput {
  adapter: SendoAdapter;
  configPath: string;
  cwd: string;
  force: boolean;
  tenant?: string;
}

const OUTCOME_LABEL: Record<SyncRuleOutcome, string> = {
  created: "created",
  updated: "overwritten (--force)",
  unchanged: "already existed, unchanged",
  skipped: "skipped (other tenant)",
};

export interface RulesSyncCliResult {
  ok: boolean;
  text: string;
}

/** `sendo rules sync`: loads `rules` from `--config` and upserts them with `origin = "code"`. */
export async function runRulesSync(input: RulesSyncCliInput): Promise<RulesSyncCliResult> {
  const definitions = await loadRulesFromConfig(input.configPath, input.cwd);
  const result = await syncRules(input.adapter, definitions, {
    force: input.force,
    ...(input.tenant === undefined ? {} : { tenant: input.tenant }),
    by: "cli",
  });
  if (result.errors.length > 0) {
    return {
      ok: false,
      text: [
        "Invalid rules; none were saved. Fix these in the --config module:",
        ...result.errors.map((e) => `  - ${e}`),
      ].join("\n"),
    };
  }
  if (result.rules.length === 0) return { ok: true, text: "There are no rules to sync." };
  const lines = result.rules.map((r) => {
    const tenant = r.tenantId === null ? "no tenant" : `tenant ${r.tenantId}`;
    return `  ${r.key} (${r.type}, ${tenant}): ${OUTCOME_LABEL[r.outcome]}`;
  });
  const kept = result.rules.filter((r) => r.outcome === "unchanged").length;
  if (kept > 0 && !input.force) {
    lines.push(
      `${String(kept)} rule(s) already existed and were kept as they are (use --force to overwrite them with the code).`,
    );
  }
  return { ok: true, text: ["Rules synced:", ...lines].join("\n") };
}
