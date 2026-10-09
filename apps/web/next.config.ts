import path from "node:path";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const repoRoot = path.join(import.meta.dirname, "..", "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/r/*": ["./registry-dist/**/*"],
  },
  turbopack: {
    root: repoRoot,
  },
};

// Docs pages are `content/docs/*.mdx`, imported by `app/docs/[slug]/page.tsx`.
// Turbopack needs plugins as module names or paths (no functions).
const withMDX = createMDX({
  options: {
    remarkPlugins: [
      "remark-frontmatter",
      "remark-gfm",
      path.join(import.meta.dirname, "lib", "remark-docs.mjs"),
    ],
  },
});

export default withMDX(nextConfig);
