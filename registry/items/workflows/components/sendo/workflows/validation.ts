import { ruleKeySchema, ruleParamsSchemas, type RuleType } from "@quami/sendo/rules";
import type { WorkflowsFormat, WorkflowsStrings } from "./strings";

// The rules screen validates with the package's zod schemas (the same ones `sendo.rules.upsert`,
// `sendo rules sync` and the engine use), so the form can never accept what the server rejects.
// The schemas' own messages are English (they also serve the CLI and the server), so the screen
// doesn't show them: `issueMessage` maps every issue by its code and path to `WorkflowsStrings`
// in the viewer's locale. An issue it doesn't know keeps the schema's English message.

export type FieldErrors = Record<string, string>;

export type RuleValidation =
  { ok: true; key: string; params: Record<string, unknown> } | { ok: false; errors: FieldErrors };

/** A zod issue (`reportInput: true`, so `input` is the rejected value). */
interface Issue {
  code?: string;
  path: PropertyKey[];
  message: string;
  input?: unknown;
  expected?: unknown;
  origin?: unknown;
  minimum?: unknown;
  maximum?: unknown;
}

interface Validator {
  safeParse(
    data: unknown,
    params?: { reportInput?: boolean },
  ): { success: true; data: unknown } | { success: false; error: { issues: Issue[] } };
}

/** The text of one schema issue in the screen's language (the schema's English text if unknown). */
function issueMessage(issue: Issue, strings: WorkflowsStrings, format: WorkflowsFormat): string {
  const [head, second] = issue.path;
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined || issue.input === null) return strings.errorRequired;
      if (issue.expected === "int") return strings.errorInteger;
      return issue.expected === "number" ? strings.errorNumber : strings.errorInvalid;
    case "too_small":
      if (issue.origin === "number") return strings.errorMin(Number(issue.minimum), format);
      // Strings: the schemas' `nonBlank` (at least one character after trimming).
      return issue.origin === "string" ? strings.errorRequired : issue.message;
    case "too_big":
      if (issue.origin === "number") return strings.errorMax(Number(issue.maximum), format);
      if (issue.origin === "array") return strings.errorMaxItems(Number(issue.maximum), format);
      if (issue.origin === "string") return strings.errorMaxLength(Number(issue.maximum), format);
      return issue.message;
    case "invalid_value":
      return strings.errorChoose;
    // `.regex(...)`: the times of a range, holiday dates and the route's source code.
    case "invalid_format":
      if (head === "schedule") return strings.errorTime;
      if (head === "holidays") return strings.errorDate;
      if (head === "match" && second === "source") return strings.errorSource;
      return issue.message;
    // `.refine(...)`: the time zone and a range's start before its end.
    case "custom":
      if (head === "timezone") return strings.errorTimezone;
      if (head === "schedule") return strings.errorRangeOrder;
      return issue.message;
    default:
      return issue.message;
  }
}

function collect(
  issues: Issue[],
  strings: WorkflowsStrings,
  format: WorkflowsFormat,
  prefix = "",
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const path = prefix + issue.path.map(String).join(".");
    errors[path] ??= issueMessage(issue, strings, format);
  }
  return errors;
}

/** Validates the params of `type` against the package schema; errors by field path. */
export function validateRuleParams(
  type: RuleType,
  params: unknown,
  strings: WorkflowsStrings,
  format: WorkflowsFormat,
): { ok: true; params: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const schema = ruleParamsSchemas[type] as unknown as Validator;
  const result = schema.safeParse(params, { reportInput: true });
  return result.success
    ? { ok: true, params: result.data as Record<string, unknown> }
    : { ok: false, errors: collect(result.error.issues, strings, format) };
}

/**
 * Validates a whole rule: name (package `ruleKeySchema`, unique among `takenKeys`) and params.
 * Field paths are the params paths (`schedule.mon.0`) plus `key`. Messages are `strings`, with
 * numbers in `format`.
 */
export function validateRule(
  input: { key: string; type: RuleType; params: unknown },
  strings: WorkflowsStrings,
  format: WorkflowsFormat,
  takenKeys: readonly string[] = [],
): RuleValidation {
  const errors: FieldErrors = {};
  const key = (ruleKeySchema as unknown as Validator).safeParse(input.key, { reportInput: true });
  if (!key.success) {
    const [issue] = key.error.issues;
    errors.key = issue === undefined ? strings.errorInvalid : issueMessage(issue, strings, format);
  } else if (takenKeys.includes(key.data as string)) errors.key = strings.keyDuplicate;

  const params = validateRuleParams(input.type, input.params, strings, format);
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
