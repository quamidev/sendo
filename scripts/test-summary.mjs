#!/usr/bin/env node
// Combined skip summary for `pnpm test`. Every workspace's vitest run writes
// `test-results/skips.json` (the skip-summary reporter in packages/sendo/test/support); this
// script adds them up and prints one total per reason, or nothing when nothing was skipped.
//
//   node scripts/test-summary.mjs                  print the summary of the last run
//   node scripts/test-summary.mjs -- turbo run test  delete stale skips.json files, run the
//                                                  command, print the summary, exit with the
//                                                  command's exit code
//
// The summary never changes the exit code.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Workspace directories from `pnpm-workspace.yaml` (`dir` and `dir/*` entries). */
function workspaces() {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const block = /^packages:\s*\n((?:[ \t]+-.*\n?)+)/m.exec(yaml)?.[1] ?? "";
  const dirs = [];
  for (const line of block.split("\n")) {
    const pattern = /^\s*-\s*["']?([^"'#\s]+)["']?/.exec(line)?.[1];
    if (!pattern || pattern.startsWith("!")) continue;
    if (pattern.endsWith("/*")) {
      const parent = join(root, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(join(parent, entry.name));
      }
    } else {
      dirs.push(join(root, pattern));
    }
  }
  return dirs;
}

const skipFiles = () => workspaces().map((dir) => join(dir, "test-results", "skips.json"));

function clear() {
  for (const file of skipFiles()) rmSync(file, { force: true });
}

function summarize() {
  /** @type {Map<string, { count: number, why: string, run: string, from: string[] }>} */
  const totals = new Map();
  for (const file of skipFiles()) {
    if (!existsSync(file)) continue;
    let skips;
    try {
      skips = JSON.parse(readFileSync(file, "utf8")).skips;
    } catch {
      continue;
    }
    if (!Array.isArray(skips)) continue;
    const workspace = relative(root, dirname(dirname(file)));
    for (const { reason, count, why, run } of skips) {
      if (typeof reason !== "string" || typeof count !== "number" || count <= 0) continue;
      const total = totals.get(reason) ?? { count: 0, why, run, from: [] };
      total.count += count;
      total.from.push(`${workspace} ${count}`);
      totals.set(reason, total);
    }
  }
  if (totals.size === 0) return;
  const lines = ["", "Skip summary (all workspaces):"];
  for (const { count, why, run, from } of totals.values()) {
    lines.push(`${count} ${count === 1 ? "test" : "tests"} skipped — ${why} (${from.join(", ")})`);
    lines.push(`Run them with: ${run}`);
  }
  console.log(`${lines.join("\n")}\n`);
}

function safely(step) {
  try {
    step();
  } catch (error) {
    console.error(`test-summary: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const separator = process.argv.indexOf("--");
const command = separator === -1 ? [] : process.argv.slice(separator + 1);

if (command.length === 0) {
  safely(summarize);
} else {
  safely(clear);
  const child = spawn(command[0], command.slice(1), {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(`test-summary: could not run ${command[0]}: ${error.message}`);
    process.exit(1);
  });
  child.on("close", (code, signal) => {
    safely(summarize);
    process.exit(code ?? (signal ? 1 : 0));
  });
}
