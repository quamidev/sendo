#!/usr/bin/env node
// Installs the wa-li registry items into the playground the way a real app would
// (`shadcn add`), but from the local registry build instead of registry.quami.dev.
//
//   pnpm --filter playground registry:install [items...] [--source file|url] [--reset-app-files]
//
// --source file (default)  apps/web/registry-dist/<item>.json, built first if missing
// --source url             @quami/<item> through components.json → http://localhost:3001/r/{name}.json
//                          (run `pnpm --filter web dev` and set QUAMI_REGISTRY_TOKEN, plus
//                          QUAMI_REGISTRY_TOKENS on the web app)
// --reset-app-files        also overwrite the files the playground adapted (lib/whatsapp.ts)
//
// @quami/wa-li is not on npm. `shadcn add` skips dependencies that package.json already
// declares (without a version in the item), so `"@quami/wa-li": "workspace:*"` here keeps
// it linked to packages/wa-li and no registry lookup happens.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appDir, "../..");
const distDir = join(repoRoot, "apps/web/registry-dist");
const shadcnBin = join(repoRoot, "node_modules/shadcn/dist/index.js");

const DEFAULT_ITEMS = ["wa-li-webhook", "wa-li-schema", "wa-li-inbox"];
/** Installed once, then edited by the playground: kept unless --reset-app-files. */
const APP_OWNED_FILES = ["lib/whatsapp.ts"];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string", default: "file" },
    "reset-app-files": { type: "boolean", default: false },
  },
});
const items = positionals.length > 0 ? positionals : DEFAULT_ITEMS;

function fail(message) {
  console.error(`registry:install: ${message}`);
  process.exit(1);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...opts });
  if (result.status !== 0)
    fail(`${command} ${args.join(" ")} exited with ${String(result.status)}`);
}

// Blockers #4: the workspace package must already be declared.
const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
const spec = pkg.dependencies?.["@quami/wa-li"];
if (typeof spec !== "string" || !spec.startsWith("workspace:")) {
  fail(
    'apps/playground/package.json must declare "@quami/wa-li": "workspace:*" (it is not published to npm).',
  );
}

let addresses;
if (values.source === "file") {
  if (items.some((item) => !existsSync(join(distDir, `${item}.json`)))) {
    console.log("Building the local registry (apps/web/registry-dist)...");
    run(process.execPath, [join(repoRoot, "scripts/registry-build.mjs")], { cwd: repoRoot });
  }
  addresses = items.map((item) => {
    const file = join(distDir, `${item}.json`);
    if (!existsSync(file)) fail(`${file} not found. Is "${item}" in registry/registry.json?`);
    return file;
  });
} else if (values.source === "url") {
  if (!process.env.QUAMI_REGISTRY_TOKEN) fail("--source url needs QUAMI_REGISTRY_TOKEN.");
  addresses = items.map((item) => `@quami/${item}`);
} else {
  fail(`unknown --source "${values.source}" (file or url).`);
}

// shadcn runs `pnpm add` for undeclared dependencies; provide pnpm when it is not on PATH.
const env = { ...process.env };
if (spawnSync("pnpm", ["--version"], { stdio: "ignore" }).status !== 0) {
  const shimDir = mkdtempSync(join(tmpdir(), "pnpm-shim-"));
  const shim = join(shimDir, "pnpm");
  writeFileSync(shim, '#!/bin/sh\nexec npx -y pnpm@10.34.6 "$@"\n');
  chmodSync(shim, 0o755);
  env.PATH = `${shimDir}${delimiter}${env.PATH ?? ""}`;
}

const kept = values["reset-app-files"]
  ? []
  : APP_OWNED_FILES.filter((file) => existsSync(join(appDir, file))).map((file) => ({
      file,
      content: readFileSync(join(appDir, file)),
    }));
const envLocal = join(appDir, ".env.local");
const hadEnvLocal = existsSync(envLocal);

try {
  run(process.execPath, [shadcnBin, "add", ...addresses, "--yes", "--overwrite", "--cwd", appDir], {
    cwd: appDir,
    env,
  });
} finally {
  for (const { file, content } of kept) {
    writeFileSync(join(appDir, file), content);
    console.log(
      `Kept the playground's ${file} (pass --reset-app-files to take the registry version).`,
    );
  }
  // shadcn writes the item's envVars as empty keys; the playground documents them in .env.example.
  if (!hadEnvLocal && existsSync(envLocal)) rmSync(envLocal);
}

const after = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
if (after.dependencies?.["@quami/wa-li"] !== spec) {
  fail(
    `@quami/wa-li changed to "${String(after.dependencies?.["@quami/wa-li"])}"; expected "${spec}".`,
  );
}
console.log(
  `Installed ${items.join(", ")} from ${values.source === "file" ? distDir : "the @quami registry"}.`,
);
