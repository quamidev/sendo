/**
 * Acceptance maps (SND-6.1, generalised in SNL-7.3): every acceptance criterion of a product spec,
 * as listed in one of the maps below, is covered by named tests in any workspace (or in the
 * sibling `sendo-connect` checkout) or classified `manual` with a reason. Each map writes its own
 * report (one row per criterion with its status and resolved tests) so the coverage can be read
 * without running anything:
 *
 * - `test/acceptance-map.json` (conversation inbox spec) → `test-results/acceptance-map.json`
 * - `test/acceptance-map-launch.json` (languages, site and launch spec) →
 *   `test-results/acceptance-map-launch.json`
 *
 * A reference in `tests` is `<path>#<text>`:
 * - `<repo path>#<text>`: a vitest file (`*.test.ts(x)`), a Playwright spec (`apps/web/e2e/*.spec.ts`)
 *   or a shared adapter contract suite; `<text>` must appear in an `it` / `test` / `describe` title
 *   (`runAdapterContract(` stands for the whole contract suite run on that adapter).
 * - `sendo-connect:<path>#<text>`: the same, in the private Connect repo checked out next to this
 *   one (`../sendo-connect`). Without that checkout the reference is reported `unverified`.
 * Manual entries of a map with `manualRefsRequired` point to where a human does the step:
 * `manualRefs` are `<repo path>#<text>` (any file, `<text>` must appear in it) or
 * `workspace:<path>#<text>` (the feature docs in the parent workspace, checked when present).
 *
 * Ways it could fail (one test each, per map):
 * [AM-1] A criterion has neither covering tests nor a manual reason, or an entry has an empty
 *        reason; a manual entry lacks the pointer to its manual step; the number of criteria
 *        changed without updating the declared count.
 * [AM-2] A covering reference points to a file that doesn't exist or isn't a test (or a shared
 *        contract suite), or to text that no longer appears in a test title (a test was renamed
 *        or deleted and the criterion silently lost its coverage); a manual pointer names a file
 *        or section that no longer exists.
 * [AM-3] The embedded list drifted from the product spec: an AC ID (or a 4.7 checklist item of
 *        the inbox spec) was added or removed. The spec path comes from the map's `productSpec`
 *        (relative to the parent workspace of this repo; a `*` folder matches any one folder),
 *        overridable with the map's env var
 *        (`SENDO_PRODUCT_SPEC` for the launch spec, `SENDO_INBOX_PRODUCT_SPEC` for the inbox
 *        spec); skips when the file isn't there (the specs live outside this repo).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
/** The workspace that holds this repo (`<workspace>/repos/<this repo>`) and the feature docs. */
const WORKSPACE_ROOT = resolve(REPO_ROOT, "../..");
const CONNECT_ROOT = resolve(REPO_ROOT, "../sendo-connect");
const CONNECT_PREFIX = "sendo-connect:";
const WORKSPACE_PREFIX = "workspace:";

interface Entry {
  tests?: string[];
  manual?: string;
  manualNote?: string;
  manualRefs?: string[];
  text?: string;
}

interface AcceptanceMap {
  productSpec?: { path: string; env: string };
  report?: string;
  checklistSection?: string;
  manualRefsRequired?: boolean;
  notes?: string[];
  acceptanceCriteria: number;
  checklistItems?: number;
  criteria: Record<string, Entry>;
}

/** A path under the workspace; a `*` segment matches any one folder (the first that has the rest). */
function workspaceFile(path: string): string | undefined {
  const parts = path.split("/");
  const star = parts.indexOf("*");
  if (star === -1) return join(WORKSPACE_ROOT, path);
  const parent = join(WORKSPACE_ROOT, ...parts.slice(0, star));
  if (!existsSync(parent)) return undefined;
  return readdirSync(parent)
    .sort()
    .map((dir) => join(parent, dir, ...parts.slice(star + 1)))
    .find((candidate) => existsSync(candidate));
}

