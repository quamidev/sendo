import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { lookupApiSymbol, type ApiReferenceData } from "./api-reference";
import type { CheckResult } from "./doctor";
import { createDocsIndex, splitSections, type DocPage, type DocsIndex } from "./docs-search";

/**
 * `sendo mcp`: a stdio MCP server for coding agents, answering from the files that ship with the
 * installed package version: `docs/docs.json` (docs pages), `dist/api.json` (exports, from the
 * `.d.ts`) and `dist/registry.json` (registry items + AGENTS.md). `@modelcontextprotocol/sdk` is
 * imported dynamically here, so only the CLI bundle loads it.
 */

export interface RegistryCatalogItem {
  name: string;
  type: string;
  title: string;
  description: string;
  install: string;
  dependencies: string[];
  registryDependencies: string[];
  envVars: string[];
  files: { type: string; target: string }[];
  postInstall: string;
  agentsPath: string | null;
  agents: string | null;
}

export interface RegistryCatalog {
  name: string;
  homepage: string;
  items: RegistryCatalogItem[];
}

export interface AgentData {
  docs: DocPage[];
  api: ApiReferenceData | null;
  registry: RegistryCatalog | null;
  /** Why a file could not be read, keyed by file, for tool errors. */
  missing: Record<string, string>;
}

export interface DoctorArgs {
  account?: string;
  url?: string;
}

export interface McpServerOptions {
  stdin: Readable;
  stdout: Writable;
  version: string;
  data: AgentData;
  /** Read-only doctor run; returns the same results as `sendo doctor --json`. */
  runDoctor: (args: DoctorArgs) => Promise<CheckResult[]>;
  /** Scrubs secrets from every tool response. */
  redact: (text: string) => string;
}

/** The `@quami/sendo` package directory that contains this file (`dist/cli.js` or `src/cli/mcp.ts`). */
export function findPackageRoot(from: string = import.meta.url): string | null {
  let dir = dirname(fileURLToPath(from));
  for (let i = 0; i < 4; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "@quami/sendo") {
          return dir;
        }
      } catch {
        // keep walking up
      }
    }
    dir = dirname(dir);
  }
  return null;
}

function readJson(file: string, missing: Record<string, string>, hint: string): unknown {
  if (!existsSync(file)) {
    missing[file] = hint;
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    missing[file] = `${error instanceof Error ? error.message : String(error)}. ${hint}`;
    return null;
  }
}

export function loadAgentData(root: string | null = findPackageRoot()): AgentData {
  const missing: Record<string, string> = {};
  if (root === null) {
    missing["@quami/sendo"] = "Could not find the package directory of @quami/sendo.";
    return { docs: [], api: null, registry: null, missing };
  }
  const rebuild = "Reinstall @quami/sendo (or run `pnpm build` in its repo).";
  const docs = readJson(join(root, "docs", "docs.json"), missing, rebuild) as {
    docs?: DocPage[];
  } | null;
  return {
    docs: docs?.docs ?? [],
    api: readJson(join(root, "dist", "api.json"), missing, rebuild) as ApiReferenceData | null,
    registry: readJson(
      join(root, "dist", "registry.json"),
      missing,
      rebuild,
    ) as RegistryCatalog | null,
    missing,
  };
}

