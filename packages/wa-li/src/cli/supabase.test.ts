import { describe, expect, it } from "vitest";
import { createSupabaseAdapterFromEnv, supabaseEnvConfig } from "./supabase";

describe("supabaseEnvConfig", () => {
  it("reads SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL and defaults the bucket", () => {
    expect(
      supabaseEnvConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k" }),
    ).toEqual({ url: "http://x", serviceRoleKey: "k", storageBucket: "whatsapp-media" });
    expect(
      supabaseEnvConfig({
        SUPABASE_URL: "http://a",
        NEXT_PUBLIC_SUPABASE_URL: "http://b",
        SUPABASE_SERVICE_ROLE_KEY: "k",
        WA_STORAGE_BUCKET: "media",
      }),
    ).toMatchObject({ url: "http://a", storageBucket: "media" });
  });

  it("throws a ConfigError naming the missing vars", () => {
    expect(() => supabaseEnvConfig({})).toThrow(/SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("builds an adapter without connecting", async () => {
    const adapter = await createSupabaseAdapterFromEnv({
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_SERVICE_ROLE_KEY: "key",
    });
    expect(typeof adapter.healthCheck).toBe("function");
  });
});
