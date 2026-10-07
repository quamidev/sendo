import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findForbiddenImports } from "./support/entry-imports";

const distDir = resolve(import.meta.dirname, "../dist");
const mainEntryFiles = ["index.js", "index.cjs", "index.d.ts", "index.d.cts"];

describe("main entry guard", () => {
  let scratch: string | null = null;

  afterEach(() => {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  });

  it("detects forbidden imports reached through relative chunks", () => {
    scratch = mkdtempSync(join(tmpdir(), "wa-li-guard-"));
    writeFileSync(join(scratch, "index.js"), 'import { a } from "./chunk-a.js";\nexport { a };\n');
    writeFileSync(
      join(scratch, "chunk-a.js"),
      'import "zod";\nconst s = require("@supabase/supabase-js");\nexport const a = () => import("next/server");\n',
    );

    const found = findForbiddenImports(join(scratch, "index.js")).map((f) => f.specifier);

    expect(found).toEqual(expect.arrayContaining(["@supabase/supabase-js", "next/server"]));
    expect(found).not.toContain("zod");
  });

  it("does not flag packages that only share a prefix", () => {
    scratch = mkdtempSync(join(tmpdir(), "wa-li-guard-"));
    writeFileSync(join(scratch, "index.js"), 'import x from "next-intl";\nexport default x;\n');

    expect(findForbiddenImports(join(scratch, "index.js"))).toEqual([]);
  });

  it.each(mainEntryFiles)(
    "built dist/%s does not import next, @supabase/supabase-js or vitest",
    (file) => {
      const entry = join(distDir, file);
      expect(existsSync(entry), `${entry} is missing, run pnpm build first`).toBe(true);
      expect(findForbiddenImports(entry)).toEqual([]);
    },
  );
});
