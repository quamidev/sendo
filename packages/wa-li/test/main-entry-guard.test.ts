import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findForbiddenImports } from "./support/entry-imports";

const distDir = resolve(import.meta.dirname, "../dist");
const mainEntryFiles = ["index.js", "index.cjs", "index.d.ts", "index.d.cts"];

describe("main entry guard", () => {
  it.each(mainEntryFiles)(
    "built dist/%s does not import next, @supabase/supabase-js or vitest",
    (file) => {
      const entry = join(distDir, file);
      expect(existsSync(entry), `${entry} is missing, run pnpm build first`).toBe(true);
      expect(findForbiddenImports(entry)).toEqual([]);
    },
  );
});