interface ToolText {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const SERVER_INSTRUCTIONS = `Sendo (@quami/sendo): WhatsApp Cloud API for Next.js + Supabase apps, with AI agents, a team inbox and shadcn registry items. Everything here matches the installed package version.
- Prose and examples: search_docs, then read_doc with a slug (or slug#anchor) from the results.
- Exact signatures: api_reference (createSendo, InboxApi.reply, sendo.inbox.reply, memoryAdapter …).
- UI and routes copied into the app: list_registry_items, then get_registry_item for files, env vars and its AGENTS.md (what to edit, what not to touch, how to verify).
- Setup problems: run_doctor returns every check as JSON; each failing check has fix { kind, detail, docsUrl }.`;

function sectionText(page: DocPage, anchor: string): string | null {
  const sections = splitSections(page);
  const start = sections.findIndex((section) => section.anchor === anchor);
  const first = sections[start];
  if (first === undefined) return null;
  const level = (page.headings ?? []).find((h) => h.id === anchor)?.level ?? 2;
  const parts = [`## ${first.heading ?? ""}`, "", first.text];
  for (const section of sections.slice(start + 1)) {
    const sectionLevel = (page.headings ?? []).find((h) => h.id === section.anchor)?.level ?? 2;
    if (sectionLevel <= level) break;
    parts.push("", `### ${section.heading ?? ""}`, "", section.text);
  }
  return parts.join("\n");
}

function findItem(catalog: RegistryCatalog, name: string): RegistryCatalogItem | undefined {
  const wanted = name
    .trim()
    .replace(/^@sendo\//, "")
    .toLowerCase();
  // Pre-0.1.0 names (`sendo-inbox`) still resolve. TODO(0.2.0): remove
  const legacy = wanted.replace(/^sendo-/, "");
  return catalog.items.find((item) => item.name === wanted || item.name === legacy);
}

/** The tools as plain functions (the MCP server below only wires them). */
export function createAgentTools(options: Omit<McpServerOptions, "stdin" | "stdout" | "version">) {
  const { data } = options;
  let index: DocsIndex | null = null;
  const docsIndex = () => (index ??= createDocsIndex(data.docs));
  const text = (value: string, isError = false): ToolText => ({
    content: [{ type: "text", text: options.redact(value) }],
    ...(isError ? { isError: true } : {}),
  });
  const unavailable = (what: string) =>
    text(
      `${what} is not available in this install: ${Object.entries(data.missing)
        .map(([file, why]) => `${file} (${why})`)
        .join("; ")}`,
      true,
    );
  const slugs = () => data.docs.map((page) => page.slug).join(", ");

  return {
    search_docs({ query, limit }: { query: string; limit?: number }): ToolText {
      if (data.docs.length === 0) return unavailable("docs/docs.json");
      const hits = docsIndex().search(query, limit ?? 5);
      if (hits.length === 0) {
        return text(
          `No docs section matches "${query}". Try other words (the docs are in English), or read_doc one of: ${slugs()}.`,
          true,
        );
      }
      return text(
        hits
          .map(({ section, snippet }, i) => {
            const ref =
              section.anchor === null ? section.slug : `${section.slug}#${section.anchor}`;
            const where =
              section.heading === null
                ? section.pageTitle
                : `${section.pageTitle} › ${section.heading}`;
            return `${String(i + 1)}. ${where}\n   read_doc: "${ref}" · ${section.url}\n   ${snippet}`;
          })
          .join("\n\n"),
      );
    },

    read_doc({ slug }: { slug: string }): ToolText {
      if (data.docs.length === 0) return unavailable("docs/docs.json");
      const [pageSlug = "", anchor] = slug
        .trim()
        .replace(/^https?:\/\/[^/]+\/docs\//, "")
        .replace(/^\/?docs\//, "")
        .split("#");
      const page = data.docs.find((candidate) => candidate.slug === pageSlug);
      if (page === undefined) {
        return text(`No docs page "${pageSlug}". Pages: ${slugs()}. Or use search_docs.`, true);
      }
      const header = `# ${page.title}\n\nURL: ${page.url}\n\n> ${page.description}\n\n`;
      if (anchor === undefined || anchor === "") return text(`${header}${page.body}`);
      const section = sectionText(page, anchor);
      if (section === null) {
        const anchors = (page.headings ?? []).map((h) => h.id).join(", ");
        return text(`"${page.slug}" has no section #${anchor}. Sections: ${anchors}.`, true);
      }
      return text(`${header}${section}`);
    },

    api_reference({ symbol }: { symbol: string }): ToolText {
      if (data.api === null) return unavailable("dist/api.json");
      const result = lookupApiSymbol(data.api, symbol);
      return text(result.text, !result.found);
    },

    list_registry_items(): ToolText {
      if (data.registry === null) return unavailable("dist/registry.json");
      return text(
        JSON.stringify(
          data.registry.items.map(({ name, title, description, install, agentsPath }) => ({
            name,
            title,
            description,
            install,
            agentsPath,
          })),
          null,
          2,
        ),
      );
    },

    get_registry_item({ name }: { name: string }): ToolText {
      if (data.registry === null) return unavailable("dist/registry.json");
      const item = findItem(data.registry, name);
      if (item === undefined) {
        const names = data.registry.items.map((candidate) => candidate.name).join(", ");
        return text(`No registry item "${name}". Items: ${names}.`, true);
      }
      const { agents, ...rest } = item;
      return text(
        [
          JSON.stringify(rest, null, 2),
          "",
          "---",
          "",
          agents === null
            ? "This item has no AGENTS.md."
            : `AGENTS.md (installed at ${item.agentsPath ?? "?"}):\n\n${agents}`,
        ].join("\n"),
      );
    },

    async run_doctor(args: DoctorArgs): Promise<ToolText> {
      try {
        return text(JSON.stringify(await options.runDoctor(args), null, 2));
      } catch (error) {
        return text(
          `doctor could not run: ${error instanceof Error ? error.message : String(error)}`,
          true,
        );
      }
    },
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

/** Serves the tools over stdio until stdin ends. */
export async function runMcpServer(options: McpServerOptions): Promise<void> {
  const [{ McpServer }, { StdioServerTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
  ]);
  const tools = createAgentTools(options);
  const server = new McpServer(
    { name: "sendo", version: options.version },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "search_docs",
    {
      title: "Search the Sendo docs",
      description:
        "BM25 search over every Sendo docs page (code samples inlined). Returns the best sections with a read_doc reference and URL.",
      inputSchema: {
        query: z.string().min(1).describe("Words to look for, e.g. 'embedded signup'"),
        limit: z.number().int().min(1).max(20).optional().describe("Results to return (default 5)"),
      },
      annotations: READ_ONLY,
    },
    (args) => tools.search_docs(args),
  );
  server.registerTool(
    "read_doc",
    {
      title: "Read a Sendo docs page",
      description:
        "Full Markdown of one docs page by slug (e.g. 'quickstart'), or one section with 'slug#anchor' as returned by search_docs.",
      inputSchema: { slug: z.string().min(1).describe("Page slug, optionally with #anchor") },
      annotations: READ_ONLY,
    },
    (args) => tools.read_doc(args),
  );
  server.registerTool(
    "api_reference",
    {
      title: "Look up a Sendo export",
      description:
        "Declaration, JSDoc and import path of an export of @quami/sendo (any subpath), generated from the installed .d.ts. Accepts 'createSendo', 'InboxApi.reply' or 'sendo.inbox.reply'.",
      inputSchema: { symbol: z.string().min(1).describe("Export name or dotted member path") },
      annotations: READ_ONLY,
    },
    (args) => tools.api_reference(args),
  );
  server.registerTool(
    "list_registry_items",
    {
      title: "List Sendo registry items",
      description:
        "Every shadcn registry item (@sendo/<name>) with its description, install command and where its AGENTS.md lands.",
      annotations: READ_ONLY,
    },
    () => tools.list_registry_items(),
  );
  server.registerTool(
    "get_registry_item",
    {
      title: "Get a Sendo registry item",
      description:
        "One registry item: files and install targets, dependencies, env vars, post-install notes and its AGENTS.md (files safe to edit, what not to touch, how it connects, how to verify).",
      inputSchema: {
        name: z.string().min(1).describe("Item name, e.g. 'inbox' or '@sendo/inbox'"),
      },
      annotations: READ_ONLY,
    },
    (args) => tools.get_registry_item(args),
  );
  server.registerTool(
    "run_doctor",
    {
      title: "Run sendo doctor",
      description:
        "Read-only health check of the app in the working directory (env vars, tables, schema version, storage, numbers, Meta token/subscription/templates, billing, webhook URL). Same JSON as `sendo doctor --json`; every failing check has fix { kind, detail, docsUrl }.",
      inputSchema: {
        account: z.string().optional().describe("Only this account (id or phone_number_id)"),
        url: z.url().optional().describe("Public webhook URL to test the verify challenge"),
      },
      annotations: { ...READ_ONLY, openWorldHint: true },
    },
    (args) => tools.run_doctor(args),
  );

  const transport = new StdioServerTransport(options.stdin, options.stdout);
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve;
  });
  options.stdin.once("end", () => {
    void server.close();
  });
  await server.connect(transport);
  await closed;
}
