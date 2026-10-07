import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(import.meta.dirname, "..");
const file = "20261006100000_playground.sql";

describe("playground migration", () => {
  it("is mirrored byte-identically into the root Supabase project", () => {
    const canonical = readFileSync(join(appDir, "supabase/migrations", file));
    const root = readFileSync(join(appDir, "../../supabase/migrations", file));
    expect(root.equals(canonical)).toBe(true);
  });

  it("replaces wa_can_access_tenant with the app_metadata tenant rule", () => {
    const sql = readFileSync(join(appDir, "supabase/migrations", file), "utf8");
    expect(sql).toContain("create or replace function public.wa_can_access_tenant(tenant_id uuid)");
    expect(sql).toContain("auth.jwt() -> 'app_metadata' ->> 'tenant_id'");
  });
});
