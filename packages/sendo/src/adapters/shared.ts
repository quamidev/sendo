import type { Snippet, StoredRule, Tag } from "../types/entities";
import type { SourceCount } from "./types";

/**
 * Behaviour every adapter applies in JavaScript so results match: orderings that do not
 * depend on the database collation (`-` and `_` sort differently across locales), and the
 * `ConversationFilter.search` normalization.
 */

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Case-insensitive name, then id. */
export function compareTags(a: Tag, b: Tag): number {
  return compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.id, b.id);
}

/** Shortcut, tenant snippets before personal ones, then creation. */
export function compareSnippets(a: Snippet, b: Snippet): number {
  return (
    compareText(a.shortcut, b.shortcut) ||
    (a.visibility === b.visibility ? 0 : a.visibility === "tenant" ? -1 : 1) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    compareText(a.id, b.id)
  );
}

/** Position, then key, then id. */
export function compareRules(a: StoredRule, b: StoredRule): number {
  return a.position - b.position || compareText(a.key, b.key) || compareText(a.id, b.id);
}

/** Most conversations first, then source (`null` last). */
export function sortSourceCounts(counts: SourceCount[]): SourceCount[] {
  return [...counts].sort(
    (a, b) =>
      b.conversations - a.conversations ||
      (a.source === b.source
        ? 0
        : a.source === null
          ? 1
          : b.source === null
            ? -1
            : compareText(a.source, b.source)),
  );
}

/**
 * `ConversationFilter.search` terms: `*` dropped (a PostgREST wildcard), trimmed and
 * lower-cased; the phone term also drops spaces, dots, dashes and parentheses. `null` when blank.
 */
export function searchNeedles(search: string | undefined): { text: string; phone: string } | null {
  const text = (search ?? "").replace(/\*/g, "").trim().toLowerCase();
  if (text === "") return null;
  return { text, phone: text.replace(/[\s().-]/g, "") };
}
