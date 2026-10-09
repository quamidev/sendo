/**
 * `sendo mcp` E2E (AC-AD-2): spawns the BUILT CLI (`dist/cli.js mcp`) over stdio with the MCP
 * SDK client, the way Claude Code or Cursor run it, and calls every tool.
 *
 * Failure modes covered:
 * - the CLI writes anything but protocol messages to stdout (the client reports a parse error);
 * - a tool is missing or renamed (agents configured with the documented names break);
 * - docs/docs.json, dist/api.json or dist/registry.json is not where the bundled CLI looks;
 * - search ranks the wrong page for an obvious query, or returns a ref read_doc can't open;
 * - the registry catalog drifts from registry/registry.json or drops an item's AGENTS.md;
 * - api_reference can't follow `sendo.<namespace>.<method>` or gives no next step on a typo;
 * - run_doctor ignores --config, or a failing check comes back without a fix;
 * - the server doesn't exit when the client goes away.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CheckResult } from "../../src/cli/doctor";

const PACKAGE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_DIR, "../..");
const CLI = join(PACKAGE_DIR, "dist/cli.js");
const FIXTURE = join(PACKAGE_DIR, "test/fixtures/mcp/memory-adapter.mjs");
const SECRET = "app-secret-must-never-show-1234";

interface RegistryManifest {
  items: { name: string; files: { path: string; target?: string }[] }[];
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text?: string }[];
  return content.map((part) => part.text ?? "").join("\n");
}

describe("sendo mcp (built CLI over stdio)", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let cwd: string;
  const transportErrors: Error[] = [];

  beforeAll(async () => {
    cwd = mkdtempSync(join(tmpdir(), "sendo-mcp-"));
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI, "mcp", "--config", FIXTURE],
      cwd,
      env: {
        ...getDefaultEnvironment(),
        SENDO_META_APP_SECRET: SECRET,
        SENDO_VERIFY_TOKEN: "verify-token-value",
        SUPABASE_URL: "http://127.0.0.1:1",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value",
      },
      stderr: "pipe",
    });
    transport.onerror = (error) => transportErrors.push(error);
    client = new Client({ name: "sendo-mcp-e2e", version: "1.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const text = textOf(result);
    expect(text).not.toContain(SECRET);
    return { text, isError: result.isError === true };
  }

  it("identifies itself with the package version and exposes the six tools", async () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
      version: string;
    };
    expect(client.getServerVersion()).toMatchObject({ name: "sendo", version: pkg.version });
    expect(client.getInstructions()).toContain("search_docs");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "api_reference",
      "get_registry_item",
      "list_registry_items",
      "read_doc",
      "run_doctor",
      "search_docs",
    ]);
    for (const tool of tools) expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
  });

  it("lists every item of registry/registry.json with its install command", async () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "registry/registry.json"), "utf8"),
    ) as RegistryManifest;
    const { text, isError } = await call("list_registry_items");
    expect(isError).toBe(false);
    const items = JSON.parse(text) as { name: string; install: string; agentsPath: string }[];
    expect(items.map((item) => item.name)).toEqual(manifest.items.map((item) => item.name));
    for (const item of items) {
      expect(item.install).toBe(`npx shadcn@latest add @sendo/${item.name}`);
      expect(item.agentsPath, item.name).toMatch(/^components\/sendo\/[a-z-]+\/AGENTS\.md$/);
    }
  });

  it("finds Embedded Signup and reads the page and the section it points to", async () => {
    const search = await call("search_docs", { query: "embedded signup" });
    expect(search.isError).toBe(false);
    const refs = [...search.text.matchAll(/read_doc: "([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]).toMatch(/^embedded-signup(#|$)/);
    expect(search.text).toContain("https://sendo.dev/docs/embedded-signup");

    const page = await call("read_doc", { slug: "embedded-signup" });
    expect(page.text).toContain("# Embedded Signup");
    expect(page.text).toContain("completeEmbeddedSignup");

    const withAnchor = refs.find((ref) => ref.includes("#"));
    expect(withAnchor).toBeDefined();
    const section = await call("read_doc", { slug: withAnchor });
    expect(section.isError).toBe(false);
    expect(section.text.length).toBeLessThan(page.text.length);

    const unknown = await call("read_doc", { slug: "embeded-signup" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("embedded-signup");
  });

  it("returns sendo-inbox with its files and the AGENTS.md that ships with it", async () => {
    const { text, isError } = await call("get_registry_item", { name: "sendo-inbox" });
    expect(isError).toBe(false);
    expect(text).toContain('"target": "app/(protected)/inbox/page.tsx"');
    expect(text).toContain("AGENTS.md (installed at components/sendo/inbox/AGENTS.md)");
    const agents = readFileSync(join(REPO_ROOT, "registry/items/sendo-inbox/AGENTS.md"), "utf8");
    expect(text).toContain(agents);

    const prefixed = await call("get_registry_item", { name: "@sendo/sendo-inbox" });
    expect(prefixed.text).toContain(agents);
    const unknown = await call("get_registry_item", { name: "sendo-chat" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("sendo-inbox");
  });

  it("answers signatures from the installed .d.ts, through instance paths, with hints on typos", async () => {
    const create = await call("api_reference", { symbol: "createSendo" });
    expect(create.text).toContain('import { createSendo } from "@quami/sendo";');
    expect(create.text).toContain("declare function createSendo(config: SendoConfig): Sendo;");

    const reply = await call("api_reference", { symbol: "sendo.inbox.reply" });
    expect(reply.isError).toBe(false);
    expect(reply.text).toContain("# Sendo.inbox.reply");
    expect(reply.text).toContain("Member of `InboxApi`");
    expect(reply.text).toMatch(/reply\(/);

    const memory = await call("api_reference", { symbol: "memoryAdapter" });
    expect(memory.text).toContain('from "@quami/sendo/adapters/memory"');

    const typo = await call("api_reference", { symbol: "createSendoo" });
    expect(typo.isError).toBe(true);
    expect(typo.text).toContain("Did you mean: createSendo");

    const badMember = await call("api_reference", { symbol: "sendo.inbox.replay" });
    expect(badMember.isError).toBe(true);
    expect(badMember.text).toContain("reply");
  });

  it("runs doctor read-only on the --config adapter; every failing check carries a fix", async () => {
    const { text, isError } = await call("run_doctor");
    expect(isError).toBe(false);
    const results = JSON.parse(text) as CheckResult[];
    expect(results.find((r) => r.id === "tables")?.ok).toBe(true);
    expect(results.find((r) => r.id === "schema-version")?.ok).toBe(true);
    const accounts = results.find((r) => r.id === "accounts");
    expect(accounts?.ok).toBe(false);
    expect(accounts?.fix).toMatchObject({
      kind: "config",
      docsUrl: expect.stringMatching(/^https:\/\/sendo\.dev\/docs\//) as unknown,
    });
    for (const result of results.filter((r) => !r.ok)) {
      expect(result.fix?.detail.length, result.id).toBeGreaterThan(10);
    }
  });

  it("wrote nothing but protocol messages to stdout", () => {
    expect(transportErrors).toEqual([]);
  });

  it("exits with code 0 when stdin closes (the client went away)", async () => {
    const child = spawn(process.execPath, [CLI, "mcp"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<number | null>((done) =>
      child.once("exit", (code) => {
        done(code);
      }),
    );
    child.stdin.end();
    const timeout = new Promise<"timeout">((done) =>
      setTimeout(() => {
        done("timeout");
      }, 10_000),
    );
    const outcome = await Promise.race([exited, timeout]);
    if (outcome === "timeout") child.kill("SIGKILL");
    expect(outcome).toBe(0);
  }, 15_000);
});
