"use server";

import { formatRuleIssues, ruleParamsSchemas } from "@quami/sendo";
import { defaultWorkflowsStrings } from "@/components/sendo/workflows/strings";
import type {
  RuleRowView,
  SaveRuleInput,
  WorkflowsActionResult,
} from "@/components/sendo/workflows/types";
import { validateRule } from "@/components/sendo/workflows/validation";
import { FIXTURE_USER_ID, workflowsFixture } from "@/fixtures/workflows";

// Dev-only stand-ins for app/(protected)/inbox/rules/actions.ts: same result shapes, fixture data
// kept per dataset in this server process (reload the page with ?reset to start over), validated
// with the same package schemas.

const stores = new Map<string, RuleRowView[]>();

function store(data: string): RuleRowView[] {
  const { key, fixture } = workflowsFixture(data);
  let rules = stores.get(key);
  if (rules === undefined) {
    rules = structuredClone(fixture.rules);
    stores.set(key, rules);
  }
  return rules;
}

function commit(data: string, rules: RuleRowView[]): WorkflowsActionResult<RuleRowView[]> {
  const { key } = workflowsFixture(data);
  const ordered = rules.map((rule, position) => ({ ...rule, position }));
  stores.set(key, ordered);
  return { ok: true, data: ordered };
}

const notFound = { ok: false, code: "NOT_FOUND", message: "Unknown rule" } as const;

export async function resetFixtureRules(data: string): Promise<void> {
  stores.delete(workflowsFixture(data).key);
}

export async function listFixtureRules(
  data: string,
): Promise<WorkflowsActionResult<RuleRowView[]>> {
  return { ok: true, data: store(data) };
}

export async function saveFixtureRule(
  data: string,
  input: SaveRuleInput,
): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const rules = store(data);
  const validation = validateRule(input, defaultWorkflowsStrings);
  if (!validation.ok) {
    return { ok: false, code: "INVALID", message: "Invalid rule", fieldErrors: validation.errors };
  }
  const now = new Date().toISOString();
  const params = ruleParamsSchemas[input.type].safeParse(validation.params);
  const base = {
    key: validation.key,
    type: input.type,
    params: validation.params,
    accountId: input.account,
    valid: params.success,
    error: params.success ? null : formatRuleIssues(params.error),
    updatedBy: FIXTURE_USER_ID,
    updatedByName: null,
    updatedAt: now,
  };
  if (input.id === null) {
    if (rules.some((rule) => rule.key === validation.key)) {
      return { ok: false, code: "DUPLICATE", message: "Duplicate rule name" };
    }
    return commit(data, [
      ...rules,
      {
        ...base,
        id: `rule-${crypto.randomUUID()}`,
        position: rules.length,
        active: true,
        origin: "screen",
      },
    ]);
  }
  if (!rules.some((rule) => rule.id === input.id)) return notFound;
  return commit(
    data,
    rules.map((rule) => (rule.id === input.id ? { ...rule, ...base } : rule)),
  );
}

export async function toggleFixtureRule(
  data: string,
  id: string,
  enabled: boolean,
): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const rules = store(data);
  if (!rules.some((rule) => rule.id === id)) return notFound;
  return commit(
    data,
    rules.map((rule) => (rule.id === id ? { ...rule, active: enabled } : rule)),
  );
}

export async function reorderFixtureRules(
  data: string,
  ids: string[],
): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const rules = store(data);
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const ordered = ids.flatMap((id) => {
    const rule = byId.get(id);
    return rule === undefined ? [] : [rule];
  });
  if (ordered.length !== rules.length) return notFound;
  return commit(data, ordered);
}

export async function deleteFixtureRule(
  data: string,
  id: string,
): Promise<WorkflowsActionResult<RuleRowView[]>> {
  const rules = store(data);
  if (!rules.some((rule) => rule.id === id)) return notFound;
  return commit(
    data,
    rules.filter((rule) => rule.id !== id),
  );
}
