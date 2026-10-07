import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { displaySample, extractRegion, readRepoFile, readSample } from "@/components/docs/read-sample";
import { docsNav } from "@/lib/docs-nav";

const docsDir = path.join(process.cwd(), "app", "docs");

function pageSources(): { file: string; source: string }[] {
  return readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(docsDir, entry.name, "page.tsx"))
    .filter((file) => existsSync(file))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

describe("docs pages", () => {
  it("has a page for every nav entry and no placeholder route", () => {
    for (const item of docsNav) {
      expect(existsSync(path.join(docsDir, item.slug, "page.tsx")), item.slug).toBe(true);
    }
    expect(existsSync(path.join(docsDir, "[slug]"))).toBe(false);
  });

  it("references only samples and regions that exist", () => {
    const sampleRe = /<Sample\s+file="([^"]+)"(?:\s+region="([^"]+)")?/g;
    let count = 0;
    for (const { file, source } of pageSources()) {
      for (const match of source.matchAll(sampleRe)) {
        const [, sample, region] = match;
        if (sample === undefined) continue;
        count++;
        expect(() => readSample(sample, region), `${file}: ${sample}#${region ?? ""}`).not.toThrow();
        expect(readSample(sample, region).trim(), `${sample}#${region ?? ""}`).not.toBe("");
      }
    }
    expect(count).toBeGreaterThan(20);
  });

  it("reads registry files shown verbatim", () => {
    expect(readRepoFile("registry/items/wa-li-inbox/components/whatsapp/motion.css")).toContain(
      "--wa-dur-press",
    );
  });

  it("keeps @quami/wa-li out of runtime page code", () => {
    for (const { file, source } of pageSources()) {
      expect(source, file).not.toMatch(/from "@quami\/wa-li/);
    }
  });
});

describe("extractRegion", () => {
  const source = [
    "import x from 'y';",
    "// #region a",
    "  const a = 1;",
    "  // #region b",
    "  const b = 2;",
    "  // #endregion b",
    "// #endregion a",
    "-- #region sql",
    "select 1;",
    "-- #endregion sql",
  ].join("\n");

  it("returns a dedented region without nested markers", () => {
    expect(extractRegion(source, "a")).toBe("const a = 1;\nconst b = 2;");
    expect(extractRegion(source, "sql")).toBe("select 1;");
  });

  it("returns the whole file without markers when no region is given", () => {
    expect(extractRegion(source)).not.toContain("#region");
  });

  it("throws for an unknown region", () => {
    expect(() => extractRegion(source, "missing")).toThrow(/missing/);
  });

  it("shows the shared client as the installed lib/whatsapp", () => {
    expect(displaySample('import { wa } from "./whatsapp";')).toBe(
      'import { wa } from "@/lib/whatsapp";',
    );
  });
});
