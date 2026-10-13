// Single source for the docs: reads `content/docs/*.mdx` (frontmatter, headings) and
// turns each page into plain Markdown with the `docs-samples/` includes inlined.
// Used by the Next app (nav, TOC, `<Sample>`), `scripts/build-llms.mjs` and its test.
// Plain ESM so the build script can run it with `node`; types in `docs-source.d.mts`.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const SITE_URL = "https://sendo.dev";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Paths of the docs sources, relative to the `apps/web` root. */
export function docsPaths(webRoot) {
  return {
    contentDir: path.join(/*turbopackIgnore: true*/ webRoot, "content", "docs"),
    samplesDir: path.join(/*turbopackIgnore: true*/ webRoot, "docs-samples"),
    repoRoot: path.resolve(/*turbopackIgnore: true*/ webRoot, "..", ".."),
  };
}

// ---------------------------------------------------------------------------
// Frontmatter

function parseScalar(raw) {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === "true" || value === "false") return value === "true";
  return value;
}

/**
 * Splits `---` frontmatter (flat `key: value` pairs only) from the MDX body and
 * validates the docs fields: `title`, `description`, `order` and an optional `group`.
 */
export function parseDoc(source, file = "<mdx>") {
  const text = source.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) throw new Error(`${file}: missing frontmatter (title, description, order).`);
  const data = {};
  for (const line of match[1].split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const pair = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (!pair) throw new Error(`${file}: unsupported frontmatter line "${line}" (use key: value).`);
    data[pair[1]] = parseScalar(pair[2]);
  }
  const { title, description, order, group } = data;
  if (typeof title !== "string" || title === "")
    throw new Error(`${file}: frontmatter "title" must be a string.`);
  if (typeof description !== "string" || description === "") {
    throw new Error(`${file}: frontmatter "description" must be a string.`);
  }
  if (typeof order !== "number") throw new Error(`${file}: frontmatter "order" must be a number.`);
  if (group !== undefined && (typeof group !== "string" || group === "")) {
    throw new Error(`${file}: frontmatter "group" must be a non-empty string when set.`);
  }
  return {
    frontmatter: { title, description, order, ...(group === undefined ? {} : { group }) },
    body: text.slice(match[0].length),
  };
}

/** Every page in `content/docs`, sorted by `order` (then slug). */
export function loadDocs(contentDir) {
  const docs = readdirSync(/*turbopackIgnore: true*/ contentDir)
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => {
      const slug = name.slice(0, -".mdx".length);
      if (!SLUG_RE.test(slug)) {
        throw new Error(`content/docs/${name}: file names must be kebab-case slugs.`);
      }
      const source = readFileSync(path.join(/*turbopackIgnore: true*/ contentDir, name), "utf8");
      const { frontmatter, body } = parseDoc(source, `content/docs/${name}`);
      return { slug, ...frontmatter, body };
    });
  return docs.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

/**
 * Reading order shared by the sidebar, the pager and llms.txt: pages without a `group`
 * first, then each group in the order of its first page; pages by `order` inside.
 */
