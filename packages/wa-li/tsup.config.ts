import { defineConfig } from "tsup";

const PEER_EXTERNALS = ["zod", "ai", "@supabase/supabase-js", "next", "vitest"];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "adapters/memory/index": "src/adapters/memory/index.ts",
      "adapters/supabase/index": "src/adapters/supabase/index.ts",
      "adapters/contract/index": "src/adapters/contract/index.ts",
      "next/index": "src/next/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    splitting: true,
    treeshake: true,
    target: "node20",
    platform: "node",
    external: PEER_EXTERNALS,
  },
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    target: "node20",
    platform: "node",
    external: PEER_EXTERNALS,
  },
]);
