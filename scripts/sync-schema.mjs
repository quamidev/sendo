#!/usr/bin/env node
// Copies the canonical sendo-schema migrations from the registry item into the
// root Supabase project. Copies (not symlinks) because symlinks break the
// Supabase CLI on some setups. `--check` exits 1 when the copies are out of date.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "registry/items/sendo-schema/supabase/migrations");
const targetDir = join(root, "supabase/migrations");
const check = process.argv.includes("--check");

const files = readdirSync(sourceDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
if (files.length === 0) {
  console.error(`No migrations found in ${sourceDir}`);
  process.exit(1);
}

const stale = files.filter((file) => {
  const target = join(targetDir, file);
  return !existsSync(target) || !readFileSync(target).equals(readFileSync(join(sourceDir, file)));
});

if (check) {
  if (stale.length > 0) {
    console.error(`Out of sync (run \`pnpm schema:sync\`): ${stale.join(", ")}`);
    process.exit(1);
  }
  console.log(`Schema mirror up to date (${files.length} file(s)).`);
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
for (const file of stale) {
  copyFileSync(join(sourceDir, file), join(targetDir, file));
  console.log(`Synced ${file}`);
}
if (stale.length === 0) console.log(`Schema mirror up to date (${files.length} file(s)).`);
