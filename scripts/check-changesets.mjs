#!/usr/bin/env node
// Release guard: while @quami/sendo is 0.x, a pending changeset that declares `major`
// would publish 1.0.0 instead of the next 0.x. Exits 1 and names every offending file.
// Parses the changeset frontmatter by hand (`"<package>": major|minor|patch` lines).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const changesetDir = join(root, ".changeset");
const packageJsonPath = join(root, "packages/sendo/package.json");
const IGNORED = new Set(["README.md", "config.json"]);
const BUMPS = new Set(["major", "minor", "patch", "none"]);

const { name: packageName, version } = JSON.parse(readFileSync(packageJsonPath, "utf8"));
if (typeof packageName !== "string" || typeof version !== "string") {
  console.error(`check-changesets: ${relative(root, packageJsonPath)} has no name or version.`);
  process.exit(1);
}

/** Returns `{ package: bump }` from a changeset's frontmatter, or throws when it is malformed. */
function parseFrontmatter(text, file) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") throw new Error(`${file}: missing the opening "---" line.`);
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) throw new Error(`${file}: missing the closing "---" line.`);
  const bumps = {};
  for (const raw of lines.slice(1, end)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:"([^"]+)"|'([^']+)'|([^\s:"']+))\s*:\s*(["']?)([a-z]+)\4\s*(?:#.*)?$/.exec(
      line,
    );
    const name = match?.[1] ?? match?.[2] ?? match?.[3];
    const bump = match?.[5];
    if (name === undefined || bump === undefined || !BUMPS.has(bump)) {
      throw new Error(`${file}: can't read frontmatter line ${JSON.stringify(raw)}.`);
    }
    bumps[name] = bump;
  }
  return bumps;
}

const files = existsSync(changesetDir)
  ? readdirSync(changesetDir)
      .filter((f) => f.endsWith(".md") && !IGNORED.has(f))
      .sort()
  : [];

const isZeroMajor = /^0\./.test(version);
const offenders = [];
const errors = [];
const counts = { major: 0, minor: 0, patch: 0, none: 0 };

for (const file of files) {
  const rel = relative(root, join(changesetDir, file));
  let bumps;
  try {
    bumps = parseFrontmatter(readFileSync(join(changesetDir, file), "utf8"), rel);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    continue;
  }
  const bump = bumps[packageName];
  if (bump === undefined) continue;
  counts[bump] += 1;
  if (bump === "major" && isZeroMajor) offenders.push(rel);
}

for (const message of errors) console.error(`check-changesets: ${message}`);
if (offenders.length > 0) {
  console.error(
    `check-changesets: ${packageName} is ${version}, so a "major" changeset would publish 1.0.0.`,
  );
  for (const rel of offenders) console.error(`  ${rel}: declares "${packageName}": major`);
  console.error(`Fix: change the bump to "minor" (breaking changes in 0.x are minor bumps).`);
}
if (errors.length > 0 || offenders.length > 0) process.exit(1);

const summary = Object.entries(counts)
  .filter(([, n]) => n > 0)
  .map(([bump, n]) => `${n} ${bump}`)
  .join(", ");
console.log(
  `check-changesets: ${files.length} pending changeset(s) for ${packageName}@${version}` +
    (summary ? ` (${summary})` : "") +
    (isZeroMajor ? ", none major." : "; the major guard only applies to 0.x."),
);
