import { describe, expect, it } from "vitest";
import { findAppointments } from "@/lib/demo-agent";
import { envValue, playgroundMode } from "@/lib/playground-env";

describe("findAppointments", () => {
  it("finds by name without accents or case", () => {
    expect(findAppointments("ana perez").map((a) => a.patientId)).toEqual(["pac_001"]);
  });

  it("finds by phone digits", () => {
    expect(findAppointments("+502 5555-0002").map((a) => a.patientId)).toEqual(["pac_002"]);
  });

  it("returns nothing for unknown people", () => {
    expect(findAppointments("Zoe")).toEqual([]);
  });
});

describe("playgroundMode", () => {
  const supabase = { SUPABASE_URL: "http://127.0.0.1:55321", SUPABASE_SERVICE_ROLE_KEY: "key" };

  it("uses Supabase when configured", () => {
    expect(playgroundMode(supabase)).toBe("supabase");
  });

  it("uses fixtures when asked or when Supabase is not configured", () => {
    expect(playgroundMode({ ...supabase, WA_PLAYGROUND_MODE: "fixtures" })).toBe("fixtures");
    expect(playgroundMode({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "" })).toBe(
      "fixtures",
    );
    expect(playgroundMode({})).toBe("fixtures");
  });

  it("treats empty env values as unset", () => {
    expect(envValue("A", { A: "  " })).toBeUndefined();
  });
});
