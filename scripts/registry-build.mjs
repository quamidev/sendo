import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const manifest = "registry/registry.json";
const outDir = "apps/web/registry-dist";

if (!existsSync(manifest)) {
  console.log(`[registry:build] ${manifest} not found, nothing to build.`);
  process.exit(0);
}

const result = spawnSync("pnpm", ["exec", "shadcn", "build", manifest, "-o", outDir], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
