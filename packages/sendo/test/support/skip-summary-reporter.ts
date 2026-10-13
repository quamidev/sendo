import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Reporter, TestCase, TestModule, TestSuite, Vitest } from "vitest/node";
import type { SkipReason } from "./services";

/**
 * Vitest reporter registered next to `default` in every workspace. After the run it prints one
 * line per skip reason (`N tests skipped — Supabase is not running.` plus the command that runs
 * them) and writes `test-results/skips.json`, which the root `scripts/test-summary.mjs` combines.
 * Skips without a `meta.skipReason` (e.g. `ctx.skip()`, optional env) are not reported.
 */

export const SKIP_MESSAGES: Record<SkipReason, { why: string; run: string }> = {
  supabase: {
    why: "Supabase is not running.",
    run: "pnpm supabase start && pnpm test:supabase",
  },
  database: {
    why: "Postgres is not reachable at SENDO_TEST_DATABASE_URL (default: local Supabase).",
    run: "pnpm supabase start && pnpm test:supabase",
  },
};

/**
 * A test skipped by a guarded (skipped) suite. Vitest leaves tests in suites nested under a
 * skipped `describe` (e.g. the shared adapter contract) pending rather than skipped, so those
 * count too; `ctx.skip()` inside a suite that ran does not.
 */
function skippedBySuite(test: TestCase): boolean {
  const state = test.result().state;
  if (state !== "skipped" && state !== "pending") return false;
  for (let node = test.parent; node.type === "suite"; node = node.parent) {
    if (node.state() === "skipped") return true;
  }
  return false;
}

function reasonOf(test: TestCase): SkipReason | undefined {
  let node: TestCase | TestSuite | TestModule = test;
  for (;;) {
    const reason = node.meta().skipReason;
    if (reason) return reason;
    if (node.type === "module") return undefined;
    node = node.parent;
  }
}

export default class SkipSummaryReporter implements Reporter {
  private root = process.cwd();

  onInit(vitest: Vitest): void {
    this.root = vitest.config.root;
  }

  onTestRunEnd(testModules: readonly TestModule[]): void {
    const counts = new Map<SkipReason, number>();
    for (const testModule of testModules) {
      for (const test of testModule.children.allTests()) {
        if (!skippedBySuite(test)) continue;
        const reason = reasonOf(test);
        if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    const skips = (Object.keys(SKIP_MESSAGES) as SkipReason[]).flatMap((reason) => {
      const count = counts.get(reason) ?? 0;
      return count > 0 ? [{ reason, count, ...SKIP_MESSAGES[reason] }] : [];
    });
    const dir = join(this.root, "test-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "skips.json"),
      `${JSON.stringify({ at: new Date().toISOString(), skips }, null, 2)}\n`,
    );
    for (const skip of skips) {
      const noun = skip.count === 1 ? "test" : "tests";
      console.log(
        `\n${String(skip.count)} ${noun} skipped — ${skip.why}\nRun them with: ${skip.run}`,
      );
    }
    if (skips.length > 0) console.log("");
  }
}
