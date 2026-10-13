import { ruleKeySchema, ruleParamsSchemas, type RuleType } from "@quami/sendo/rules";
import type { WorkflowsStrings } from "./strings";

// The rules screen validates with the package's zod schemas (the same ones `sendo.rules.upsert`,
// `sendo rules sync` and the engine use), so the form can never accept what the server rejects.
// The schemas carry Spanish messages for text rules; the generic zod issues (numbers, enums,
// missing values) get Spanish messages here through a per-parse error map.

export type FieldErrors = Record<string, string>;

export type RuleValidation =
  { ok: true; key: string; params: Record<string, unknown> } | { ok: false; errors: FieldErrors };

interface IssueLike {
  code?: string;
  input?: unknown;
  expected?: unknown;
  origin?: unknown;
  minimum?: unknown;
  maximum?: unknown;
}

interface IssueWithPath {
  path: PropertyKey[];
  message: string;
}

interface Validator {
  safeParse(
    data: unknown,
    params?: { error?: (issue: IssueLike) => string | undefined },
  ): { success: true; data: unknown } | { success: false; error: { issues: IssueWithPath[] } };
}

function spanishIssues(strings: WorkflowsStrings) {
  return (issue: IssueLike): string | undefined => {
    switch (issue.code) {
      case "invalid_type":
        if (issue.input === undefined || issue.input === null) return strings.errorRequired;
        if (issue.expected === "int") return strings.errorInteger;
        return issue.expected === "number" ? strings.errorNumber : strings.errorInvalid;
      case "too_small":
        return issue.origin === "number"
          ? strings.errorMin(Number(issue.minimum))
          : strings.errorRequired;
      case "too_big":
        if (issue.origin === "number") return strings.errorMax(Number(issue.maximum));
        if (issue.origin === "array") return strings.errorMaxItems(Number(issue.maximum));
        return strings.errorMaxLength(Number(issue.maximum));
      case "invalid_value":
        return strings.errorChoose;
      default:
        return strings.errorInvalid;
    }
  };
}

function collect(issues: IssueWithPath[], prefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const path = prefix + issue.path.map(String).join(".");
    errors[path] ??= issue.message;
  }
  return errors;
}

/** Validates the params of `type` against the package schema; errors by field path. */
export function validateRuleParams(
  type: RuleType,
  params: unknown,
  strings: WorkflowsStrings,
): { ok: true; params: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const schema = ruleParamsSchemas[type] as unknown as Validator;
  const result = schema.safeParse(params, { error: spanishIssues(strings) });
  return result.success
    ? { ok: true, params: result.data as Record<string, unknown> }
    : { ok: false, errors: collect(result.error.issues) };
}

/**
 * Validates a whole rule: name (package `ruleKeySchema`, unique among `takenKeys`) and params.
 * Field paths are the params paths (`schedule.mon.0`) plus `key`.
 */
export function validateRule(
  input: { key: string; type: RuleType; params: unknown },
  strings: WorkflowsStrings,
  takenKeys: readonly string[] = [],
): RuleValidation {
  const errors: FieldErrors = {};
  const key = (ruleKeySchema as unknown as Validator).safeParse(input.key, {
    error: spanishIssues(strings),
  });
  if (!key.success) errors.key = key.error.issues[0]?.message ?? strings.errorInvalid;
  else if (takenKeys.includes(key.data as string)) errors.key = strings.keyDuplicate;

  const params = validateRuleParams(input.type, input.params, strings);
  if (!params.ok) Object.assign(errors, params.errors);

  if (!key.success || !params.ok || errors.key !== undefined) return { ok: false, errors };
  return { ok: true, key: key.data as string, params: params.params };
}

/** The first error at `path` or below it (`match.keywords` covers `match.keywords.3`). */
export function errorAt(errors: FieldErrors, path: string): string | undefined {
  if (errors[path] !== undefined) return errors[path];
  const nested = Object.keys(errors).find((candidate) => candidate.startsWith(`${path}.`));
  return nested === undefined ? undefined : errors[nested];
}
