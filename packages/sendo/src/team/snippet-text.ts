/**
 * Pure snippet and tag text helpers: variables, limits and picker search. No imports, so the
 * module is safe to bundle in browser code: it is the `@quami/sendo/snippets` subpath (the inbox
 * snippet picker, composer and managers).
 */

/** WhatsApp's text message limit; the longest snippet body. */
export const SNIPPET_BODY_MAX_LENGTH = 4096;

/** Longest tag name. */
export const TAG_NAME_MAX_LENGTH = 64;

/** A variable name: `{{name}}` with `name` matching `[a-z_][a-z0-9_]*`. */
export const SNIPPET_VARIABLE_NAME = /^[a-z_][a-z0-9_]*$/;

/** Shortcut rule (`sendo_snippets_shortcut_check`): typed after `/` in the composer. */
export const SNIPPET_SHORTCUT = /^[a-z0-9_-]{1,32}$/;

/** `{{ name }}` occurrences (global; use with `matchAll` / `replace`). */
export const SNIPPET_VARIABLE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

/** Distinct variable names in `text`, in order of first appearance. */
export function findSnippetVariables(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(SNIPPET_VARIABLE)) names.add(match[1] ?? "");
  names.delete("");
  return [...names];
}

export interface FilledSnippet {
  text: string;
  /** Names without a value (missing or blank); their `{{name}}` stays in `text`. */
  unresolved: string[];
}

/** Replaces every `{{name}}` that has a non-blank value; the others stay as written. */
export function fillSnippetVariables(
  text: string,
  values: Readonly<Record<string, string | null | undefined>>,
): FilledSnippet {
  const unresolved = new Set<string>();
  const filled = text.replace(SNIPPET_VARIABLE, (whole, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (typeof value === "string" && value.trim() !== "") return value;
    unresolved.add(name);
    return whole;
  });
  return { text: filled, unresolved: [...unresolved] };
}

/** Lower case, accents removed, trimmed: `"  Ñandú "` → `"nandu"`. */
export function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** The fields the picker searches. */
export interface SearchableSnippet {
  shortcut: string;
  body: string;
}

/**
 * Accent- and case-insensitive picker search over shortcut and body. A leading `/` in the
 * query is ignored; every word of the query must appear. Order: shortcut starts with the
 * query, then shortcut contains it, then body-only matches; input order within each group.
 * A blank query returns every snippet.
 */
export function searchSnippets<T extends SearchableSnippet>(
  snippets: readonly T[],
  query: string,
): T[] {
  const normalized = normalizeSearchText(query.trim().replace(/^\//, ""));
  if (normalized === "") return [...snippets];
  const words = normalized.split(/\s+/);
  const ranked: { snippet: T; rank: number; index: number }[] = [];
  snippets.forEach((snippet, index) => {
    const shortcut = normalizeSearchText(snippet.shortcut);
    const haystack = `${shortcut} ${normalizeSearchText(snippet.body)}`;
    if (!words.every((word) => haystack.includes(word))) return;
    const rank = shortcut.startsWith(normalized) ? 0 : shortcut.includes(normalized) ? 1 : 2;
    ranked.push({ snippet, rank, index });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map((r) => r.snippet);
}
