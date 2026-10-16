#!/usr/bin/env node
// Copies the canonical schema migrations from the registry item into the root
// Supabase project and the playground. Copies (not symlinks) because symlinks break the
// Supabase CLI on some setups. Stale copies (legacy `*_wa_*` files, or `*_sendo_*` files
// whose canonical source is gone) are deleted; app-specific migrations are left alone.
//
// `--check` exits 1 when a mirror is out of date, or when `SENDO_SCHEMA_VERSION`
// (packages/sendo/src/utils/schema-version.ts) differs from the highest
// `sendo_schema_meta` version seeded by the canonical migrations.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "registry/items/schema/supabase/migrations");
const targetDirs = [
  join(root, "supabase/migrations"),
  join(root, "apps/playground/supabase/migrations"),
];
const versionFile = join(root, "packages/sendo/src/utils/schema-version.ts");
const check = process.argv.includes("--check");

/** Files a mirror may only hold as copies of a canonical migration. */
const CANONICAL_NAME = /^\d+_(sendo|wa)_.+\.sql$/;

const files = readdirSync(sourceDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (files.length === 0) {
  console.error(`No migrations found in ${sourceDir}`);
  process.exit(1);
}

const problems = [];

function plan(targetDir) {
  const present = existsSync(targetDir) ? readdirSync(targetDir) : [];
  const outdated = files.filter((file) => {
    const target = join(targetDir, file);
    return !existsSync(target) || !readFileSync(target).equals(readFileSync(join(sourceDir, file)));
  });
  const stale = present.filter((f) => CANONICAL_NAME.test(f) && !files.includes(f));
  return { outdated, stale };
}

function seededVersion() {
  let highest = null;
  const seed =
    /insert\s+into\s+public\.sendo_schema_meta\s*\(\s*version\s*\)\s*values\s*\(\s*(\d+)\s*\)/gi;
  for (const file of files) {
    for (const match of readFileSync(join(sourceDir, file), "utf8").matchAll(seed)) {
      const version = Number(match[1]);
      if (highest === null || version > highest) highest = version;
    }
  }
  return highest;
}

function packageVersion() {
  const match = /export\s+const\s+SENDO_SCHEMA_VERSION\s*(?::\s*number\s*)?=\s*(\d+)/.exec(
    readFileSync(versionFile, "utf8"),
  );
  return match ? Number(match[1]) : null;
}

if (check) {
  for (const targetDir of targetDirs) {
    const { outdated, stale } = plan(targetDir);
    const where = relative(root, targetDir);
    if (outdated.length > 0) problems.push(`${where}: out of sync: ${outdated.join(", ")}`);
    if (stale.length > 0) problems.push(`${where}: stale: ${stale.join(", ")}`);
  }
  const seeded = seededVersion();
  const expected = packageVersion();
  if (expected === null) {
    problems.push(`SENDO_SCHEMA_VERSION not found in ${relative(root, versionFile)}`);
  } else if (seeded !== expected) {
    problems.push(
      `SENDO_SCHEMA_VERSION is ${expected} but the highest sendo_schema_meta seed is ${seeded ?? "missing"}`,
    );
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error("Run `pnpm schema:sync` (mirrors) or fix the schema version.");
    process.exit(1);
  }
  console.log(
    `Schema mirrors up to date (${files.length} file(s) x ${targetDirs.length}); schema version ${expected}.`,
  );
  process.exit(0);
}

for (const targetDir of targetDirs) {
  const { outdated, stale } = plan(targetDir);
  const where = relative(root, targetDir);
  mkdirSync(targetDir, { recursive: true });
  for (const file of stale) {
    rmSync(join(targetDir, file));
    console.log(`Removed stale ${where}/${file}`);
  }
  for (const file of outdated) {
    copyFileSync(join(sourceDir, file), join(targetDir, file));
    console.log(`Synced ${where}/${file}`);
  }
  if (outdated.length === 0 && stale.length === 0) {
    console.log(`${where} up to date (${files.length} file(s)).`);
  }
}
