import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// `/changelog` sources: the released history in `packages/sendo/CHANGELOG.md` (written by
// Changesets on release) and the pending `.changeset/*.md` files (the next version).

export type Bump = "major" | "minor" | "patch";

export interface PendingChange {
  file: string;
  bump: Bump;
  /** Markdown. */
  body: string;
}

export interface ChangelogSource {
  /** `CHANGELOG.md` without its `# @quami/sendo` title; `null` before the first release. */
  released: string | null;
  pending: PendingChange[];
}

const PACKAGE = "@quami/sendo";
const BUMPS: readonly Bump[] = ["major", "minor", "patch"];

export function repoRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "..");
}

function parseChangeset(file: string, source: string): PendingChange | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
  if (match === null) return null;
  const [, frontmatter = "", body = ""] = match;
  for (const line of frontmatter.split("\n")) {
    const entry = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line);
    if (entry?.[1] === PACKAGE) return { file, bump: entry[2] as Bump, body: body.trim() };
  }
  return null;
}

export function loadChangelog(root = repoRoot()): ChangelogSource {
  const changelogFile = path.join(
    /*turbopackIgnore: true*/ root,
    "packages",
    "sendo",
    "CHANGELOG.md",
  );
  let released: string | null = null;
  if (existsSync(changelogFile)) {
    const text = readFileSync(changelogFile, "utf8")
      .replace(/^#\s+@quami\/sendo\s*\n/, "")
      .trim();
    released = text === "" ? null : text;
  }

  const changesetDir = path.join(/*turbopackIgnore: true*/ root, ".changeset");
  const pending: PendingChange[] = [];
  if (existsSync(changesetDir)) {
    for (const file of readdirSync(changesetDir).sort()) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      const change = parseChangeset(file, readFileSync(path.join(changesetDir, file), "utf8"));
      if (change !== null && change.body !== "") pending.push(change);
    }
  }
  pending.sort((a, b) => BUMPS.indexOf(a.bump) - BUMPS.indexOf(b.bump));
  return { released, pending };
}

const BUMP_HEADINGS: Record<Bump, string> = {
  major: "Major changes",
  minor: "Minor changes",
  patch: "Patch changes",
};

/** The pending changesets as one Markdown section, grouped like Changesets writes a release. */
export function pendingMarkdown(pending: PendingChange[]): string {
  const parts: string[] = [];
  for (const bump of BUMPS) {
    const changes = pending.filter((change) => change.bump === bump);
    if (changes.length === 0) continue;
    parts.push(`### ${BUMP_HEADINGS[bump]}`);
    for (const change of changes) {
      const [first = "", ...rest] = change.body.split("\n");
      parts.push(
        [`- ${first}`, ...rest.map((line) => (line === "" ? "" : `  ${line}`))].join("\n"),
      );
    }
  }
  return parts.join("\n\n");
}

/** The released version (`v0-2-0`) or `next-release` whose notes mention `needle`, else `null`. */
export function sectionMentioning(source: ChangelogSource, needle: string): string | null {
  if (source.pending.some((change) => change.body.includes(needle))) return "next-release";
  if (source.released === null) return null;
  let version: string | null = null;
  for (const line of source.released.split("\n")) {
    const heading = /^##\s+(\d+\.\d+\.\d+\S*)/.exec(line);
    if (heading?.[1] !== undefined) version = heading[1];
    if (version !== null && line.includes(needle)) return versionId(version);
  }
  return null;
}

export function versionId(version: string): string {
  return `v${version.replace(/[^a-z0-9]+/gi, "-")}`;
}