export function groupDocs(docs) {
  const groups = new Map([[null, []]]);
  for (const doc of docs) {
    const key = doc.group ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  return [...groups]
    .filter(([, items]) => items.length > 0)
    .map(([group, items]) => ({ group, items }));
}

// ---------------------------------------------------------------------------
// Headings

const HEADING_ID_RE = /\s*\[#([a-z0-9][a-z0-9-]*)\]\s*$/;

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

/** `## Title [#custom-id]` → `{ text: "Title", id: "custom-id" }`; without `[#…]` the id is slugified. */
export function headingId(rawText) {
  const explicit = HEADING_ID_RE.exec(rawText);
  const text = explicit ? rawText.slice(0, explicit.index) : rawText;
  return { text, id: explicit ? explicit[1] : slugify(text) };
}

function stripInlineMarkdown(text) {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2");
}

function isFence(line) {
  return /^\s*(```|~~~)/.test(line);
}

/** Level 2 and 3 Markdown headings (outside code fences), for the page TOC. */
export function extractHeadings(body) {
  const headings = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (isFence(line)) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const { text } = headingId(match[2]);
    const title = stripInlineMarkdown(text).trim();
    headings.push({
      level: match[1].length,
      id: headingId(match[2].replace(text, title)).id,
      title,
    });
  }
  return headings;
}

// ---------------------------------------------------------------------------
// Samples

const MARKER_RE = /^\s*(?:\/\/|--|#)\s*#(region|endregion)\b\s*(\S*)\s*$/;

function dedent(lines) {
  const indents = lines
    .filter((line) => line.trim() !== "")
    .map((line) => line.length - line.trimStart().length);
  const min = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(min));
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * `// #region <name>` / `// #endregion <name>` (or `-- #region` in SQL, `# #region`)
 * select a part of a file; other region markers are removed from the output.
 */
export function extractRegion(source, region) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  let inside = region === undefined;
  let found = region === undefined;
  for (const line of lines) {
    const marker = MARKER_RE.exec(line);
    if (marker) {
      if (region !== undefined && marker[2] === region) {
        inside = marker[1] === "region";
        found = true;
      }
      continue;
    }
    if (inside) kept.push(line);
  }
  if (!found) throw new Error(`Region "${region}" not found in docs sample.`);
  return trimBlankEdges(dedent(kept)).join("\n");
}

/** Samples import the shared client as `./sendo`; the docs show the installed `@/lib/sendo`. */
export function displaySample(source) {
  return source.replace(/from "\.\/sendo"/g, 'from "@/lib/sendo"');
}

function resolveInside(dir, file, label) {
  const resolved = path.resolve(/*turbopackIgnore: true*/ dir, file);
  if (!resolved.startsWith(dir + path.sep)) throw new Error(`${label} outside ${dir}: ${file}`);
  return resolved;
}

/** `docs-samples/<file>` (optionally one region) as shown in the docs. */
export function readSampleFrom(samplesDir, file, region) {
  const resolved = resolveInside(samplesDir, file, "Docs sample");
  return displaySample(
    extractRegion(readFileSync(/*turbopackIgnore: true*/ resolved, "utf8"), region),
  );
}

/** A file relative to the repo root (e.g. a registry item), verbatim. */
export function readRepoFileFrom(repoRoot, relativePath) {
  const resolved = resolveInside(repoRoot, relativePath, "Repo file");
  return readFileSync(/*turbopackIgnore: true*/ resolved, "utf8").trimEnd();
}

const LANGS = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  mjs: "js",
  json: "json",
  sql: "sql",
  css: "css",
  yaml: "yaml",
  yml: "yaml",
  local: "dotenv",
  env: "dotenv",
  npmrc: "ini",
};

export function sampleLanguage(file) {
  const base = path.basename(file);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : base;
  return LANGS[ext] ?? "text";
}

// ---------------------------------------------------------------------------
// MDX → Markdown (llms.txt, docs.json)

function parseAttributes(raw, where) {
  const attrs = {};
  const re = /([A-Za-z]+)=(?:"([^"]*)"|\{(\d+)\})/g;
  let rest = raw;
  for (const match of raw.matchAll(re)) {
    attrs[match[1]] = match[2] ?? Number(match[3]);
    rest = rest.replace(match[0], "");
  }
  if (rest.trim() !== "")
    throw new Error(`${where}: unsupported attribute syntax "${rest.trim()}".`);
  return attrs;
}

function fenced(code, lang, title) {
  const ticks = code.includes("```") ? "````" : "```";
  const info = title ? `${lang} title="${title}"` : lang;
  return [`${ticks}${info}`, ...code.split("\n"), ticks];
}

const CALLOUT_LABELS = { note: "Note", warning: "Warning", danger: "Important" };

/**
 * Converts a docs MDX body into plain Markdown. Supported components (anything else
 * throws so it can't silently leak JSX into llms.txt):
 * - `<Sample file="…" region="…" title="…" />` and `<Sample repoFile="…" title="…" />`
 *   become fenced code blocks with the file content.
 * - `<Callout variant title>…</Callout>` becomes a blockquote.
 * - `<Step n id title>…</Step>` becomes a `##` heading.
 * - `<ScreenshotPlaceholder caption />` is dropped.
 * Heading ids (`[#id]`) are removed and site links (`](/docs/…)`) made absolute.
 */
export function mdxToMarkdown(body, { samplesDir, repoRoot, file = "<mdx>" }) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  function convert(closing) {
    const out = [];
    let inFence = false;
    while (index < lines.length) {
      const line = lines[index];
      const where = `${file}:${index + 1}`;
      index++;
      if (isFence(line)) {
        inFence = !inFence;
        out.push(line);
        continue;
      }
      if (inFence) {
        out.push(line);
        continue;
      }
      let trimmed = line.trim();
      // A JSX opening tag that Prettier wrapped over several lines.
      if (/^<[A-Z]/.test(trimmed)) {
        while (!trimmed.endsWith(">") && index < lines.length) {
          trimmed += ` ${lines[index].trim()}`;
          index++;
        }
        trimmed = trimmed.replace(/\s+(\/?>)$/, " $1").replace(/\s+>$/, ">");
      }
      if (closing && trimmed === closing) return out;
      if (/^(import|export)\s/.test(trimmed)) {
        throw new Error(
          `${where}: docs MDX can't use import/export; components are global (mdx-components.tsx).`,
        );
      }
      const sample = /^<Sample\s+(.*?)\s*\/>$/.exec(trimmed);
      if (sample) {
        const attrs = parseAttributes(sample[1], where);
        let code;
        let lang;
        if (typeof attrs.file === "string") {
          code = readSampleFrom(samplesDir, attrs.file, attrs.region);
          lang = sampleLanguage(attrs.file);
        } else if (typeof attrs.repoFile === "string") {
          code = readRepoFileFrom(repoRoot, attrs.repoFile);
          lang = sampleLanguage(attrs.repoFile);
        } else {
          throw new Error(`${where}: <Sample> needs file="…" or repoFile="…".`);
        }
        out.push(...fenced(code, lang, attrs.title));
        continue;
      }
      if (/^<ScreenshotPlaceholder\s+.*\/>$/.test(trimmed)) continue;
      const callout = /^<Callout(\s+.*?)?>$/.exec(trimmed);
      if (callout) {
        const attrs = parseAttributes(callout[1] ?? "", where);
        const label = CALLOUT_LABELS[attrs.variant ?? "note"] ?? "Note";
        const inner = trimBlankEdges(convert("</Callout>"));
        const heading = attrs.title ? `**${label}: ${attrs.title}**` : `**${label}:**`;
        out.push(`> ${heading}`, ">", ...inner.map((l) => (l === "" ? ">" : `> ${l}`)));
        continue;
      }
      const step = /^<Step\s+(.*?)>$/.exec(trimmed);
      if (step) {
        const attrs = parseAttributes(step[1], where);
        out.push(`## ${attrs.n}. ${attrs.title}`);
        out.push(...convert("</Step>"));
        continue;
      }
      if (/^<\/?[A-Za-z]/.test(trimmed)) {
        throw new Error(
          `${where}: unsupported component "${trimmed}". Teach lib/docs-source.mjs to convert it.`,
        );
      }
      const heading = /^(#{1,6}\s+.*?)\s*\[#[a-z0-9-]+\]\s*$/.exec(line);
      out.push((heading ? heading[1] : line).replace(/\]\(\/(?!\/)/g, `](${SITE_URL}/`));
    }
    if (closing) throw new Error(`${file}: missing ${closing}.`);
    if (inFence) throw new Error(`${file}: unclosed code fence.`);
    return out;
  }

  const result = convert(null).join("\n");
  return result.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Outputs

export function docUrl(slug) {
  return `${SITE_URL}/docs/${slug}`;
}

/** Builds `llms.txt`, `llms-full.txt` and `docs.json` from the web app's docs sources. */
export function buildDocsArtifacts(webRoot) {
  const { contentDir, samplesDir, repoRoot } = docsPaths(webRoot);
  const groups = groupDocs(loadDocs(contentDir)).map(({ group, items }) => ({
    group,
    items: items.map((doc) => ({
      ...doc,
      markdown: mdxToMarkdown(doc.body, {
        samplesDir,
        repoRoot,
        file: `content/docs/${doc.slug}.mdx`,
      }),
    })),
  }));
  const docs = groups.flatMap((group) => group.items);

  const intro =
    "Sendo (`@quami/sendo`) connects a Next.js + Supabase app to the official WhatsApp Cloud API: a typed client with AI agents, plus shadcn registry items for the webhook, the schema and a staff inbox. Your data stays in your database.";

  const index = [
    "# Sendo",
    "",
    `> ${intro}`,
    "",
    `Full text of every page, with code samples inlined: ${SITE_URL}/llms-full.txt`,
  ];
  for (const { group, items } of groups) {
    index.push("", `## ${group ?? "Docs"}`, "");
    for (const doc of items)
      index.push(`- [${doc.title}](${docUrl(doc.slug)}): ${doc.description}`);
  }

  const full = ["# Sendo", "", `> ${intro}`];
  for (const doc of docs) {
    full.push(
      "",
      "---",
      "",
      `# ${doc.title}`,
      "",
      `URL: ${docUrl(doc.slug)}`,
      "",
      `> ${doc.description}`,
      "",
      doc.markdown,
    );
  }

  const docsJson = {
    docs: docs.map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      ...(doc.group === undefined ? {} : { group: doc.group }),
      url: docUrl(doc.slug),
      // Anchor ids (incl. `[#id]` overrides) for `sendo mcp` search results.
      headings: extractHeadings(doc.body),
      body: doc.markdown,
    })),
  };

  return {
    slugs: docs.map((doc) => doc.slug),
    llmsTxt: `${index.join("\n")}\n`,
    llmsFullTxt: `${full.join("\n")}\n`,
    docsJson: `${JSON.stringify(docsJson, null, 2)}\n`,
  };
}
