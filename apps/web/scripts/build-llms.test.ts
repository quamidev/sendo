/**
 * E2E for `scripts/build-llms.mjs` (AC-AD-1): runs the real script against the real
 * `content/docs/*.mdx` and `docs-samples/`, then reads what it wrote.
 *
 * Failure modes covered:
 * - a page in content/docs is missing from llms.txt, llms-full.txt or docs.json;
 * - a `<Sample>` include (or any other JSX component) is left in the output instead of
 *   being replaced by its code, or a heading keeps its `[#id]` suffix;
 * - the checked-in `packages/sendo/docs/docs.json` is stale (the npm package ships it
 *   without building `web`, so it must be regenerated and committed with doc changes).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(webRoot, "scripts", "build-llms.mjs");
const slugs = readdirSync(path.join(webRoot, "content", "docs"))
  .filter((name) => name.endsWith(".mdx"))
  .map((name) => name.replace(/\.mdx$/, ""));

function outsideFences(markdown: string): string[] {
  let inFence = false;
  return markdown.split("\n").filter((line) => {
    if (/^\s*(?:>\s*)*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return false;
    }
    return !inFence;
  });
}

describe("build-llms", () => {
  let dir: string;
  let llms: string;
  let full: string;
  let docs: { slug: string; title: string; body: string }[];

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sendo-llms-"));
    const docsJson = path.join(dir, "docs.json");
    execFileSync(process.execPath, [script, "--out-dir", dir, "--docs-json", docsJson], {
      cwd: webRoot,
    });
    llms = readFileSync(path.join(dir, "llms.txt"), "utf8");
    full = readFileSync(path.join(dir, "llms-full.txt"), "utf8");
    docs = (JSON.parse(readFileSync(docsJson, "utf8")) as { docs: typeof docs }).docs;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists every MDX page in llms.txt, llms-full.txt and docs.json", () => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(llms).toContain(`(https://sendo.quami.dev/docs/${slug})`);
      expect(full).toContain(`URL: https://sendo.quami.dev/docs/${slug}\n`);
    }
    expect(docs.map((doc) => doc.slug).sort()).toEqual([...slugs].sort());
    for (const doc of docs) expect(doc.body.length).toBeGreaterThan(100);
  });

  it("leaves no sample include or JSX unresolved", () => {
    for (const [name, text] of [
      ["llms-full.txt", full],
      ...docs.map((doc) => [doc.slug, doc.body] as const),
    ] as const) {
      const leftovers = outsideFences(text).filter((line) => {
        const prose = line.replace(/`[^`]*`/g, "");
        return /<\/?[A-Z][A-Za-z]*[\s>/]/.test(prose) || /\[#[a-z0-9-]+\]\s*$/.test(prose);
      });
      expect(leftovers, name).toEqual([]);
      expect(text, name).not.toContain("<Sample");
    }
    // Samples are inlined as code: one from docs-samples/ and one repo file.
    expect(full).toContain('```json title="components.json"');
    expect(full).toMatch(/```css title="components\/sendo\/motion.css"\n.*\n:root \{/);
  });

  it("matches the checked-in packages/sendo/docs/docs.json", () => {
    const check = () =>
      execFileSync(process.execPath, [script, "--out-dir", dir, "--check"], {
        cwd: webRoot,
        stdio: "pipe",
      });
    expect(check).not.toThrow();
  });
});