const MAPS = [
  { source: "test/acceptance-map.json", report: "test-results/acceptance-map.json" },
  { source: "test/acceptance-map-launch.json", report: "test-results/acceptance-map-launch.json" },
].map(({ source, report }) => {
  const map = JSON.parse(readFileSync(join(PACKAGE_ROOT, source), "utf8")) as AcceptanceMap;
  const specEnv = map.productSpec?.env;
  const specPath =
    (specEnv !== undefined ? process.env[specEnv] : undefined) ??
    (map.productSpec ? workspaceFile(map.productSpec.path) : undefined);
  return {
    source,
    report: map.report ?? report,
    map,
    specEnv,
    specPath: specPath !== undefined && existsSync(specPath) ? specPath : undefined,
  };
});

/** Titles of `it` / `test` / `describe` calls (incl. `.each(...)` / `.skipIf(...)`) in a file. */
const TITLE_RE =
  /\b(?:it|test|describe)(?:\.(?:each|skipIf|runIf|only|skip|concurrent)(?:\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))?)*\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

const titles = new Map<string, string[]>();
function titlesOf(absolute: string): string[] {
  let found = titles.get(absolute);
  if (!found) {
    const source = readFileSync(absolute, "utf8");
    found = [...source.matchAll(TITLE_RE)].map((match) => match[2] ?? "");
    titles.set(absolute, found);
  }
  return found;
}

type Resolved =
  | { status: "ok"; file: string; test: string; repo: "sendo" | "sendo-connect" }
  | { status: "unverified"; file: string; test: string; repo: "sendo-connect"; reason: string }
  | { status: "broken"; problem: string };

/** Where a `tests` reference points, and whether it resolves. */
function resolveTestRef(ref: string): Resolved {
  const connect = ref.startsWith(CONNECT_PREFIX);
  const body = connect ? ref.slice(CONNECT_PREFIX.length) : ref;
  const hash = body.indexOf("#");
  if (hash <= 0 || hash === body.length - 1) {
    return { status: "broken", problem: `${ref}: expected \`[sendo-connect:]<path>#<text>\`` };
  }
  const file = body.slice(0, hash);
  const test = body.slice(hash + 1);
  const repo = connect ? "sendo-connect" : "sendo";
  if (connect && !existsSync(CONNECT_ROOT)) {
    return {
      status: "unverified",
      file,
      test,
      repo: "sendo-connect",
      reason: "../sendo-connect is not checked out next to this repo",
    };
  }
  const absolute = join(connect ? CONNECT_ROOT : REPO_ROOT, file);
  const where = `${connect ? CONNECT_PREFIX : ""}${file}`;
  if (!existsSync(absolute)) return { status: "broken", problem: `${where} does not exist` };
  const isTest = /\.(test|spec)\.tsx?$/.test(file);
  const isContract = !connect && file.startsWith("packages/sendo/src/adapters/contract/");
  if (!isTest && !isContract) {
    return { status: "broken", problem: `${where} is not a test file or a contract suite` };
  }
  // `runAdapterContract(` stands for the whole shared suite run on that adapter.
  if (test === "runAdapterContract(") {
    return readFileSync(absolute, "utf8").includes(test)
      ? { status: "ok", file, test, repo }
      : { status: "broken", problem: `${where} doesn't run the contract suite` };
  }
  return titlesOf(absolute).some((title) => title.includes(test))
    ? { status: "ok", file, test, repo }
    : { status: "broken", problem: `no test title in ${where} contains "${test}"` };
}

/** `null` when a manual pointer resolves (or can't be checked here), else why it doesn't. */
function manualRefProblem(ref: string): string | null {
  const workspace = ref.startsWith(WORKSPACE_PREFIX);
  const body = workspace ? ref.slice(WORKSPACE_PREFIX.length) : ref;
  const hash = body.indexOf("#");
  if (hash <= 0 || hash === body.length - 1)
    return `${ref}: expected \`[workspace:]<path>#<text>\``;
  const file = join(workspace ? WORKSPACE_ROOT : REPO_ROOT, body.slice(0, hash));
  if (!existsSync(file)) {
    // The feature docs live outside this repo (absent in CI); repo files must exist.
    return workspace ? null : `${body.slice(0, hash)} does not exist`;
  }
  return readFileSync(file, "utf8").includes(body.slice(hash + 1))
    ? null
    : `${ref}: the file no longer contains "${body.slice(hash + 1)}"`;
}

