import { PayloadValidationError } from "../errors/errors";
import type { Contact, JsonValue } from "../types/entities";
import type { TemplateCategory } from "../types/enums";

/** Why a recipient was not sent the broadcast. */
export type BroadcastSkipReason = "no_opt_in" | "opted_out" | "invalid_phone";

export const BROADCAST_SKIP_REASONS: readonly BroadcastSkipReason[] = [
  "no_opt_in",
  "opted_out",
  "invalid_phone",
];

/** Template variables: positional (`{{1}}`) or named (`{{nombre}}`). */
export type BroadcastVariables = string[] | Record<string, string>;

/** The contact made an explicit "no" (`marketingOptIn = false` with a decision time). */
export function hasOptedOut(contact: Pick<Contact, "marketingOptIn" | "optInAt">): boolean {
  return !contact.marketingOptIn && contact.optInAt !== null;
}

/**
 * AC-BC-2: MARKETING (and any category Sendo doesn't know) needs `marketingOptIn = true`;
 * UTILITY and AUTHENTICATION go to every contact who hasn't explicitly opted out.
 * Returns null when the contact may receive the template.
 */
export function skipReasonFor(
  category: TemplateCategory,
  contact: Pick<Contact, "marketingOptIn" | "optInAt" | "phone">,
): BroadcastSkipReason | null {
  if (contact.phone === null) return "invalid_phone";
  if (category === "UTILITY" || category === "AUTHENTICATION") {
    return hasOptedOut(contact) ? "opted_out" : null;
  }
  if (contact.marketingOptIn) return null;
  return hasOptedOut(contact) ? "opted_out" : "no_opt_in";
}

/** Validates caller-provided variables; throws `PayloadValidationError` naming `field`. */
export function parseVariables(value: unknown, field: string): BroadcastVariables | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    if (items.every((v): v is string => typeof v === "string")) return items;
  } else if (typeof value === "object") {
    const out: Record<string, string> = {};
    let valid = true;
    for (const [key, v] of Object.entries(value) as [string, unknown][]) {
      if (typeof v === "string") out[key] = v;
      else valid = false;
    }
    if (valid) return out;
  }
  throw new PayloadValidationError({
    field,
    message: "must be an array of strings or an object of string values",
  });
}

/** Stored variables back to the send shape (invalid stored values count as none). */
export function storedVariables(value: JsonValue | null): BroadcastVariables | undefined {
  try {
    return parseVariables(value, "variables");
  } catch {
    return undefined;
  }
}

export function variableCount(variables: BroadcastVariables | undefined): number {
  if (variables === undefined) return 0;
  return Array.isArray(variables) ? variables.length : Object.keys(variables).length;
}
