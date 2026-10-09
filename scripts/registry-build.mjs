// Builds the shadcn registry (registry/registry.json) into apps/web/registry-dist.
// Runs the shadcn CLI with the current Node binary, so pnpm does not need to be on PATH.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = "registry/registry.json";
const outDir = "apps/web/registry-dist";

if (!existsSync(path.join(root, manifest))) {
  console.log(`[registry:build] ${manifest} not found, nothing to build.`);
  process.exit(0);
}

// shadcn is a root devDependency; its package.json is not in its exports map, so read it by path.
const pkgPath = path.join(root, "node_modules", "shadcn", "package.json");
if (!existsSync(pkgPath)) {
  console.error("[registry:build] shadcn is not installed. Run `pnpm install` at the repo root.");
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const binField = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.shadcn;
const cli = path.join(path.dirname(pkgPath), binField);

rmSync(path.join(root, outDir), { recursive: true, force: true });

const result = spawnSync(process.execPath, [cli, "build", manifest, "-o", outDir, "-c", root], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
