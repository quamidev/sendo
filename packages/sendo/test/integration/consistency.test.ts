/**
 * Cross-cutting consistency checks (SND-6.1). The memory vs Supabase parity check lives in
 * pipeline-parity.supabase.test.ts so `pnpm test:supabase` picks it up.
 *
 * [CC-ERR-1] Every namespace throws AccountNotFoundError for an unknown or inactive account
 *            (send.*, templates.sync, templates.list); inbox.reply throws ACCOUNT_STATE for a
 *            disconnected number (AC-IB-8) and AccountNotFoundError for a deleted one.
 *            accounts.*, inbox.list/count, snippets, rules, broadcasts, metrics.* and
 *            links.create/sources throw it for an unknown number or one of another tenant.
 * [CC-ERR-2] Every namespace throws RecordNotFoundError for an unknown conversation id
 *            (inbox.*, conversations.*); conversations.get returns null like every adapter
 *            `get`. snippets, tags, rules, broadcasts and inbox drafts/tags name the entity and
 *            the id, and another tenant's rows are "not found", never FORBIDDEN.
 * [CC-FBD-1] Every method of the public `Sendo` type that takes an actor (read from the built
 *            types, not a hand list) throws ForbiddenError `{ capability, role: null }` for a
 *            null-role actor without writing anything, and `{ capability, role }` for a role the
 *            AC-RL-2 matrix doesn't allow; admins are never refused.
 * [CC-TOK-1] No resolved token, app secret, Connect API key, signing secret or signup code
 *            reaches logs, error `toJSON()`/inspect, stored rows or event payloads across a full
 *            scenario (signup, inbound, send, Meta failure, doctor --json), meta-direct and Connect.
 * [CC-REG-1] Registry-built JSON matches the source files under registry/items.
 * [CC-REG-2] Every registry item builds, ships an AGENTS.md (UI items also MOTION.md), and
 *            registry.json stays Prettier-formatted.
 * [CC-REG-NAMES] Every documented `shadcn add` command (docs, site pages and components, i18n
 *            dictionaries, every AGENTS.md and README.md, changesets) uses `npx shadcn add`, names
 *            only items that exist in registry.json and never a legacy `sendo-*` name.
 * [CC-SCH-1] The schema migration mirrors (root supabase/, playground) are byte-identical.
 * [CC-SCH-2] The mirrors hold exactly the canonical files; SENDO_SCHEMA_VERSION = the highest
 *            sendo_schema_meta seed = the last SCHEMA_MIGRATIONS entry; schema ships them all.
 * [CC-REL-1] Release and CI guards nobody notices by running the app: the CI `supabase` job
 *            starts Supabase and runs schema:check, test:supabase (SENDO_REQUIRE_SUPABASE=1) and
 *            test:e2e, uploading the report on every run (AC-CI-1, AC-CI-3); every schema migration
 *            ships a changeset that says to copy it into supabase/migrations/ (AC-SV-2); the
 *            package is MIT with a LICENSE and public publish access (AC-PB-1); the dangling
 *            references AC-SV-3 removed stay removed.
 * [CC-ENT-1] The main entry and memory adapter dist don't import next, @supabase/supabase-js,
 *            vitest, @modelcontextprotocol/sdk, jiti, drizzle-orm, @prisma/client or @aws-sdk/*;
 *            the client-safe subpaths (snippets, rules) import nothing but zod.
 * [CC-RN-1]  No tracked file outside CHANGELOG.md and attachments/ still uses a pre-Sendo name
 *            (AC-RN-5). Skips when git is unavailable, except in CI where it fails.
 *
 * Languages, site and launch spec (SNL-7.3), mapped in test/acceptance-map-launch.json:
 * [CC-LAUNCH-QC1] A versioned (or new, not ignored) file still names the removed hosted transport
 *            or its API key (AC-QC-1; `docs.json` included). Skips without git, except in CI.
 * [CC-LAUNCH-QC2] The built entry still exports the hosted transport or its options type, or lost
 *            `metaDirect` / the `Transport` interface's members (AC-QC-2).
 * [CC-LAUNCH-QC3] The roadmap page is in the docs nav and describes a hosted mode (AC-QC-3).
 * [CC-LAUNCH-TS] `scripts/test-summary.mjs` against fixture `skips.json` files: prints something
 *            when nothing was skipped, misses a workspace or a reason, keeps a stale file from an
 *            earlier run, or changes the command's exit code (AC-TS-1, AC-TS-2).
 * [CC-LAUNCH-EXPORT] For one snapshot, `sendo.accounts.export`, `sendo accounts export --out` and
 *            the numbers item's download route (the registry module itself, driven in-process)
 *            produce different bytes; or a non-admin gets anything but FORBIDDEN from the op and
 *            403 with no body from the route; or an unknown number isn't ACCOUNT_NOT_FOUND / 404 /
 *            exit 1 everywhere (AC-DN-2, AC-DN-3, AC-DN-4).
 * [CC-LAUNCH-RR1] A repository URL (package metadata, READMEs, site, docs) points anywhere but
 *            github.com/quamidev/sendo (AC-RR-1, code part; the GitHub rename itself is manual).
 * [CC-LAUNCH-DOCS] The Languages page (in the docs index) lacks "Edit a string" or "Add a language",
 *            or leaves out a UI item's `<item>Strings` object, so a third language misses it
 *            (AC-RS-5).
 * [CC-LAUNCH-MIRROR] A registry file installed in the playground differs from its source (after
 *            the header comment shadcn strips), or is missing, except the playground's
 *            APP_OWNED_FILES (read from scripts/registry-install.mjs).
 */
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { http, HttpResponse } from "msw";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SendoAdapter } from "../../src/adapters/types";
import { textWebhook } from "../../src/agents/test-helpers";
import { EXIT_FAILURE, EXIT_OK, runCli, type CliDeps } from "../../src/cli/main";
import {
  SENTINEL_TOKEN,
  SERVICE_ROLE_KEY,
  WEBHOOK_URL as CLI_WEBHOOK_URL,
  cliAccountInput,
  doctorEnv,
  graphHandlers,
} from "../../src/cli/test-helpers";
import {
  GRAPH,
  TOKENS,
  acceptSends,
  accountInput,
  makeClient,
  openConversation,
  useGraphServer,
  type ClientOptions,
} from "../../src/core/test-utils";
import { AccountNotFoundError, ForbiddenError, RecordNotFoundError } from "../../src/errors/errors";
import type { ResolveRole } from "../../src/team/config";
import { can, type Actor, type Role } from "../../src/team/permissions";
import { SCHEMA_MIGRATIONS, SENDO_SCHEMA_VERSION } from "../../src/utils/schema-version";
import { findBareImports, findForbiddenImports } from "../support/entry-imports";
import { FIXTURE_IDS } from "../support/fixtures";
import { SKIP_MESSAGES } from "../support/skip-summary-reporter";
import {
  WEBHOOK_URL,
  createHarness,
  dumpState,
  errorSurface,
  freshFixture,
  mediaHandlers,
  signedPost,
} from "./harness";

// [CC-LAUNCH-EXPORT] drives the numbers item's export route module as the app runs it: its
// `@/lib/sendo` and `numbers-config` imports are this test's client and signed-in user.
const routeApp = vi.hoisted((): { sendo: unknown; user: { userId: string; tenantId: string } } => ({
  sendo: undefined,
  user: { userId: "", tenantId: "" },
}));
vi.mock("@/lib/sendo", () => ({
  get sendo() {
    return routeApp.sendo;
  },
}));
vi.mock(
  "../../../../registry/items/numbers/app/(protected)/inbox/numbers/numbers-config.ts",
  () => ({ requireUser: () => Promise.resolve(routeApp.user) }),
);

