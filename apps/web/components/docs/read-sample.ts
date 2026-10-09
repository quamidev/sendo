import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Docs code samples live in `apps/web/docs-samples/` and are typechecked by the web
 * `typecheck`. Pages read them as text so the docs can't drift from the samples.
 *
 * - `// #region <name>` / `// #endregion <name>` (or `-- #region` in SQL) select a part
 *   of a file; other region markers are removed from the output.
 * - Samples import the shared client as `./sendo`; the docs show it as the installed
 *   `@/lib/sendo`.
 */
export const DOCS_SAMPLES_DIR = path.join(process.cwd(), "docs-samples");

const MARKER_RE = /^\s*(?:\/\/|--|#)\s*#(region|endregion)\b\s*(\S*)\s*$/;

function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const min = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(min));
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

export function extractRegion(source: string, region?: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let inside = region === undefined;
  let found = region === undefined;
  for (const line of lines) {
    const marker = MARKER_RE.exec(line);
    if (marker) {
      if (region !== undefined && marker[2] === region) {
        inside = marker[1] === "region";
        found = true;
      }
      continue;
    }
    if (inside) kept.push(line);
  }
  if (!found) throw new Error(`Region "${region}" not found in docs sample.`);
  return trimBlankEdges(dedent(kept)).join("\n");
}

export function displaySample(source: string): string {
  return source.replace(/from "\.\/sendo"/g, 'from "@/lib/sendo"');
}

/** Reads `docs-samples/<file>` (optionally one region) as the text shown in the docs. */
export function readSample(file: string, region?: string): string {
  const resolved = path.resolve(DOCS_SAMPLES_DIR, file);
  if (!resolved.startsWith(DOCS_SAMPLES_DIR + path.sep)) {
    throw new Error(`Docs sample outside docs-samples: ${file}`);
  }
  return displaySample(extractRegion(readFileSync(resolved, "utf8"), region));
}

/**
 * Reads a file relative to the repo root (e.g. a registry item) for verbatim display.
 * Docs pages are prerendered, so this runs at build time only (not traced into the output).
 */
export function readRepoFile(relativePath: string): string {
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "..");
  return readFileSync(path.join(/*turbopackIgnore: true*/ root, relativePath), "utf8").trimEnd();
}
