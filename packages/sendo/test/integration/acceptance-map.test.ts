/**
 * Acceptance map (SND-6.1): every acceptance criterion of the product spec, as listed in
 * `test/acceptance-map.json`, is covered by named tests in any workspace or classified `manual`
 * with a reason. Writes `test-results/acceptance-map.json` (one row per criterion with its status
 * and resolved tests) so the coverage can be read without running anything.
 *
 * Ways it could fail (one test each):
 * [AM-1] A criterion has neither covering tests nor a manual reason, or an entry has an empty
 *        reason; the number of criteria changed without updating the declared count.
 * [AM-2] A covering reference points to a file that doesn't exist or isn't a test (or a shared
 *        contract suite), or to text that no longer appears in a test title (a test was renamed
 *        or deleted and the criterion silently lost its coverage).
 * [AM-3] The embedded list drifted from the product spec: an AC ID or a 4.7 checklist item was
 *        added or removed. Runs when `SENDO_PRODUCT_SPEC` points to the spec file, skips otherwise
 *        (the spec lives outside this repo).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const MAP_FILE = join(PACKAGE_ROOT, "test/acceptance-map.json");
const REPORT_FILE = join(PACKAGE_ROOT, "test-results/acceptance-map.json");

interface Entry {
  tests?: string[];
  manual?: string;
  manualNote?: string;
  text?: string;
}

interface AcceptanceMap {
  acceptanceCriteria: number;
  checklistItems: number;
  criteria: Record<string, Entry>;
}

const map = JSON.parse(readFileSync(MAP_FILE, "utf8")) as AcceptanceMap;
const ids = Object.keys(map.criteria);
const acIds = ids.filter((id) => id.startsWith("AC-"));
const checklistIds = ids.filter((id) => id.startsWith("CHECKLIST-4.7-"));

/** Titles of `it` / `test` / `describe` calls (incl. `.each(...)` / `.skipIf(...)`) in a file. */
const TITLE_RE =
  /\b(?:it|test|describe)(?:\.(?:each|skipIf|runIf|only|skip|concurrent)(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?)*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

const titles = new Map<string, string[]>();
function titlesOf(file: string): string[] {
  let found = titles.get(file);
  if (!found) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    found = [...source.matchAll(TITLE_RE)].map((match) => match[2] ?? "");
    titles.set(file, found);
  }
  return found;
}

/** `null` when the reference resolves, else why it doesn't. */
function problemWith(ref: string): string | null {
  const hash = ref.indexOf("#");
  if (hash <= 0 || hash === ref.length - 1) return "expected `<repo path>#<text>`";
  const file = ref.slice(0, hash);
  const needle = ref.slice(hash + 1);
  if (!existsSync(join(REPO_ROOT, file))) return `${file} does not exist`;
  const isTest = /\.test\.tsx?$/.test(file);
  const isContract = file.startsWith("packages/sendo/src/adapters/contract/");
  if (!isTest && !isContract) return `${file} is not a test file or a contract suite`;
  // `runAdapterContract(` stands for the whole shared suite run on that adapter.
  if (needle === "runAdapterContract(") {
    return readFileSync(join(REPO_ROOT, file), "utf8").includes(needle)
      ? null
      : `${file} doesn't run the contract suite`;
  }
  return titlesOf(file).some((title) => title.includes(needle))
    ? null
    : `no test title in ${file} contains "${needle}"`;
}

describe("acceptance map", () => {
  it("[AM-1] every criterion has covering tests or a manual reason", () => {
    expect(acIds).toHaveLength(map.acceptanceCriteria);
    expect(checklistIds).toHaveLength(map.checklistItems);
    expect(ids).toHaveLength(acIds.length + checklistIds.length);
    const missing = ids.filter((id) => {
      const entry = map.criteria[id] ?? {};
      const tests = entry.tests ?? [];
      const manual = entry.manual?.trim() ?? "";
      if (tests.length > 0 && entry.manual !== undefined) return true; // one or the other
      return tests.length === 0 && manual.length < 20;
    });
    expect(missing, "criteria without coverage or a real reason").toEqual([]);
    for (const id of ids) {
      const note = map.criteria[id]?.manualNote;
      if (note !== undefined) expect(note.trim().length, `${id} manualNote`).toBeGreaterThan(20);
    }
  });

  it("[AM-2] every covering reference resolves to a test title (or contract run) that exists", () => {
    const broken: string[] = [];
    for (const id of ids) {
      for (const ref of map.criteria[id]?.tests ?? []) {
        const problem = problemWith(ref);
        if (problem !== null) broken.push(`${id}: ${problem}`);
      }
    }
    expect(broken).toEqual([]);

    const rows = ids.map((id) => {
      const entry = map.criteria[id] ?? {};
      const tests = (entry.tests ?? []).map((ref) => {
        const hash = ref.indexOf("#");
        return { file: ref.slice(0, hash), test: ref.slice(hash + 1) };
      });
      return {
        id,
        status: tests.length > 0 ? "covered" : "manual",
        tests,
        ...(entry.manual !== undefined && { reason: entry.manual }),
        ...(entry.manualNote !== undefined && { manualPart: entry.manualNote }),
        ...(entry.text !== undefined && { text: entry.text }),
      };
    });
    const count = (rowsOf: typeof rows, status: string) =>
      rowsOf.filter((r) => r.status === status).length;
    const ac = rows.filter((r) => r.id.startsWith("AC-"));
    const report = {
      generatedAt: new Date().toISOString(),
      source: "packages/sendo/test/acceptance-map.json",
      productSpecChecked: process.env.SENDO_PRODUCT_SPEC !== undefined,
      summary: {
        acceptanceCriteria: ac.length,
        covered: count(ac, "covered"),
        coveredWithManualPart: ac.filter((r) => r.status === "covered" && "manualPart" in r).length,
        manual: count(ac, "manual"),
        checklistItems: rows.length - ac.length,
        testReferences: rows.reduce((n, r) => n + r.tests.length, 0),
      },
      criteria: rows,
    };
    mkdirSync(join(PACKAGE_ROOT, "test-results"), { recursive: true });
    writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    expect(report.summary.covered + report.summary.manual).toBe(map.acceptanceCriteria);
  });

  it.skipIf(process.env.SENDO_PRODUCT_SPEC === undefined)(
    "[AM-3] the embedded list matches the product spec (SENDO_PRODUCT_SPEC)",
    () => {
      const spec = readFileSync(process.env.SENDO_PRODUCT_SPEC ?? "", "utf8");
      const defined = [...spec.matchAll(/^\s*- \*\*(AC-[A-Z]{2,3}-\d+)\b/gm)].map((m) => m[1]);
      expect([...new Set(defined)].sort()).toEqual([...acIds].sort());
      const section = spec.slice(
        spec.indexOf("#### 4.7"),
        spec.indexOf("\n### ", spec.indexOf("#### 4.7")),
      );
      const items = [...section.matchAll(/^- \[[ x]\] /gm)];
      expect(items).toHaveLength(checklistIds.length);
    },
  );
});
