#!/usr/bin/env node
// Generates the agent-facing docs from content/docs/*.mdx (samples inlined):
// - public/llms.txt        index (title, url, description), served at /llms.txt
// - public/llms-full.txt   every page as Markdown, served at /llms-full.txt
// - packages/sendo/docs/docs.json  { docs: [{ slug, title, description, group?, url,
//   headings: [{ level, id, title }], body }] }, read by `sendo mcp` (search_docs, read_doc).
//   Checked in and shipped in the package `files`: `@quami/sendo` is built and published
//   without building `web`, so the package can't depend on this script having run.
//   The API reference (`api_reference`) is not here: the package build generates
//   dist/api.json from its own .d.ts (packages/sendo/scripts/build-agent-data.mjs).
//
// Runs before `next build` / `next dev`. Flags: --out-dir <dir>, --docs-json <path>,
// --check (exit 1 when docs.json is stale instead of writing it).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildDocsArtifacts } from "../lib/docs-source.mjs";

const webRoot = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    "out-dir": { type: "string", default: path.join(webRoot, "public") },
    "docs-json": {
      type: "string",
      default: path.join(webRoot, "..", "..", "packages", "sendo", "docs", "docs.json"),
    },
    check: { type: "boolean", default: false },
  },
});

function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, "utf8") === content) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}

const artifacts = buildDocsArtifacts(webRoot);
const outDir = path.resolve(values["out-dir"]);
const docsJsonPath = path.resolve(values["docs-json"]);

writeIfChanged(path.join(outDir, "llms.txt"), artifacts.llmsTxt);
writeIfChanged(path.join(outDir, "llms-full.txt"), artifacts.llmsFullTxt);

if (values.check) {
  const current = existsSync(docsJsonPath) ? readFileSync(docsJsonPath, "utf8") : "";
  if (current !== artifacts.docsJson) {
    console.error(
      `[build-llms] ${path.relative(process.cwd(), docsJsonPath)} is stale. Run \`pnpm --filter web build:llms\` and commit it.`,
    );
    process.exit(1);
  }
} else if (writeIfChanged(docsJsonPath, artifacts.docsJson)) {
  console.log(`[build-llms] updated ${path.relative(process.cwd(), docsJsonPath)}`);
}

console.log(
  `[build-llms] ${artifacts.slugs.length} docs pages → llms.txt, llms-full.txt, docs.json`,
);
