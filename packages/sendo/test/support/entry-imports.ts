import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Optional peers stay behind their subpaths (`next`, `adapters/supabase`, `storage/s3`,
 * `adapters/drizzle`, `adapters/prisma`, `adapters/contract`); CLI-only dependencies
 * (`@modelcontextprotocol/sdk`, `jiti`) are loaded by `dist/cli.js` alone.
 */
export const FORBIDDEN_IN_MAIN_ENTRY = [
  "next",
  "@supabase/supabase-js",
  "vitest",
  "@modelcontextprotocol/sdk",
  "jiti",
  "drizzle-orm",
  "@prisma/client",
  "@aws-sdk",
] as const;

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.d.ts`];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** `"*"` matches every package. */
function matchesPackage(specifier: string, pkg: string): boolean {
  return pkg === "*" || specifier === pkg || specifier.startsWith(`${pkg}/`);
}

export type ForbiddenImport = { file: string; specifier: string };

export function findForbiddenImports(
  entryFile: string,
  forbidden: readonly string[] = FORBIDDEN_IN_MAIN_ENTRY,
): ForbiddenImport[] {
  const found: ForbiddenImport[] = [];
  const visited = new Set<string>();
  const queue = [entryFile];

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);

    for (const specifier of extractSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) {
        const next = resolveRelative(file, specifier);
        if (next !== null) queue.push(next);
      } else if (forbidden.some((pkg) => matchesPackage(specifier, pkg))) {
        found.push({ file, specifier });
      }
    }
  }

  return found;
}

/** Every bare (package or `node:`) specifier reachable from `entryFile` through relative imports. */
export function findBareImports(entryFile: string): ForbiddenImport[] {
  return findForbiddenImports(entryFile, ["*"]);
}