const graph = useGraphServer();
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const PACKAGE_DIST = resolve(import.meta.dirname, "../../dist");
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const PHONE = "+50255550001";
const ADMIN: Actor = { userId: "alma", tenantId: "tenant-a", role: "admin", queues: [] };
// The `[a]` / `[A]` classes keep this pattern from matching its own source line.
const LEGACY_NAMES = "w[a]-li|w[a]_li|W[A]_LI|createWhats[A]pp|WhatsApp[A]dapter|--w[a]-";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("Cross-cutting consistency", () => {
  it("[CC-ERR-1] AccountNotFoundError for unknown and inactive accounts in every namespace", async () => {
    const h = await createHarness();
    const inactive = await h.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_OFF", wabaId: "WABA_OFF" }),
    );
    const { conversation: inactiveConversation } = await openConversation(h.ctx, inactive, PHONE);
    const ghost = await h.adapter.accounts.insert(
      accountInput({ phoneNumberId: "PN_GHOST", wabaId: "WABA_G" }),
    );
    const { conversation: ghostConversation } = await openConversation(h.ctx, ghost, PHONE);
    const stored = h.adapter.__state.accounts.get(inactive.id);
    if (!stored) throw new Error("missing account");
    stored.active = false;
    h.adapter.__state.accounts.delete(ghost.id);

    for (const account of ["PN_NOPE", UNKNOWN_ID, inactive.id, "PN_OFF", ghost.id]) {
      const errors = [
        await rejection(h.sendo.send.text(PHONE, "hola", { account })),
        await rejection(
          h.sendo.send.media(PHONE, { type: "image", url: "https://x.dev/a.jpg" }, { account }),
        ),
        await rejection(
          h.sendo.send.buttons(
            PHONE,
            { body: "x", buttons: [{ id: "a", title: "A" }] },
            { account },
          ),
        ),
        await rejection(h.sendo.send.template(PHONE, "t", { account, language: "es" })),
        await rejection(h.sendo.templates.sync({ account })),
        await rejection(h.sendo.templates.list({ account })),
      ];
      for (const error of errors) {
        expect(error, `account ${account}`).toBeInstanceOf(AccountNotFoundError);
        expect(error).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
      }
    }
    // The inbox keeps reading a disconnected number's conversations; sending says why it can't
    // (AC-IB-8: ACCOUNT_STATE), and a deleted account is not found.
    const inactiveReply = await rejection(
      h.sendo.inbox.reply(
        inactiveConversation.id,
        { kind: "text", body: "hola" },
        { actor: ADMIN },
      ),
    );
    expect(inactiveReply).toMatchObject({ code: "ACCOUNT_STATE", state: "inactive" });
    const ghostReply = await rejection(
      h.sendo.inbox.reply(ghostConversation.id, { kind: "text", body: "hola" }, { actor: ADMIN }),
    );
    expect(ghostReply).toBeInstanceOf(AccountNotFoundError);
    expect(graph.requests).toHaveLength(0);
  });

  it("[CC-ERR-2] RecordNotFoundError for unknown conversation ids in every namespace", async () => {
    const h = await createHarness();
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      const errors = [
        await rejection(h.sendo.inbox.thread(id, { actor: ADMIN })),
        await rejection(h.sendo.inbox.get(id, { actor: ADMIN })),
        await rejection(h.sendo.inbox.markSeen(id, { actor: ADMIN })),
        await rejection(h.sendo.inbox.reply(id, { kind: "text", body: "x" }, { actor: ADMIN })),
        await rejection(h.sendo.inbox.note(id, "x", { actor: ADMIN })),
        await rejection(h.sendo.inbox.take(id, { actor: ADMIN })),
        await rejection(h.sendo.inbox.pauseAgent(id, true, { actor: ADMIN })),
        await rejection(h.sendo.conversations.pauseAgent(id, true)),
        await rejection(h.sendo.conversations.handoff(id, { reason: "x" })),
        await rejection(h.sendo.conversations.returnToAgent(id)),
        await rejection(h.sendo.conversations.close(id)),
        await rejection(h.sendo.conversations.assign(id, "u")),
        await rejection(h.sendo.conversations.windowStatus(id)),
      ];
      for (const error of errors) {
        expect(error).toBeInstanceOf(RecordNotFoundError);
        expect(error).toMatchObject({ code: "RECORD_NOT_FOUND", entity: "conversation", id });
      }
      expect(await h.sendo.conversations.get(id)).toBeNull();
    }
    await expect(h.sendo.events.reprocess(UNKNOWN_ID)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  describe("[CC-REG-1] registry-built JSON matches the source files", () => {
    let outDir = "";
    beforeAll(() => {
      // Built into a private temp dir (same shadcn invocation as scripts/registry-build.mjs) so the
      // check never races turbo's registry#build rewriting apps/web/registry-dist.
      outDir = mkdtempSync(join(tmpdir(), "sendo-registry-"));
      const pkg = JSON.parse(
        readFileSync(join(REPO_ROOT, "node_modules/shadcn/package.json"), "utf8"),
      ) as {
        bin: string | Record<string, string>;
      };
      const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin.shadcn ?? "");
      const result = spawnSync(
        process.execPath,
        [
          join(REPO_ROOT, "node_modules/shadcn", bin),
          "build",
          "registry/registry.json",
          "-o",
          outDir,
          "-c",
          REPO_ROOT,
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      if (result.status !== 0)
        throw new Error(`shadcn build failed:\n${result.stdout}\n${result.stderr}`);
    }, 120_000);
    afterAll(() => {
      if (outDir) rmSync(outDir, { recursive: true, force: true });
    });

    it("[CC-REG-1] every item file's built content equals its source", () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, "registry/registry.json"), "utf8"),
      ) as {
        items: { name: string; files: { path: string }[] }[];
      };
      expect(manifest.items.length).toBeGreaterThanOrEqual(3);
      let compared = 0;
      for (const item of manifest.items) {
        const built = JSON.parse(readFileSync(join(outDir, `${item.name}.json`), "utf8")) as {
          name: string;
          files: { path: string; content: string }[];
        };
        expect(built.name).toBe(item.name);
        expect(built.files.map((f) => f.path)).toEqual(item.files.map((f) => f.path));
        for (const file of built.files) {
          expect(file.path.startsWith("registry/items/")).toBe(true);
          const source = readFileSync(join(REPO_ROOT, file.path), "utf8");
          expect(file.content, `${item.name}: ${file.path}`).toBe(source);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(10);
    });

    it("[CC-REG-2] every item builds and ships AGENTS.md; UI items also MOTION.md; registry.json is Prettier-formatted", async () => {
      const manifestPath = join(REPO_ROOT, "registry/registry.json");
      const text = readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(text) as {
        items: { name: string; files: { path: string; target?: string }[] }[];
      };
      const built = readdirSync(outDir).filter((f) => f.endsWith(".json"));
      expect(manifest.items.length).toBeGreaterThanOrEqual(10);
      for (const item of manifest.items) {
        expect(built, `${item.name} did not build`).toContain(`${item.name}.json`);
        const paths = item.files.map((f) => f.path);
        const agents = paths.find((p) => p === `registry/items/${item.name}/AGENTS.md`);
        expect(agents, `${item.name} lists no AGENTS.md`).toBeDefined();
        expect(existsSync(join(REPO_ROOT, agents ?? "")), `${item.name}/AGENTS.md`).toBe(true);
        if (paths.some((p) => p.endsWith(".tsx"))) {
          const motion = `registry/items/${item.name}/MOTION.md`;
          expect(paths, `${item.name} has UI but lists no MOTION.md`).toContain(motion);
          expect(existsSync(join(REPO_ROOT, motion)), motion).toBe(true);
        }
      }
      // Someone (or a tool) rewriting the manifest in another style fails here, not in review.
      const prettier = await import("prettier");
      const options = (await prettier.resolveConfig(manifestPath)) ?? {};
      expect(await prettier.check(text, { ...options, filepath: manifestPath })).toBe(true);
    });
  });

  it("[CC-SCH-1] the schema migration mirrors are byte-identical to the registry item", () => {
    const canonicalDir = join(REPO_ROOT, "registry/items/schema/supabase/migrations");
    const mirrors = [
      join(REPO_ROOT, "supabase/migrations"),
      join(REPO_ROOT, "apps/playground/supabase/migrations"),
    ];
    const files = readdirSync(canonicalDir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
    for (const mirror of mirrors) {
      for (const file of files) {
        const copy = join(mirror, file);
        expect(existsSync(copy), copy).toBe(true);
        expect(readFileSync(copy).equals(readFileSync(join(canonicalDir, file))), copy).toBe(true);
      }
    }
    const playground = "20261010100000_playground.sql";
    expect(
      readFileSync(join(REPO_ROOT, "supabase/migrations", playground)).equals(
        readFileSync(join(REPO_ROOT, "apps/playground/supabase/migrations", playground)),
      ),
    ).toBe(true);
  });

  it.each(["index.js", "index.cjs", "adapters/memory/index.js", "adapters/memory/index.cjs"])(
    "[CC-ENT-1] dist/%s does not import optional peers or CLI-only dependencies",
    (file) => {
      const entry = join(PACKAGE_DIST, file);
      expect(existsSync(entry), `${entry} missing, run the build first`).toBe(true);
      expect(findForbiddenImports(entry)).toEqual([]);
    },
  );

  it.each(["snippets/index.js", "snippets/index.cjs", "rules/index.js", "rules/index.cjs"])(
    "[CC-ENT-1] client-safe dist/%s imports nothing but zod",
    (file) => {
      const entry = join(PACKAGE_DIST, file);
      expect(existsSync(entry), `${entry} missing, run the build first`).toBe(true);
      expect(findBareImports(entry).filter(({ specifier }) => specifier !== "zod")).toEqual([]);
    },
  );

  it("[CC-RN-1] no legacy pre-Sendo names outside CHANGELOG.md and attachments/", (ctx) => {
    const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (git.error || git.status !== 0) {
      if (process.env.CI) throw new Error("[CC-RN-1] needs git in CI; it is not available.");
      ctx.skip("[CC-RN-1] skipped: git is not available or this is not a git checkout.");
    }
    const result = spawnSync(
      "git",
      [
        "grep",
        "-nE",
        LEGACY_NAMES,
        "--",
        ".",
        ":(exclude,glob)**/CHANGELOG.md",
        ":(exclude,glob)**/attachments/**",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    // git grep: 0 = matches, 1 = no matches, anything else = error.
    expect(result.status, result.stderr).not.toBeGreaterThan(1);
    expect(result.stdout.split("\n").filter(Boolean)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ [CC-REG-NAMES] */

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "registry-dist",
  "test-results",
  "coverage",
]);

function walk(dir: string, keep: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...walk(join(dir, entry.name), keep));
    } else if (keep(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function documentedFiles(): string[] {
  const web = (sub: string, keep: (file: string) => boolean) =>
    walk(join(REPO_ROOT, "apps/web", sub), keep);
  const source = (file: string) => /\.(tsx?|mdx?)$/.test(file);
  return [
    ...web("content/docs", (file) => file.endsWith(".mdx")),
    ...web("app", source),
    ...web("components", source),
    ...web("lib/i18n", source),
    ...walk(join(REPO_ROOT, ".changeset"), (file) => file.endsWith(".md")),
    ...walk(REPO_ROOT, (file) => file === "AGENTS.md" || file === "README.md"),
  ];
}

/** `shadcn add` and its arguments, up to the end of the code span, string or JSX tag; `<name>` is a placeholder. */
const SHADCN_ADD = /((?:npx\s+)?shadcn(?:@[\w.-]+)?\s+add)\b((?:[^\n`"'<]|<[a-z-]+>)*)/g;

describe("[CC-REG-NAMES] documented install commands", () => {
  it("[CC-REG-NAMES] every documented shadcn add command names current @sendo items with npx shadcn add", () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "registry/registry.json"), "utf8"),
    ) as {
      items: { name: string }[];
    };
    const names = new Set(manifest.items.map((item) => item.name));
    const problems: string[] = [];
    let sendoCommands = 0;
    for (const file of documentedFiles()) {
      const where = relative(REPO_ROOT, file);
      for (const match of readFileSync(file, "utf8").matchAll(SHADCN_ADD)) {
        const [command = "", prefix = "", rest = ""] = match;
        const args = rest
          .split(/\s+/)
          .map((arg) => arg.replace(/[.,;:)\]]+$/, ""))
          .filter(Boolean);
        const refs = args.filter((arg) => /^@sendo\/|(^|\/)sendo-/.test(arg) && !arg.includes("<"));
        if (refs.length === 0) continue;
        sendoCommands += 1;
        if (prefix !== "npx shadcn add") {
          problems.push(`${where}: "${command.trim()}" should start with "npx shadcn add"`);
        }
        for (const ref of refs) {
          const name = ref.replace(/^@sendo\//, "");
          if (!ref.startsWith("@sendo/") || name.startsWith("sendo-")) {
            problems.push(
              `${where}: "${ref}" is a legacy name; use @sendo/${name.replace(/^sendo-/, "")}`,
            );
          } else if (!names.has(name)) {
            problems.push(`${where}: "${ref}" is not an item in registry/registry.json`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
    // The scan must keep finding the commands it guards (quickstart, item AGENTS.md, docs).
    expect(sendoCommands).toBeGreaterThanOrEqual(15);
  });
});

/* ------------------------------------------------------------- [CC-ERR-1] / [CC-ERR-2] */

const DAY = 24 * 60 * 60 * 1000;

/** One account per tenant (tenant-a, tenant-b), a tenant-a conversation, a tag, a snippet, a rule. */
async function teamWorld() {
  graph.server.use(acceptSends());
  const c = makeClient({
    handoffMessage: null,
    resolveRole: ({ userId }) =>
      Promise.resolve(DIRECTORY[userId] === undefined ? null : { ...DIRECTORY[userId] }),
  });
  const account = await c.adapter.accounts.insert(accountInput());
  const other = await c.adapter.accounts.insert(
    accountInput({ tenantId: "tenant-b", phoneNumberId: "PN_B", wabaId: "WABA_B" }),
  );
  const { contact, conversation } = await openConversation(c.ctx, account, PHONE);
  await c.sendo.conversations.assign(conversation.id, "beto");
  const draft = await c.adapter.messages.insertOutbound({
    tenantId: account.tenantId,
    conversationId: conversation.id,
    type: "text",
    content: { body: "Borrador" },
    text: "Borrador",
    sender: "agent",
    senderRef: "recepcion",
    draft: true,
  });
  const tag = await c.sendo.tags.upsert({ name: "VIP", color: "green" }, { actor: ADMIN });
  await c.sendo.inbox.tags.add(conversation.id, tag.id, { actor: ADMIN });
  const snippet = await c.sendo.snippets.upsert(
    { shortcut: "hola", body: "Hola {{nombre}}" },
    { actor: ADMIN },
  );
  const rule = await c.sendo.rules.upsert(
    { key: "cierre", type: "auto_close", params: { afterDays: 7 } },
    { actor: ADMIN },
  );
  await c.adapter.templates.upsertMany(account.id, [
    {
      name: "aviso",
      language: "es",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Tu cobro fue emitido." }],
      variableCount: 0,
    },
  ]);
  const broadcast = await c.sendo.broadcasts.create({
    actor: ADMIN,
    template: "aviso",
    language: "es",
    recipients: [contact.id],
  });
  return { ...c, account, other, contact, conversation, draft, tag, snippet, rule, broadcast };
}

const DIRECTORY: Record<string, { role: Role; queues: string[] }> = {
  alma: { role: "admin", queues: [] },
  sofia: { role: "supervisor", queues: [] },
  ana: { role: "agent", queues: [] },
};

const range = () => ({ from: new Date(Date.now() - DAY), to: new Date(Date.now() + DAY) });

describe("[CC-ERR-1] / [CC-ERR-2] the team namespaces", () => {
  it("[CC-ERR-1] accounts.*, inbox, snippets, rules, broadcasts, metrics and links: AccountNotFoundError for unknown and other-tenant numbers", async () => {
    const w = await teamWorld();
    const accountCalls = (ref: string) => [
      w.sendo.accounts.get(ref),
      w.sendo.accounts.setDefault(ref),
      w.sendo.accounts.setLabel(ref, "Recepción"),
      w.sendo.accounts.pauseAgent(ref, true),
      w.sendo.accounts.setAgentMode(ref, "draft"),
      w.sendo.accounts.refreshBilling(ref),
      w.sendo.accounts.disconnect(ref),
      w.sendo.accounts.purge(ref),
    ];
    const scopedCalls = (ref: string) => [
      w.sendo.inbox.list({ actor: ADMIN, accountId: ref }),
      w.sendo.inbox.count({ actor: ADMIN, accountId: ref }),
      w.sendo.snippets.list({ actor: ADMIN, accountId: ref }),
      w.sendo.snippets.upsert({ shortcut: "nuevo", body: "x", accountId: ref }, { actor: ADMIN }),
      w.sendo.rules.list({ actor: ADMIN, accountId: ref }),
      w.sendo.rules.upsert(
        { key: "otra", type: "auto_close", params: { afterDays: 3 }, account: ref },
        { actor: ADMIN },
      ),
      w.sendo.broadcasts.list({ actor: ADMIN, accountId: ref }),
      ...(["create", "preview"] as const).map((method) =>
        w.sendo.broadcasts[method]({
          actor: ADMIN,
          account: ref,
          template: "aviso",
          language: "es",
          recipients: [w.contact.id],
        }),
      ),
      ...(
        ["daily", "byAssignee", "firstResponse", "aiResolution", "bySource", "cost"] as const
      ).map((method) => w.sendo.metrics[method]({ actor: ADMIN, ...range(), account: ref })),
      w.sendo.links.create({ account: ref, tenant: ADMIN.tenantId, source: "garita" }),
      w.sendo.links.sources({ actor: ADMIN, account: ref }),
      w.sendo.accounts.export(ref, { actor: ADMIN })[Symbol.asyncIterator]().next(),
    ];
    let checked = 0;
    for (const ref of [UNKNOWN_ID, "PN_NOPE"]) {
      for (const error of await Promise.all(accountCalls(ref).map(rejection))) {
        expect(error, `accounts.* ${ref}`).toBeInstanceOf(AccountNotFoundError);
        checked++;
      }
    }
    for (const ref of [UNKNOWN_ID, "PN_NOPE", w.other.id, "PN_B"]) {
      const errors = await Promise.all(scopedCalls(ref).map(rejection));
      errors.forEach((error, index) => {
        expect(error, `call #${String(index)} with ${ref}`).toBeInstanceOf(AccountNotFoundError);
        expect(error).toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
        checked++;
      });
    }
    expect(checked).toBe(2 * 8 + 4 * 18);
    expect(await w.sendo.accounts.get(w.other.id)).toMatchObject({ tenantId: "tenant-b" });
  });

  it("[CC-ERR-2] snippets, tags, rules, broadcasts and inbox drafts/tags: RecordNotFoundError naming the entity and id", async () => {
    const w = await teamWorld();
    const foreign = { ...ADMIN, tenantId: "tenant-b" };
    for (const id of [UNKNOWN_ID, "not-a-uuid"]) {
      const cases: [() => Promise<unknown>, string][] = [
        [() => w.sendo.snippets.get(id, { actor: ADMIN }), "snippet"],
        [() => w.sendo.snippets.delete(id, { actor: ADMIN }), "snippet"],
        [
          () => w.sendo.snippets.upsert({ id, shortcut: "x", body: "x" }, { actor: ADMIN }),
          "snippet",
        ],
        [
          () => w.sendo.snippets.render(id, { actor: ADMIN, conversationId: w.conversation.id }),
          "snippet",
        ],
        [
          () => w.sendo.snippets.render(w.snippet.id, { actor: ADMIN, conversationId: id }),
          "conversation",
        ],
        [() => w.sendo.tags.upsert({ id, name: "x", color: "red" }, { actor: ADMIN }), "tag"],
        [() => w.sendo.tags.delete(id, { actor: ADMIN }), "tag"],
        [() => w.sendo.tags.usage(id, { actor: ADMIN }), "tag"],
        [() => w.sendo.inbox.tags.add(w.conversation.id, id, { actor: ADMIN }), "tag"],
        [() => w.sendo.inbox.tags.remove(w.conversation.id, id, { actor: ADMIN }), "tag"],
        [() => w.sendo.inbox.tags.add(id, w.tag.id, { actor: ADMIN }), "conversation"],
        [() => w.sendo.inbox.approveDraft(id, { actor: ADMIN }), "message"],
        [() => w.sendo.inbox.discardDraft(id, { actor: ADMIN }), "message"],
        [() => w.sendo.inbox.assign(id, "ana", { actor: ADMIN }), "conversation"],
        [() => w.sendo.inbox.returnToAgent(id, { actor: ADMIN }), "conversation"],
        [() => w.sendo.inbox.close(id, { actor: ADMIN }), "conversation"],
        [() => w.sendo.inbox.assignees(id, { actor: ADMIN }), "conversation"],
        [() => w.sendo.inbox.cost(id, { actor: ADMIN }), "conversation"],
        [() => w.sendo.rules.toggle(id, false, { actor: ADMIN }), "rule"],
        [() => w.sendo.rules.delete(id, { actor: ADMIN }), "rule"],
        [() => w.sendo.rules.reorder([w.rule.id, id], { actor: ADMIN }), "rule"],
        [() => w.sendo.broadcasts.get(id, { actor: ADMIN }), "broadcast"],
        [() => w.sendo.broadcasts.cancel(id, { actor: ADMIN }), "broadcast"],
        [() => w.sendo.broadcasts.recipients(id, { actor: ADMIN }), "broadcast"],
      ];
      for (const [run, entity] of cases) {
        const error = await outcome(run());
        expect(error, `${entity} ${id}`).toBeInstanceOf(RecordNotFoundError);
        expect(error).toMatchObject({ code: "RECORD_NOT_FOUND", entity, id });
      }
    }
    // Another tenant's rows are not found either (never FORBIDDEN, which would confirm they exist).
    const foreignCases: [() => Promise<unknown>, string, string][] = [
      [() => w.sendo.snippets.get(w.snippet.id, { actor: foreign }), "snippet", w.snippet.id],
      [() => w.sendo.tags.usage(w.tag.id, { actor: foreign }), "tag", w.tag.id],
      [() => w.sendo.rules.toggle(w.rule.id, false, { actor: foreign }), "rule", w.rule.id],
      [
        () => w.sendo.broadcasts.get(w.broadcast.id, { actor: foreign }),
        "broadcast",
        w.broadcast.id,
      ],
      [
        () => w.sendo.inbox.get(w.conversation.id, { actor: foreign }),
        "conversation",
        w.conversation.id,
      ],
    ];
    const foreignTag = await w.sendo.tags.upsert(
      { name: "Ajena", color: "red" },
      { actor: foreign },
    );
    foreignCases.push([
      () => w.sendo.inbox.tags.add(w.conversation.id, foreignTag.id, { actor: ADMIN }),
      "tag",
      foreignTag.id,
    ]);
    for (const [run, entity, id] of foreignCases) {
      expect(await outcome(run())).toMatchObject({ code: "RECORD_NOT_FOUND", entity, id });
    }
  });
});

/* ------------------------------------------------------------------------- [CC-FBD-1] */

interface ActorMethod {
  /** e.g. `sendo.inbox.tags.add` */
  path: string;
  params: { name: string; type: string; actor: boolean }[];
}

/**
 * Every method reachable from the public `Sendo` type (two namespaces deep) that has a parameter
 * carrying `actor: Actor`, read with the TypeScript checker from the built `dist/index.d.ts`.
 */
function actorMethods(): ActorMethod[] {
  const file = join(PACKAGE_DIST, "index.d.ts");
  expect(existsSync(file), `${file} missing, run the build first`).toBe(true);
  const program = ts.createProgram([file], {
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const moduleSymbol = source ? checker.getSymbolAtLocation(source) : undefined;
  const sendo = moduleSymbol
    ? checker.getExportsOfModule(moduleSymbol).find((s) => s.name === "Sendo")
    : undefined;
  if (!sendo) throw new Error("`Sendo` is not exported from dist/index.d.ts");
  const found = new Map<string, ActorMethod>();
  const visit = (type: ts.Type, path: string, depth: number) => {
    for (const prop of checker.getPropertiesOfType(type)) {
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
      if (!declaration) continue;
      const propType = checker.getTypeOfSymbolAtLocation(prop, declaration);
      const name = `${path}.${prop.name}`;
      const [signature] = propType.getCallSignatures();
      if (signature) {
        const params = signature.getParameters().map((param) => {
          const at = param.valueDeclaration ?? declaration;
          const paramType = checker.getNonNullableType(
            checker.getTypeOfSymbolAtLocation(param, at),
          );
          const actor = checker.getPropertyOfType(paramType, "actor");
          return {
            name: param.name,
            type: checker.typeToString(paramType),
            actor:
              actor !== undefined &&
              checker.typeToString(checker.getTypeOfSymbolAtLocation(actor, at)) === "Actor",
          };
        });
        if (params.some((p) => p.actor) && !found.has(name))
          found.set(name, { path: name, params });
      } else if (depth < 2 && propType.getFlags() & ts.TypeFlags.Object) {
        visit(propType, name, depth + 1);
      }
    }
  };
  visit(checker.getDeclaredTypeOfSymbol(sendo), "sendo", 0);
  return [...found.values()];
}

/** Methods every role may call (AC-RL-2: reading the own list and the shared catalogs). */
const EVERY_ROLE = new Set([
  "sendo.inbox.list",
  "sendo.inbox.count",
  "sendo.snippets.list",
  "sendo.snippets.get",
  "sendo.tags.list",
]);
/** AC-RL-2 admin-only row (numbers, rules, tenant snippets, tag catalog, broadcasts) and costs. */
const ADMIN_ONLY = [
  /^sendo\.accounts\.export$/,
  /^sendo\.rules\./,
  /^sendo\.broadcasts\./,
  /^sendo\.links\.sources$/,
  /^sendo\.tags\.(upsert|delete|usage)$/,
  /^sendo\.snippets\.(upsert|delete)$/, // on a team snippet
  /^sendo\.inbox\.cost$/,
  /^sendo\.metrics\.cost$/,
];

type TeamWorld = Awaited<ReturnType<typeof teamWorld>>;

/** Arguments for `method`, by parameter name; the actor goes into every actor-carrying object. */
function argsFor(method: ActorMethod, w: TeamWorld, actor: unknown): unknown[] {
  const namespace = method.path.split(".")[1] ?? "";
  const byNamespace: Record<string, string> = {
    accounts: w.account.id,
    snippets: w.snippet.id,
    tags: w.tag.id,
    rules: w.rule.id,
    broadcasts: w.broadcast.id,
  };
  const base = (): Record<string, unknown> => {
    if (method.path === "sendo.snippets.render") return { conversationId: w.conversation.id };
    if (namespace === "broadcasts" && method.params[0]?.actor) {
      return { template: "aviso", language: "es", recipients: [w.contact.id] };
    }
    if (namespace === "metrics") return range();
    return {};
  };
  const inputs: Record<string, unknown> = {
    snippets: { shortcut: "nuevo", body: "Hola" },
    tags: { name: "Nueva", color: "blue" },
    rules: { key: "otra", type: "auto_close", params: { afterDays: 3 } },
  };
  return method.params.map((param) => {
    if (param.actor) return { ...base(), actor };
    switch (param.name) {
      case "conversationId":
        return w.conversation.id;
      case "messageId":
        return w.draft.id;
      case "snippetId":
        return w.snippet.id;
      case "tagId":
        return w.tag.id;
      case "userId":
        return "carla";
      case "paused":
      case "enabled":
        return true;
      case "text":
        return "Nota para el equipo";
      case "payload":
        return { kind: "text", body: "Hola" };
      case "ids":
        return [w.rule.id];
      case "id":
        if (byNamespace[namespace] !== undefined) return byNamespace[namespace];
        break;
      case "input":
        if (inputs[namespace] !== undefined) return inputs[namespace];
        break;
    }
    throw new Error(
      `[CC-FBD-1] no argument recipe for ${method.path}(${param.name}: ${param.type}); add one.`,
    );
  });
}

async function call(method: ActorMethod, w: TeamWorld, actor: unknown): Promise<unknown> {
  const segments = method.path.split(".").slice(1);
  const name = segments.pop() ?? "";
  let target: unknown = w.sendo;
  for (const segment of segments) target = (target as Record<string, unknown>)[segment];
  const fn = (target as Record<string, unknown>)[name];
  expect(typeof fn, method.path).toBe("function");
  return (fn as (...args: unknown[]) => Promise<unknown>).apply(target, argsFor(method, w, actor));
}

async function outcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("[CC-FBD-1] every actor-taking method of the public API", () => {
  const methods = actorMethods();

  it("[CC-FBD-1] the surface is read from the built types, not a hand list", () => {
    const paths = methods.map((m) => m.path);
    expect(paths.length).toBeGreaterThan(40);
    for (const known of [
      "sendo.inbox.reply",
      "sendo.inbox.tags.add",
      "sendo.snippets.render",
      "sendo.tags.usage",
      "sendo.rules.reorder",
      "sendo.broadcasts.create",
      "sendo.metrics.cost",
      "sendo.links.sources",
    ]) {
      expect(paths).toContain(known);
    }
    expect(paths).not.toContain("sendo.links.create");
    expect(paths).not.toContain("sendo.accounts.get");
  });

  it.each(methods.map((m) => [m.path, m] as const))(
    "[CC-FBD-1] %s: a null-role actor is FORBIDDEN with { capability, role: null } and changes nothing",
    async (_path, method) => {
      const w = await teamWorld();
      const before = dumpState(w.adapter.__state);
      const requests = graph.requests.length;
      const error = await outcome(
        call(method, w, { userId: "nadie", tenantId: "tenant-a", role: null, queues: [] }),
      );
      expect(error).toBeInstanceOf(ForbiddenError);
      const json = (error as ForbiddenError).toJSON();
      expect(json).toMatchObject({ code: "FORBIDDEN", role: null });
      expect(Object.keys(json)).toEqual(expect.arrayContaining(["capability", "role"]));
      expect(dumpState(w.adapter.__state)).toBe(before);
      expect(graph.requests.length).toBe(requests);
    },
  );

  it.each(methods.map((m) => [m.path, m] as const))(
    "[CC-FBD-1] %s: under-privileged roles get FORBIDDEN with the missing capability; admins never do",
    async (path, method) => {
      const roles = { agent: "ana", supervisor: "sofia", admin: "alma" } as const;
      const results: Partial<Record<Role, unknown>> = {};
      for (const [role, userId] of Object.entries(roles) as [Role, string][]) {
        const w = await teamWorld();
        const actor = await w.sendo.actor(userId, "tenant-a");
        results[role] = await outcome(call(method, w, actor));
      }
      expect(results.admin, `${path} as admin`).not.toBeInstanceOf(ForbiddenError);
      const expectForbidden = {
        agent: !EVERY_ROLE.has(path),
        supervisor: ADMIN_ONLY.some((re) => re.test(path)),
      };
      for (const role of ["agent", "supervisor"] as const) {
        const error = results[role];
        if (!expectForbidden[role]) {
          expect(error, `${path} as ${role}`).not.toBeInstanceOf(ForbiddenError);
          continue;
        }
        expect(error, `${path} as ${role}`).toBeInstanceOf(ForbiddenError);
        const { capability, role: reported } = error as ForbiddenError;
        expect(reported).toBe(role);
        // A capability the role lacks, or `null` when the conversation isn't visible to it
        // (the world's conversation is assigned to someone else).
        if (capability === null) expect(role).toBe("agent");
        else expect(can({ userId: "x", tenantId: "t", role, queues: [] }, capability)).toBe(false);
      }
    },
    20_000,
  );
});

/* -------------------------------------------------------------------------- [CC-TOK-1] */

const TOK = {
  appSecret: "app-secret-value",
  code: "AQD-cc-tok-single-use-code-0001",
  businessToken: "EAAB-cc-tok-business-token-0001",
  connectKey: "sk_connect_cc_tok_key_0123456789",
  signingSecret: "whsec_cc_tok_signing_secret_abcdef",
};
const CONNECT_BASE = "https://connect.sendo.dev";

/** A client whose every log line, emitted event, stored row and thrown error is collected. */
function tokClient(options: ClientOptions) {
  const stored = new Map<string, string>();
  const c = makeClient({
    storeToken: ({ account, token }) => {
      const ref = `vault:${account.phoneNumberId ?? ""}`;
      stored.set(ref, token);
      return Promise.resolve(ref);
    },
    deleteToken: (ref) => {
      stored.delete(ref);
      return Promise.resolve();
    },
    resolveToken: (account) => stored.get(account.tokenRef) ?? TOKENS[account.tokenRef],
    handoffMessage: null,
    ...options,
  });
  const events: unknown[] = [];
  const emit = c.ctx.emitter.emit.bind(c.ctx.emitter);
  c.ctx.emitter.emit = (event, payload) => {
    events.push({ event, payload });
    return emit(event, payload);
  };
  const errors: unknown[] = [];
  const attempt = async (promise: Promise<unknown>) => {
    const error = await outcome(promise);
    if (error !== null) errors.push(error);
    return error;
  };
  return { ...c, stored, events, errors, attempt };
}

/** Graph for signup (meta-direct), the billing read, and sends: the first `okSends` succeed. */
function tokGraph(okSends: number) {
  let sends = 0;
  graph.server.use(
    http.get(`${GRAPH}/oauth/access_token`, () =>
      HttpResponse.json({ access_token: TOK.businessToken, token_type: "bearer" }),
    ),
    http.post(`${GRAPH}/:waba/subscribed_apps`, () => HttpResponse.json({ success: true })),
    http.post(`${GRAPH}/:phone/register`, () => HttpResponse.json({ success: true })),
    http.post(`${CONNECT_BASE}/v1/signup/complete`, () =>
      HttpResponse.json({ token: TOK.businessToken, displayPhone: "+502 5555 0001" }),
    ),
    http.get(`${CONNECT_BASE}/v1/projects/current/webhook`, () =>
      HttpResponse.json({ projectId: "prj_1", url: CLI_WEBHOOK_URL, lastDelivery: null }),
    ),
    http.post(`${GRAPH}/:phone/messages`, () => {
      sends++;
      if (sends <= okSends)
        return HttpResponse.json({ messages: [{ id: `wamid.TOK${String(sends)}` }] });
      // Meta echoes the token it rejected; nothing may carry it further.
      return HttpResponse.json(
        {
          error: {
            code: 190,
            type: "OAuthException",
            message: `Error validating access token: ${TOK.businessToken} has expired`,
          },
        },
        { status: 401 },
      );
    }),
    http.get(`${GRAPH}/:id`, ({ params, request }) => {
      const fields = new URL(request.url).searchParams.get("fields") ?? "";
      if (fields === "primary_funding_id") return HttpResponse.json({ id: params.id });
      if (request.headers.get("authorization") === `Bearer ${SENTINEL_TOKEN}`) {
        // doctor's phone check with the env token: Meta rejects it and echoes it back.
        return HttpResponse.json(
          {
            error: {
              code: 190,
              type: "OAuthException",
              message: `Error validating access token for ${SENTINEL_TOKEN}`,
            },
          },
          { status: 401 },
        );
      }
      return HttpResponse.json({
        id: params.id,
        display_phone_number: "+502 5555 0001",
        verified_name: "Demo",
      });
    }),
    graphHandlers.subscribed(),
    graphHandlers.templatesOk(),
    graphHandlers.webhookEcho(),
  );
}

async function doctorJson(adapter: SendoAdapter, env: Record<string, string | undefined>) {
  await adapter.accounts.insert(
    cliAccountInput({ tenantId: "tenant-cli", phoneNumberId: "100000000000009" }),
  );
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(["doctor", "--url", CLI_WEBHOOK_URL, "--json"], {
    env,
    cwd: "/app",
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    readFile: () => null,
    createAdapter: () => Promise.resolve(adapter),
    version: "0.0.0",
  });
  const raw = out.join("");
  const results = JSON.parse(raw) as { id: string; ok: boolean }[];
  return { code, raw: raw + err.join(""), results };
}

function expectNoSecret(haystack: string, secrets: string[]) {
  for (const secret of secrets) expect(haystack, "a secret leaked").not.toContain(secret);
}

describe("[CC-TOK-1] secrets never leave the process", () => {
  it("[CC-TOK-1] meta-direct: signup, inbound, send, Meta failure and doctor --json", async () => {
    tokGraph(1);
    const c = tokClient({ meta: { appId: "1234567890" } });
    const account = await c.sendo.accounts.completeEmbeddedSignup({
      code: TOK.code,
      tenantId: "tenant-a",
      wabaId: FIXTURE_IDS.wabaId,
      phoneNumberId: FIXTURE_IDS.phoneNumberId,
    });
    expect(account.tokenRef).toBe(`vault:${FIXTURE_IDS.phoneNumberId}`);
    const tasks: Promise<unknown>[] = [];
    const response = await c.sendo.handleWebhook(signedPost(freshFixture("text")), {
      waitUntil: (p) => tasks.push(p),
    });
    await Promise.all(tasks);
    expect(response.status).toBe(200);
    expect(await c.attempt(c.sendo.send.text(PHONE, "Hola", { account: account.id }))).toBeNull();
    const failed = await c.attempt(c.sendo.send.text(PHONE, "Otra", { account: account.id }));
    expect(failed).toMatchObject({ code: "META_API_ERROR" });
    await c.attempt(c.sendo.accounts.refreshBilling(account.id));
    await c.attempt(
      c.sendo.accounts.completeEmbeddedSignup({
        code: TOK.code,
        tenantId: "tenant-b",
        wabaId: FIXTURE_IDS.wabaId,
        phoneNumberId: FIXTURE_IDS.phoneNumberId,
      }),
    );
    expect(c.errors.length).toBeGreaterThanOrEqual(2);

    const doctor = await doctorJson(c.adapter, doctorEnv({ SENDO_META_APP_SECRET: TOK.appSecret }));
    expect(doctor.results.some((r) => !r.ok)).toBe(true);

    expect(c.events.length).toBeGreaterThan(3);
    expectNoSecret(
      [
        JSON.stringify(c.logs.entries.map((e) => e.args.map(String))),
        c.errors.map(errorSurface).join("\n"),
        dumpState(c.adapter.__state),
        JSON.stringify(c.events),
        doctor.raw,
      ].join("\n"),
      [TOK.businessToken, TOK.appSecret, TOK.code, SENTINEL_TOKEN, SERVICE_ROLE_KEY],
    );
  });

  it("[CC-TOK-1] Sendo Connect: signup via Connect, relayed inbound, send, failure and doctor --json", async () => {
    tokGraph(1);
    const c = tokClient({
      appSecret: undefined,
      connect: { apiKey: TOK.connectKey, signingSecret: TOK.signingSecret },
    });
    const account = await c.sendo.accounts.completeEmbeddedSignup({
      code: TOK.code,
      tenantId: "tenant-a",
      wabaId: FIXTURE_IDS.wabaId,
      phoneNumberId: FIXTURE_IDS.phoneNumberId,
    });
    expect(account.onboardedVia).toBe("connect");
    const body = freshFixture("text");
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", TOK.signingSecret)
      .update(`${String(t)}.${body}`)
      .digest("hex");
    const tasks: Promise<unknown>[] = [];
    const relayed = await c.sendo.handleWebhook(
      new Request(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sendo-signature": `t=${String(t)},v1=${v1}`,
        },
        body,
      }),
      { waitUntil: (p) => tasks.push(p) },
    );
    await Promise.all(tasks);
    expect(relayed.status).toBe(200);
    const forged = await c.sendo.handleWebhook(signedPost(body, TOK.signingSecret));
    expect(forged.status).toBe(401);
    expect(await c.attempt(c.sendo.send.text(PHONE, "Hola", { account: account.id }))).toBeNull();
    expect(
      await c.attempt(c.sendo.send.text(PHONE, "Otra", { account: account.id })),
    ).toMatchObject({ code: "META_API_ERROR" });

    const doctor = await doctorJson(
      c.adapter,
      doctorEnv({
        SENDO_META_APP_SECRET: undefined,
        SENDO_CONNECT_API_KEY: TOK.connectKey,
        SENDO_CONNECT_SIGNING_SECRET: TOK.signingSecret,
      }),
    );
    expect(doctor.results.map((r) => r.id)).toContain("connect:key");

    expectNoSecret(
      [
        JSON.stringify(c.logs.entries.map((e) => e.args.map(String))),
        c.errors.map(errorSurface).join("\n"),
        dumpState(c.adapter.__state),
        JSON.stringify(c.events),
        doctor.raw,
      ].join("\n"),
      [
        TOK.businessToken,
        TOK.connectKey,
        TOK.signingSecret,
        TOK.code,
        SENTINEL_TOKEN,
        SERVICE_ROLE_KEY,
      ],
    );
  });
});

/* -------------------------------------------------------------------------- [CC-SCH-2] */

const SEED_RE =
  /insert\s+into\s+public\.sendo_schema_meta\s*\(\s*version\s*\)\s*values\s*\(\s*(\d+)\s*\)/gi;

function sqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

it("[CC-SCH-2] mirrors are byte-identical; SENDO_SCHEMA_VERSION = highest seed = last SCHEMA_MIGRATIONS entry", () => {
  const canonicalDir = join(REPO_ROOT, "registry/items/schema/supabase/migrations");
  const numbersDir = join(REPO_ROOT, "registry/items/numbers/supabase/migrations");
  const canonical = sqlFiles(canonicalDir);
  const sources = new Map<string, Buffer>();
  for (const file of canonical) sources.set(file, readFileSync(join(canonicalDir, file)));
  for (const file of sqlFiles(numbersDir)) sources.set(file, readFileSync(join(numbersDir, file)));
  const playground = "20261010100000_playground.sql";
  sources.set(playground, readFileSync(join(REPO_ROOT, "supabase/migrations", playground)));

  // Every mirror holds exactly the canonical migrations (plus the numbers Vault and playground
  // ones), byte for byte: no stale or hand-edited copy.
  for (const mirror of ["supabase/migrations", "apps/playground/supabase/migrations"]) {
    const files = sqlFiles(join(REPO_ROOT, mirror));
    expect(files, mirror).toEqual([...sources.keys()].sort());
    for (const file of files) {
      const copy = readFileSync(join(REPO_ROOT, mirror, file));
      expect(copy.equals(sources.get(file) ?? Buffer.alloc(0)), `${mirror}/${file}`).toBe(true);
    }
  }

  const seeds = canonical.map((file) =>
    Math.max(
      0,
      ...[...readFileSync(join(canonicalDir, file), "utf8").matchAll(SEED_RE)].map((m) =>
        Number(m[1]),
      ),
    ),
  );
  expect(seeds).toEqual(canonical.map((_file, i) => i + 1));
  expect(SENDO_SCHEMA_VERSION).toBe(Math.max(...seeds));
  expect(SCHEMA_MIGRATIONS.at(-1)?.version).toBe(SENDO_SCHEMA_VERSION);
  expect(SCHEMA_MIGRATIONS.map((m) => [m.version, m.file, m.changelog])).toEqual(
    canonical.map((file, i) => [
      i + 1,
      file,
      `https://sendo.dev/changelog#schema-v${String(i + 1)}`,
    ]),
  );
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "registry/registry.json"), "utf8")) as {
    items: { name: string; files: { path: string }[] }[];
  };
  const shipped = manifest.items
    .find((item) => item.name === "schema")
    ?.files.map((f) => f.path)
    .filter((path) => path.endsWith(".sql"))
    .map((path) => path.split("/").at(-1));
  expect(shipped).toEqual(canonical);
});

