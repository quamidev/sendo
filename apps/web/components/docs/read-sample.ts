import path from "node:path";
import { docsPaths, readRepoFileFrom, readSampleFrom } from "@/lib/docs-source.mjs";

/**
 * Docs code samples live in `apps/web/docs-samples/` and are typechecked by the web
 * `typecheck`. Pages read them as text so the docs can't drift from the samples.
 * Region markers and the `./sendo` → `@/lib/sendo` rewrite: see `lib/docs-source.mjs`
 * (shared with `scripts/build-llms.mjs`, so llms.txt shows the same code).
 */
const paths = docsPaths(path.resolve(/*turbopackIgnore: true*/ process.cwd()));

/** Reads `docs-samples/<file>` (optionally one region) as the text shown in the docs. */
export function readSample(file: string, region?: string): string {
  return readSampleFrom(paths.samplesDir, file, region);
}

/**
 * Reads a file relative to the repo root (e.g. a registry item) for verbatim display.
 * Docs pages are prerendered, so this runs at build time only (not traced into the output).
 */
export function readRepoFile(relativePath: string): string {
  return readRepoFileFrom(paths.repoRoot, relativePath);
}