describe.each(MAPS)("acceptance map $source", ({ source, report, map, specEnv, specPath }) => {
  const ids = Object.keys(map.criteria);
  const acIds = ids.filter((id) => id.startsWith("AC-"));
  const checklistIds = ids.filter((id) => id.startsWith("CHECKLIST-4.7-"));

  it("[AM-1] every criterion has covering tests or a manual reason", () => {
    expect(acIds).toHaveLength(map.acceptanceCriteria);
    expect(checklistIds).toHaveLength(map.checklistItems ?? 0);
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
    if (map.manualRefsRequired === true) {
      const unpointed = ids.filter((id) => {
        const entry = map.criteria[id] ?? {};
        const needsPointer = entry.manual !== undefined || entry.manualNote !== undefined;
        return needsPointer && (entry.manualRefs ?? []).length === 0;
      });
      expect(unpointed, "manual items without a pointer to their manual step").toEqual([]);
    }
  });

  it("[AM-2] every covering reference resolves to a test title (or contract run) that exists", () => {
    const broken: string[] = [];
    const rows = ids.map((id) => {
      const entry = map.criteria[id] ?? {};
      const tests = (entry.tests ?? []).map((ref) => {
        const resolved = resolveTestRef(ref);
        if (resolved.status === "broken") {
          broken.push(`${id}: ${resolved.problem}`);
          return { ref, status: "broken" };
        }
        return {
          repo: resolved.repo,
          file: resolved.file,
          test: resolved.test,
          ...(resolved.status === "unverified" && { unverified: resolved.reason }),
        };
      });
      for (const ref of entry.manualRefs ?? []) {
        const problem = manualRefProblem(ref);
        if (problem !== null) broken.push(`${id}: ${problem}`);
      }
      return {
        id,
        status: tests.length > 0 ? "covered" : "manual",
        tests,
        ...(entry.manual !== undefined && { reason: entry.manual }),
        ...(entry.manualNote !== undefined && { manualPart: entry.manualNote }),
        ...(entry.manualRefs !== undefined && { manualSteps: entry.manualRefs }),
        ...(entry.text !== undefined && { text: entry.text }),
      };
    });
    expect(broken).toEqual([]);

    const count = (rowsOf: typeof rows, status: string) =>
      rowsOf.filter((r) => r.status === status).length;
    const ac = rows.filter((r) => r.id.startsWith("AC-"));
    const refs = rows.flatMap((r) => r.tests);
    const result = {
      generatedAt: new Date().toISOString(),
      source: `packages/sendo/${source}`,
      productSpec: map.productSpec?.path ?? null,
      productSpecChecked: specPath !== undefined,
      sendoConnectChecked: existsSync(CONNECT_ROOT),
      summary: {
        acceptanceCriteria: ac.length,
        covered: count(ac, "covered"),
        coveredWithManualPart: ac.filter((r) => r.status === "covered" && "manualPart" in r).length,
        manual: count(ac, "manual"),
        checklistItems: rows.length - ac.length,
        testReferences: refs.length,
        unverifiedReferences: refs.filter((r) => "unverified" in r).length,
      },
      ...(map.notes !== undefined && { notes: map.notes }),
      criteria: rows,
    };
    mkdirSync(join(PACKAGE_ROOT, "test-results"), { recursive: true });
    writeFileSync(join(PACKAGE_ROOT, report), `${JSON.stringify(result, null, 2)}\n`);
    expect(result.summary.covered + result.summary.manual).toBe(map.acceptanceCriteria);
  });

  it.skipIf(specPath === undefined)(
    `[AM-3] the embedded list matches the product spec (${specEnv ?? "productSpec"})`,
    () => {
      const spec = readFileSync(specPath ?? "", "utf8");
      const defined = [...spec.matchAll(/^\s*- \*\*(AC-[A-Z]{2,3}-\d+[a-z]?)\b/gm)].map(
        (m) => m[1],
      );
      expect([...new Set(defined)].sort()).toEqual([...acIds].sort());
      if (map.checklistSection === undefined) return;
      const start = spec.indexOf(map.checklistSection);
      expect(start, `${map.checklistSection} in the spec`).toBeGreaterThanOrEqual(0);
      const section = spec.slice(start, spec.indexOf("\n### ", start));
      const items = [...section.matchAll(/^- \[[ x]\] /gm)];
      expect(items).toHaveLength(checklistIds.length);
    },
  );
});
