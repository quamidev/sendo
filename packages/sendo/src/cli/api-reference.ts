/**
 * Lookup over `dist/api.json` (generated from the built `.d.ts` by `scripts/build-agent-data.mjs`).
 * Accepts `createSendo`, `InboxApi.reply` and instance paths like `sendo.inbox.reply`, which
 * follow member types (`Sendo.inbox` is an `InboxApi`).
 */

export interface ApiMember {
  name: string;
  text: string;
  doc: string;
  /** Name of the exported type of this member, when it is one (e.g. `InboxApi`). */
  type?: string;
}

export interface ApiSymbol {
  name: string;
  kind: string;
  /** Import paths that export it, e.g. `@quami/sendo/adapters/memory`. */
  entries: string[];
  doc: string;
  declaration: string;
  members?: ApiMember[];
}

export interface ApiReferenceData {
  package: string;
  version: string;
  symbols: ApiSymbol[];
}

export type ApiLookup = { found: true; text: string } | { found: false; text: string };

const MAX_SUGGESTIONS = 8;

function findByName<T extends { name: string }>(items: readonly T[], name: string): T | undefined {
  return (
    items.find((item) => item.name === name) ??
    items.find((item) => item.name.toLowerCase() === name.toLowerCase())
  );
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j] ?? 0;
      row[j] = Math.min(
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return row[b.length] ?? 0;
}

function suggestions(data: ApiReferenceData, query: string): string[] {
  const needle = (query.split(".").pop() ?? query).toLowerCase();
  if (needle === "") return [];
  const candidates: { name: string; rank: number }[] = [];
  for (const symbol of data.symbols) {
    const lower = symbol.name.toLowerCase();
    if (lower.includes(needle)) candidates.push({ name: symbol.name, rank: lower.length });
    else {
      const distance = levenshtein(lower, needle);
      if (distance <= 2) candidates.push({ name: symbol.name, rank: 100 + distance });
    }
    for (const member of symbol.members ?? []) {
      if (member.name.toLowerCase() === needle) {
        candidates.push({ name: `${symbol.name}.${member.name}`, rank: 50 });
      }
    }
  }
  return [...new Set(candidates.sort((a, b) => a.rank - b.rank).map((c) => c.name))].slice(
    0,
    MAX_SUGGESTIONS,
  );
}

function importLine(symbol: ApiSymbol): string {
  const typeOnly = ["interface", "type"].includes(symbol.kind) ? "type " : "";
  return symbol.entries
    .map((entry) => `import ${typeOnly}{ ${symbol.name} } from "${entry}";`)
    .join("\n");
}

function formatSymbol(symbol: ApiSymbol): string {
  const typed = (symbol.members ?? []).filter((member) => member.type !== undefined);
  return [
    `# ${symbol.name} (${symbol.kind})`,
    "",
    "```ts",
    importLine(symbol),
    "```",
    ...(symbol.doc === "" ? [] : ["", symbol.doc]),
    "",
    "```ts",
    symbol.declaration,
    "```",
    ...(typed.length === 0
      ? []
      : [
          "",
          `Members typed as other exports (look them up with api_reference, e.g. "${symbol.name}.${typed[0]?.name ?? ""}"):`,
          ...typed.map((member) => `- ${member.name}: ${member.type ?? ""}`),
        ]),
  ].join("\n");
}

function formatMember(owner: ApiSymbol, member: ApiMember, path: string): string {
  return [
    `# ${path}`,
    "",
    `Member of \`${owner.name}\` (${owner.entries.join(", ")}).`,
    ...(member.doc === "" ? [] : ["", member.doc]),
    "",
    "```ts",
    member.text,
    "```",
    ...(member.type === undefined
      ? []
      : ["", `Type: \`${member.type}\`. Call api_reference({ symbol: "${member.type}" }) for it.`]),
  ].join("\n");
}

function notFound(data: ApiReferenceData, query: string, reason: string): ApiLookup {
  const similar = suggestions(data, query);
  return {
    found: false,
    text: [
      reason,
      similar.length === 0
        ? "No similar names. Try search_docs for prose, or a top-level export such as createSendo or Sendo."
        : `Did you mean: ${similar.join(", ")}? Call api_reference with one of these.`,
    ].join(" "),
  };
}

export function lookupApiSymbol(data: ApiReferenceData, query: string): ApiLookup {
  const cleaned = query
    .trim()
    .replace(/\(\s*\)$/, "")
    .replace(/^@quami\/sendo[\w/-]*[.:#]/, "");
  const parts = cleaned.split(".").filter((part) => part !== "");
  const [rootName, ...path] = parts;
  if (rootName === undefined) {
    return notFound(data, query, "Pass an exported name, e.g. createSendo or InboxApi.reply.");
  }
  const root = findByName(data.symbols, rootName);
  if (root === undefined) {
    return notFound(
      data,
      cleaned,
      `No export named "${rootName}" in ${data.package}@${data.version}.`,
    );
  }
  if (path.length === 0) {
    const members = data.symbols
      .flatMap((symbol) =>
        (symbol.members ?? [])
          .filter((member) => member.name === rootName)
          .map((member) => `${symbol.name}.${member.name}`),
      )
      .slice(0, MAX_SUGGESTIONS);
    const seeAlso =
      members.length === 0 ? "" : `\n\nMembers with this name: ${members.join(", ")}.`;
    return { found: true, text: `${formatSymbol(root)}${seeAlso}` };
  }

  let owner: ApiSymbol = root;

  let walked = owner.name;
  for (let i = 0; i < path.length; i++) {
    const name = path[i] ?? "";
    const member: ApiMember | undefined = findByName(owner.members ?? [], name);
    if (member === undefined) {
      const names = (owner.members ?? []).map((m) => m.name);
      return {
        found: false,
        text:
          names.length === 0
            ? `${walked} (${owner.name}) has no members to look into. Call api_reference({ symbol: "${owner.name}" }) to read its declaration.`
            : `${walked} (${owner.name}) has no member "${name}". Members: ${names.join(", ")}.`,
      };
    }
    walked = `${walked}.${member.name}`;
    if (i === path.length - 1) return { found: true, text: formatMember(owner, member, walked) };
    const next: ApiSymbol | undefined =
      member.type === undefined ? undefined : findByName(data.symbols, member.type);
    if (next === undefined) {
      return {
        found: false,
        text: `${walked} is not typed as an exported interface, so "${path.slice(i + 1).join(".")}" can't be resolved. Read it with api_reference({ symbol: "${owner.name}.${member.name}" }).`,
      };
    }
    owner = next;
  }
  return { found: true, text: formatSymbol(owner) };
}
