import { defineConfig } from "tsup";

/** Peers and optional peers: never bundled, each one only reached from its own subpath. */
const PEER_EXTERNALS = [
  "zod",
  "ai",
  "@supabase/supabase-js",
  "next",
  "vitest",
  "@aws-sdk/client-s3",
  "@aws-sdk/s3-request-presigner",
  "drizzle-orm",
  "@prisma/client",
];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "adapters/memory/index": "src/adapters/memory/index.ts",
      "adapters/supabase/index": "src/adapters/supabase/index.ts",
      "adapters/drizzle/index": "src/adapters/drizzle/index.ts",
      "adapters/prisma/index": "src/adapters/prisma/index.ts",
      "adapters/contract/index": "src/adapters/contract/index.ts",
      "storage/supabase/index": "src/storage/supabase/index.ts",
      "storage/s3/index": "src/storage/s3/index.ts",
      // Client-safe subpaths (no server runtime): browser bundles import these.
      "snippets/index": "src/team/snippet-text.ts",
      "rules/index": "src/rules/schemas.ts",
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
