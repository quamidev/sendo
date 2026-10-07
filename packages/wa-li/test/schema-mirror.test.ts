import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const registryDir = join(repoRoot, "registry/items/wa-li-schema/supabase/migrations");
const rootDir = join(repoRoot, "supabase/migrations");

const registryMigrations = readdirSync(registryDir).filter((f) => f.endsWith(".sql"));

describe("wa-li-schema migration mirror", () => {
  it("has the v1 migration in the registry item", () => {
    expect(registryMigrations.some((f) => /^\d{14}_quami_whatsapp_v1\.sql$/.test(f))).toBe(true);
  });

  it.each(registryMigrations)(
    "root supabase/migrations/%s is byte-identical (run `pnpm schema:sync`)",
    (file) => {
      const canonical = readFileSync(join(registryDir, file));
      const mirror = readFileSync(join(rootDir, file));
      expect(mirror.equals(canonical)).toBe(true);
    },
  );
});