/* -------------------------------------------------------------------------- [CC-REL-1] */

describe("[CC-REL-1] release and CI guards", () => {
  it("[CC-REL-1] the CI supabase job runs schema:check, test:supabase (required) and test:e2e, and always uploads the report", () => {
    const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = ci.slice(ci.indexOf("\n  supabase:"));
    expect(job.length).toBeLessThan(ci.length);
    const order = [
      "supabase start",
      "pnpm schema:check",
      "pnpm test:supabase",
      'SENDO_REQUIRE_SUPABASE: "1"',
      "pnpm test:e2e",
      "if: always()",
      "actions/upload-artifact",
      "packages/sendo/test-results/e2e-report.json",
    ].map((needle) => job.indexOf(needle));
    expect(
      order.every((index) => index >= 0),
      JSON.stringify(order),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("[CC-REL-1] every schema migration ships a changeset saying to copy it into supabase/migrations/", () => {
    const notes = readdirSync(join(REPO_ROOT, ".changeset"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(join(REPO_ROOT, ".changeset", f), "utf8"));
    const changelog = join(PACKAGE_DIST, "..", "CHANGELOG.md");
    if (existsSync(changelog)) notes.push(readFileSync(changelog, "utf8"));
    for (const { file } of SCHEMA_MIGRATIONS) {
      const note = notes.find((text) => text.includes(`copy \`${file}\``));
      expect(note, `no changeset for ${file}`).toBeDefined();
      expect(note).toContain("`supabase/migrations/`");
    }
  });

  it("[CC-REL-1] @quami/sendo is MIT with a LICENSE file and publishes publicly", () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIST, "..", "package.json"), "utf8")) as {
      name: string;
      license: string;
      files: string[];
      publishConfig: { access: string };
      bin: Record<string, string>;
    };
    expect(pkg).toMatchObject({
      name: "@quami/sendo",
      license: "MIT",
      publishConfig: { access: "public" },
    });
    expect(Object.keys(pkg.bin)).toEqual(["sendo"]);
    expect(pkg.files).toContain("LICENSE");
    expect(readFileSync(join(PACKAGE_DIST, "..", "LICENSE"), "utf8")).toMatch(/^MIT License/);
    const changesets = JSON.parse(
      readFileSync(join(REPO_ROOT, ".changeset/config.json"), "utf8"),
    ) as {
      access: string;
    };
    expect(changesets.access).toBe("public");
  });

  it("[CC-REL-1] the dangling references removed by AC-SV-3 stay removed", (ctx) => {
    const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (git.error || git.status !== 0) {
      if (process.env.CI) throw new Error("[CC-REL-1] needs git in CI; it is not available.");
      ctx.skip("[CC-REL-1] skipped: git is not available or this is not a git checkout.");
    }
    // `[.]` keeps the pattern from matching this line.
    const result = spawnSync(
      "git",
      [
        "grep",
        "-nE",
        "acceptance-coverage[.]md|playground/test/migrations[.]test",
        "--",
        ".",
        ":(exclude,glob)**/CHANGELOG.md",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(result.status, result.stderr).not.toBeGreaterThan(1);
    expect(result.stdout.split("\n").filter(Boolean)).toEqual([]);
  });
});

/* ---------------------------------------------------- [CC-LAUNCH-*] languages, site and launch */

/** `git grep` over tracked and new (not ignored) files; `null` when git is unavailable. */
function gitGrep(pattern: string, flags: string[] = []): string[] | null {
  const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (git.error || git.status !== 0) return null;
  const result = spawnSync("git", ["grep", "--untracked", "-nE", ...flags, pattern, "--", "."], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // git grep: 0 = matches, 1 = no matches, anything else = error.
  expect(result.status, result.stderr).not.toBeGreaterThan(1);
  return result.stdout.split("\n").filter(Boolean);
}

describe("[CC-LAUNCH-QC] the hosted transport is gone", () => {
  it("[CC-LAUNCH-QC1] no file names the removed hosted transport or its API key (AC-QC-1)", (ctx) => {
    // Split so this file doesn't match its own pattern.
    const pattern = ["quami.?cloud", "quami" + "Cloud", "QUAMI_" + "API_KEY"].join("|");
    const hits = gitGrep(pattern, ["-i"]);
    if (hits === null) {
      if (process.env.CI) throw new Error("[CC-LAUNCH-QC1] needs git in CI; it is not available.");
      ctx.skip("[CC-LAUNCH-QC1] skipped: git is not available or this is not a git checkout.");
    }
    expect(hits).toEqual([]);
    // The generated docs index is versioned and part of the scan.
    expect(gitGrep("roadmap", ["-l"])).toContain("packages/sendo/docs/docs.json");
  });

  it("[CC-LAUNCH-QC2] dist exports no hosted transport; metaDirect and Transport are unchanged (AC-QC-2)", async () => {
    const types = readFileSync(join(PACKAGE_DIST, "index.d.ts"), "utf8");
    const exported = new Set(
      [...types.matchAll(/^export \{([^}]*)\}/gm)].flatMap((block) =>
        (block[1] ?? "")
          .split(",")
          .map((name) => name.trim().replace(/^type\s+/, ""))
          .filter(Boolean)
          .map((name) => name.split(/\s+as\s+/).at(-1) ?? name),
      ),
    );
    expect(exported.size).toBeGreaterThan(200);
    const hosted = ["quami" + "Cloud", "Quami" + "CloudOptions"];
    for (const name of hosted) expect(exported.has(name), name).toBe(false);
    expect(exported.has("metaDirect")).toBe(true);
    expect(exported.has("Transport")).toBe(true);

    const esm = (await import(join(PACKAGE_DIST, "index.js"))) as Record<string, unknown>;
    for (const name of hosted) expect(name in esm, `dist/index.js exports ${name}`).toBe(false);
    expect(typeof esm.metaDirect).toBe("function");
    const cjs = readFileSync(join(PACKAGE_DIST, "index.cjs"), "utf8");
    for (const name of hosted) expect(cjs).not.toContain(name);

    // The interface custom transports implement keeps its members (names and optionality).
    const chunk = readdirSync(PACKAGE_DIST)
      .filter((file) => file.endsWith(".d.ts"))
      .map((file) => readFileSync(join(PACKAGE_DIST, file), "utf8"))
      .find((text) => /^interface Transport \{/m.test(text));
    const body = /^interface Transport \{\n([^]*?)^\}/m.exec(chunk ?? "")?.[1] ?? "";
    const members = [...body.matchAll(/^ {4}(?:readonly )?(\w+)(\?)?[(:]/gm)].map(
      (m) => `${m[1] ?? ""}${m[2] ?? ""}`,
    );
    expect(members).toEqual([
      "kind",
      "send",
      "fetchMedia",
      "uploadMedia?",
      "markRead?",
      "handleWebhook?",
      "subscribe?",
    ]);
  });

  it("[CC-LAUNCH-QC3] the roadmap is in the docs nav and describes no hosted mode (AC-QC-3)", () => {
    const docs = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages/sendo/docs/docs.json"), "utf8"),
    ) as {
      docs: { slug: string; body: string }[];
    };
    const roadmap = docs.docs.find((doc) => doc.slug === "roadmap");
    if (roadmap === undefined) return; // removed from the nav: also satisfies AC-QC-3
    const source = readFileSync(join(REPO_ROOT, "apps/web/content/docs/roadmap.mdx"), "utf8");
    for (const text of [source, roadmap.body]) {
      expect(text).not.toMatch(/\bhosted\b|\bcloud\b|\bmanaged (?:mode|service)\b/i);
      expect(text).toContain("Not a message store.");
    }
    expect(source).toMatch(/^## Sendo Connect \[#connect\]$/m);
  });
});

describe("[CC-LAUNCH-TS] the skip summary of pnpm test", () => {
  let root: string;
  const script = () => join(root, "scripts/test-summary.mjs");

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "sendo-summary-"));
    mkdirSync(join(root, "scripts"));
    copyFileSync(join(REPO_ROOT, "scripts/test-summary.mjs"), script());
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n  - "apps/*"\n  - registry\n',
    );
    for (const dir of ["packages/sendo", "apps/web", "apps/playground", "registry"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** A `node -e` program that writes these skips.json files (as the reporter does) and exits. */
  function vitestRun(files: Record<string, unknown[]>, exitCode: number): string[] {
    const writes = Object.entries(files).map(
      ([dir, skips]) =>
        `fs.mkdirSync(${JSON.stringify(join(root, dir, "test-results"))},{recursive:true});` +
        `fs.writeFileSync(${JSON.stringify(join(root, dir, "test-results/skips.json"))},` +
        `${JSON.stringify(JSON.stringify({ skips }))});`,
    );
    return [
      process.execPath,
      "-e",
      `const fs=require("node:fs");${writes.join("")}process.exit(${String(exitCode)});`,
    ];
  }

  function summary(command: string[]) {
    const args = command.length > 0 ? ["--", ...command] : [];
    const run = spawnSync(process.execPath, [script(), ...args], { cwd: root, encoding: "utf8" });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  const skip = (reason: keyof typeof SKIP_MESSAGES, count: number) => ({
    reason,
    count,
    ...SKIP_MESSAGES[reason],
  });

  it("[CC-LAUNCH-TS] AC-TS-2: nothing skipped prints nothing, even over a stale summary", () => {
    mkdirSync(join(root, "registry/test-results"), { recursive: true });
    writeFileSync(
      join(root, "registry/test-results/skips.json"),
      JSON.stringify({ skips: [skip("supabase", 3)] }),
    );
    const clean = summary(vitestRun({ "packages/sendo": [], registry: [] }, 0));
    expect(clean).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(summary([])).toEqual({ status: 0, stdout: "", stderr: "" });
  });

  it("[CC-LAUNCH-TS] AC-TS-1: skips print one line per reason across workspaces, with the command; the exit code is kept", () => {
    const files = {
      "packages/sendo": [skip("supabase", 138), skip("database", 352)],
      registry: [skip("supabase", 3)],
      "apps/playground": [],
    };
    const expected = [
      "",
      "Skip summary (all workspaces):",
      `141 tests skipped — ${SKIP_MESSAGES.supabase.why} (packages/sendo 138, registry 3)`,
      `Run them with: ${SKIP_MESSAGES.supabase.run}`,
      `352 tests skipped — ${SKIP_MESSAGES.database.why} (packages/sendo 352)`,
      `Run them with: ${SKIP_MESSAGES.database.run}`,
      "",
      "",
    ].join("\n");
    expect(summary(vitestRun(files, 0))).toEqual({ status: 0, stdout: expected, stderr: "" });
    expect(SKIP_MESSAGES.supabase.run).toBe("pnpm supabase start && pnpm test:supabase");
    // A failing run fails the same way; the summary still prints.
    expect(summary(vitestRun(files, 3))).toEqual({ status: 3, stdout: expected, stderr: "" });
    // Without a command it prints the last run's summary.
    expect(summary([]).stdout).toBe(expected);
  });
});

describe("[CC-LAUNCH-EXPORT] one export, three surfaces", () => {
  const ROLES: Record<string, Role> = { alma: "admin", sofia: "supervisor", ana: "agent" };
  const resolveRole: ResolveRole = ({ userId, tenantId }) =>
    Promise.resolve(tenantId === "tenant-a" ? { role: ROLES[userId] ?? "agent" } : null);
  const ROUTE = resolve(
    REPO_ROOT,
    "registry/items/numbers/app/(protected)/inbox/numbers/export/[id]/route.ts",
  );
  type ExportRoute = {
    GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
  };

  async function joined(chunks: AsyncIterable<string>): Promise<string> {
    let text = "";
    for await (const chunk of chunks) text += chunk;
    return text;
  }

  it("[CC-LAUNCH-EXPORT] the op, the CLI and the numbers route return the same bytes; FORBIDDEN and not-found agree", async () => {
    graph.server.use(acceptSends([]), ...mediaHandlers());
    const route = (await import(ROUTE)) as ExportRoute;
    const h = await createHarness({ resolveRole, handoffMessage: null });
    await h.deliver(textWebhook({ id: "wamid.LAUNCH1", body: "Hello" }));
    await h.deliver(freshFixture("image"));
    const conversationId = h.messages("in")[0]?.conversationId ?? "";
    const alma = await h.sendo.actor("alma", "tenant-a");
    await h.sendo.inbox.note(conversationId, "Called the resident", { actor: alma });

    const cwd = mkdtempSync(join(tmpdir(), "sendo-launch-export-"));
    const err: string[] = [];
    const deps: CliDeps = {
      env: {},
      cwd,
      stdout: () => undefined,
      stderr: (text) => err.push(text),
      readFile: () => null,
      createAdapter: () => Promise.resolve(h.adapter),
      version: "0.0.0",
    };
    const get = (userId: string, id: string) => {
      routeApp.sendo = h.sendo;
      routeApp.user = { userId, tenantId: "tenant-a" };
      return route.GET(new Request(`https://app.example/inbox/numbers/export/${id}`), {
        params: Promise.resolve({ id }),
      });
    };

    // One snapshot: the same clock, and the media URL signer's per-call token fixed.
    const snapshotAt = new Date();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(snapshotAt);
    const uuid = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-00000000c0de");
    try {
      const op = await joined(h.sendo.accounts.export(h.account.id, { actor: alma }));
      expect(await runCli(["accounts", "export", h.account.id, "--out", "doc.json"], deps)).toBe(
        EXIT_OK,
      );
      const cli = readFileSync(join(cwd, "doc.json"), "utf8");
      const response = await get("alma", h.account.id);
      expect(response.status).toBe(200);
      const download = await response.text();

      const document = JSON.parse(op) as { conversations: { messages: unknown[] }[] };
      expect(document.conversations[0]?.messages.length).toBeGreaterThanOrEqual(3);
      expect(op).toContain('"missing":false');
      expect(cli).toBe(op);
      expect(download).toBe(op);
      expect(response.headers.get("Content-Disposition")).toBe(
        `attachment; filename="sendo-export-15550001111-${snapshotAt.toISOString().slice(0, 10)}.json"`,
      );

      // Non-admins: FORBIDDEN from the op before any chunk; 403 with no body from the route.
      for (const userId of ["sofia", "ana"]) {
        const actor = await h.sendo.actor(userId, "tenant-a");
        const refused = (() => {
          try {
            h.sendo.accounts.export(h.account.id, { actor });
          } catch (error) {
            return error;
          }
          return null;
        })();
        expect(refused).toBeInstanceOf(ForbiddenError);
        expect(refused).toMatchObject({ code: "FORBIDDEN", capability: "numbers.manage" });
        const forbidden = await get(userId, h.account.id);
        expect(forbidden.status).toBe(403);
        expect(forbidden.headers.get("Cache-Control")).toBe("no-store");
        expect(await forbidden.text()).toBe("");
      }

      // An unknown number: ACCOUNT_NOT_FOUND, 404 with no body, exit 1 with no file left.
      const unknown = h.sendo.accounts.export(UNKNOWN_ID, { actor: alma });
      await expect(unknown[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: "ACCOUNT_NOT_FOUND",
      });
      const missing = await get("alma", UNKNOWN_ID);
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe("");
      expect(await runCli(["accounts", "export", UNKNOWN_ID, "--out", "nope.json"], deps)).toBe(
        EXIT_FAILURE,
      );
      expect(existsSync(join(cwd, "nope.json"))).toBe(false);
    } finally {
      uuid.mockRestore();
      vi.useRealTimers();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("[CC-LAUNCH-MIRROR] playground mirrors", () => {
  /** A string-array constant of the playground's install script. */
  function scriptList(source: string, name: string): string[] {
    const block = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source)?.[1];
    if (block === undefined) throw new Error(`${name} not found in registry-install.mjs`);
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  }

  /** shadcn drops a file's leading comment block when it installs it. */
  const withoutHeader = (text: string) =>
    text.replace(/^(?:\/\/[^\n]*\n)+\n?/, "").replace(/^\/\*[^]*?\*\/\n\n?/, "");

  it("[CC-LAUNCH-MIRROR] every installed registry file matches its source, except APP_OWNED_FILES", () => {
    const install = readFileSync(
      join(REPO_ROOT, "apps/playground/scripts/registry-install.mjs"),
      "utf8",
    );
    const installed = new Set(scriptList(install, "DEFAULT_ITEMS"));
    const appOwned = new Set(scriptList(install, "APP_OWNED_FILES"));
    expect(appOwned.has("lib/sendo.ts")).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "registry/registry.json"), "utf8"),
    ) as { items: { name: string; files: { path: string; target?: string }[] }[] };
    const problems: string[] = [];
    let compared = 0;
    for (const item of manifest.items.filter((i) => installed.has(i.name))) {
      for (const file of item.files) {
        if (file.target === undefined || appOwned.has(file.target)) continue;
        const mirror = join(REPO_ROOT, "apps/playground", file.target);
        if (!existsSync(mirror)) {
          problems.push(`${item.name}: apps/playground/${file.target} is missing`);
          continue;
        }
        compared += 1;
        const source = withoutHeader(readFileSync(join(REPO_ROOT, file.path), "utf8"));
        if (withoutHeader(readFileSync(mirror, "utf8")) !== source) {
          problems.push(`${item.name}: apps/playground/${file.target} differs from ${file.path}`);
        }
      }
    }
    expect(
      problems,
      "run `node scripts/registry-build.mjs && pnpm --filter playground registry:install <items>`",
    ).toEqual([]);
    expect(compared).toBeGreaterThan(50);
  });
});

describe("[CC-LAUNCH-DOCS] the Languages page", () => {
  it("[CC-LAUNCH-DOCS] explains editing a string and adding a language for every UI item (AC-RS-5)", () => {
    const page = readFileSync(join(REPO_ROOT, "apps/web/content/docs/languages.mdx"), "utf8");
    expect(page).toMatch(/^## Edit a string \[#edit\]$/m);
    expect(page).toMatch(/^## Add a language \[#add\]$/m);
    const add = page.slice(
      page.indexOf("## Add a language"),
      page.indexOf("\n## ", page.indexOf("## Add a language") + 3),
    );
    expect(add).toContain("lib/sendo-ui.ts");
    expect(add).toContain("tsc --noEmit");
    expect(page).toContain("strings={{");

    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "registry/registry.json"), "utf8"),
    ) as { items: { name: string; files: { path: string }[] }[] };
    const uiItems = manifest.items.filter((item) =>
      item.files.some((f) => f.path.endsWith(".tsx")),
    );
    expect(uiItems.length).toBeGreaterThanOrEqual(6);
    for (const item of uiItems) {
      const stringsFile = item.files.find((f) => /\/strings\.ts$/.test(f.path));
      expect(stringsFile, `${item.name} ships a strings.ts`).toBeDefined();
      const source = readFileSync(join(REPO_ROOT, stringsFile?.path ?? ""), "utf8");
      const name = /^export const (\w+Strings) = \{ es, en \}/m.exec(source)?.[1];
      expect(name, `${item.name}: export const <item>Strings = { es, en }`).toBeDefined();
      expect(add, `the "Add a language" steps name ${name ?? item.name}`).toContain(name ?? "");
    }

    const docs = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages/sendo/docs/docs.json"), "utf8"),
    ) as { docs: { slug: string }[] };
    expect(docs.docs.map((doc) => doc.slug)).toContain("languages");
  });
});

describe("[CC-LAUNCH-RR1] repository URLs", () => {
  it("[CC-LAUNCH-RR1] every GitHub URL of the project points to quamidev/sendo (AC-RR-1)", (ctx) => {
    const hits = gitGrep("github[.]com[/:]quamidev[/]", ["-o", "-i"]);
    if (hits === null) {
      if (process.env.CI) throw new Error("[CC-LAUNCH-RR1] needs git in CI; it is not available.");
      ctx.skip("[CC-LAUNCH-RR1] skipped: git is not available or this is not a git checkout.");
    }
    const urls = gitGrep("github[.]com[/:]quamidev[/][A-Za-z0-9_.-]+", ["-o", "-i"]) ?? [];
    expect(urls.length).toBeGreaterThan(3);
    const elsewhere = urls.filter(
      (line) => !/github\.com[/:]quamidev\/sendo(?:\.git)?$/i.test(line),
    );
    expect(elsewhere).toEqual([]);
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages/sendo/package.json"), "utf8"),
    ) as {
      repository: { url: string; directory: string };
      bugs: { url: string };
      homepage: string;
    };
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/quamidev/sendo.git",
      directory: "packages/sendo",
    });
    expect(pkg.bugs.url).toBe("https://github.com/quamidev/sendo/issues");
    expect(pkg.homepage).toBe("https://sendo.dev");
  });
});
