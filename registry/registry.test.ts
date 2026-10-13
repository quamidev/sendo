import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "apps/web/registry-dist");
const ITEM_NAMES = [
  "webhook",
  "schema",
  "inbox",
  "widgets",
  "numbers",
  "workflows",
  "metrics",
  "broadcasts",
] as const;

type BuiltFile = { path: string; type: string; target?: string; content: string };
type BuiltItem = {
  name: string;
  type: string;
  files: BuiltFile[];
  dependencies?: string[];
  envVars?: Record<string, string>;
  docs?: string;
};

function readItem(name: string): BuiltItem {
  return JSON.parse(readFileSync(path.join(DIST_DIR, `${name}.json`), "utf8")) as BuiltItem;
}

function fileByTarget(item: BuiltItem, target: string): BuiltFile {
  const file = item.files.find((candidate) => candidate.target === target);
  if (!file) throw new Error(`${item.name} has no file with target ${target}`);
  return file;
}

describe("built registry", () => {
  beforeAll(() => {
    if (ITEM_NAMES.every((name) => existsSync(path.join(DIST_DIR, `${name}.json`)))) return;
    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/registry-build.mjs")],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      },
    );
    if (result.status !== 0) {
      throw new Error(`registry:build failed:\n${result.stdout}\n${result.stderr}`);
    }
  }, 120_000);

  describe("inbox", () => {
    const item = () => readItem("inbox");

    it("guards every server action with requireUser(), which fails closed in the template", () => {
      const built = item();
      const actions = fileByTarget(built, "app/(protected)/inbox/actions.ts").content;
      expect(actions.startsWith('"use server";')).toBe(true);
      const exported = [
        ...actions.matchAll(
          /export async function (\w+)\([^]*?\{\n {2}const user = await requireUser\(\);/g,
        ),
      ];
      const INBOX_ACTIONS = [
        "addTag",
        "approveDraft",
        "assign",
        "close",
        "deleteSnippet",
        "deleteTag",
        "discardDraft",
        "list",
        "listAssignees",
        "listSnippets",
        "listTags",
        "listTemplates",
        "markSeen",
        "note",
        "pauseAgent",
        "removeTag",
        "renderSnippet",
        "reply",
        "returnToAgent",
        "tagUsage",
        "take",
        "thread",
        "upsertSnippet",
        "upsertTag",
      ];
      expect(exported.map((match) => match[1]).sort()).toEqual([...INBOX_ACTIONS].sort());
      expect(actions.match(/export async function/g)).toHaveLength(INBOX_ACTIONS.length);
      // Every action runs as the resolved actor (sendo.actor → resolveRole), which fails closed.
      expect(actions).toContain("sendo.actor(user.userId, user.tenantId)");
      expect(
        actions.match(/actor: await actorOf\(user\)|const actor = await actorOf\(user\)/g),
      ).toHaveLength(INBOX_ACTIONS.length);
      expect(actions).toContain('case "FORBIDDEN":');
      expect(actions).toContain('case "ACCOUNT_STATE":\n      return "ACCOUNT_INACTIVE";');
      expect(actions).toContain('status: "APPROVED"');

      const config = fileByTarget(built, "app/(protected)/inbox/inbox-config.ts").content;
      expect(config).toContain("// TODO: implement requireUser()");
      expect(config).toContain("Promise.reject(");

      // A role that resolves to null renders `accessDeniedTitle` in the app's language (AC-RL-4).
      const page = fileByTarget(built, "app/(protected)/inbox/page.tsx").content;
      expect(page).toContain("<InboxAccessDenied locale={sendoLocale} />");
    });
  });

  describe("widgets", () => {
    const item = () => readItem("widgets");

    it("guards every server action with requireUser() and the actor, and fails closed", () => {
      const built = item();
      const actions = fileByTarget(built, "app/(protected)/inbox/links/actions.ts").content;
      expect(actions.startsWith('"use server";')).toBe(true);
      const exported = [
        ...actions.matchAll(
          /export async function (\w+)\([^]*?\{\n {2}const user = await requireUser\(\);/g,
        ),
      ];
      expect(exported.map((match) => match[1]).sort()).toEqual(["createLink", "listSources"]);
      expect(actions.match(/export async function/g)).toHaveLength(2);
      expect(actions.match(/sendo\.actor\(user\.userId, user\.tenantId\)/g)).toHaveLength(2);
      expect(actions).toContain('assertCan(actor, "numbers.manage")');
      expect(actions).toContain("tenant: actor.tenantId");

      const page = fileByTarget(built, "app/(protected)/inbox/links/page.tsx").content;
      expect(page).toContain('can(actor, "numbers.manage")');

      const config = fileByTarget(built, "app/(protected)/inbox/links/links-config.ts").content;
      expect(config).toContain("// TODO: implement requireUser()");
      expect(config).toContain("Promise.reject(");
      expect(built.dependencies).toEqual(expect.arrayContaining(["qrcode-generator"]));
      expect(built.files.map((file) => file.target)).toContain(
        "components/sendo/widgets/AGENTS.md",
      );
    });
  });

  describe("numbers", () => {
    const item = () => readItem("numbers");

    it("guards every server action with requireUser(), then the actor; changes need numbers.manage", () => {
      const built = item();
      const actions = fileByTarget(built, "app/(protected)/inbox/numbers/actions.ts").content;
      expect(actions.startsWith('"use server";')).toBe(true);
      const exported = [
        ...actions.matchAll(
          /export async function (\w+)\([^]*?\{\n {2}const user = await requireUser\(\);/g,
        ),
      ];
      expect(exported.map((match) => match[1]).sort()).toEqual(
        [
          "connect",
          "disconnect",
          "list",
          "pauseAgent",
          "purge",
          "refreshBilling",
          "setAgentMode",
          "setDefault",
          "setLabel",
        ].sort(),
      );
      expect(actions.match(/export async function/g)).toHaveLength(9);
      // list resolves the actor itself (read-only for non-admins); the 8 mutations go through requireAdmin.
      expect(actions.match(/await requireAdmin\(user\)/g)).toHaveLength(8);
      expect(actions).toContain('assertCan(actor, "numbers.manage")');
      expect(actions.match(/sendo\.actor\(user\.userId, user\.tenantId\)/g)).toHaveLength(2);
      // AC-DN-5: deleting history is off unless the app opts in, and the server checks it too.
      expect(actions).toContain("if (!numbersConfig.allowPurge)");
      expect(actions).toContain("await sendo.accounts.purge(account.id)");

      // AC-DN-4: the export download is a route handler (a server action can't stream a file).
      const route = fileByTarget(
        built,
        "app/(protected)/inbox/numbers/export/[id]/route.ts",
      ).content;
      expect(route).toContain("sendo.actor(user.userId, user.tenantId)");
      expect(route).toContain("sendo.accounts.export(id, { actor })");
      expect(route).toContain('if (code === "FORBIDDEN") return empty(403);');
      expect(route).toContain('if (code === "ACCOUNT_NOT_FOUND") return empty(404);');
      expect(route).toContain('"Content-Disposition": `attachment; filename="${exportFileName(');
      expect(route).toContain('"Content-Type": "application/json"');

      const config = fileByTarget(built, "app/(protected)/inbox/numbers/numbers-config.ts").content;
      expect(config).toContain("// TODO: implement requireUser()");
      expect(config).toContain("Promise.reject(");
      expect(config).toContain("numbersVisibleToNonAdmins: true");
      expect(config).toContain("allowPurge: false");
      expect(config).toContain('export: "/inbox/numbers/export/{id}"');

      const page = fileByTarget(built, "app/(protected)/inbox/numbers/page.tsx").content;
      expect(page).toContain("locale={sendoLocale}");
      expect(page).toContain("allowPurge={numbersConfig.allowPurge}");

      expect(Object.keys(built.envVars ?? {}).sort()).toEqual([
        "NEXT_PUBLIC_SENDO_META_APP_ID",
        "NEXT_PUBLIC_SENDO_META_CONFIG_ID",
        "SENDO_META_CONFIG_ID",
      ]);
      expect(built.files.map((file) => file.target)).toEqual(
        expect.arrayContaining([
          "components/sendo/numbers/AGENTS.md",
          "components/sendo/numbers/MOTION.md",
          "lib/sendo-ui.ts",
          "lib/sendo-token-store.ts",
          "lib/sendo-embedded-signup.ts",
          "supabase/migrations/20261012000000_numbers_vault_tokens.sql",
        ]),
      );
    });

    it("reads vault: token refs from Supabase Vault in the webhook's resolveToken", () => {
      const lib = fileByTarget(readItem("webhook"), "lib/sendo.ts").content;
      expect(lib).toContain('const VAULT_PREFIX = "vault:"');
      expect(lib).toContain('rpc("sendo_vault_read_token"');
      expect(lib).toContain("process.env[account.tokenRef]");
    });
  });

  describe("workflows", () => {
    const item = () => readItem("workflows");

    it("guards every server action with requireUser(), then the rules.manage actor, and fails closed", () => {
      const built = item();
      const actions = fileByTarget(built, "app/(protected)/inbox/rules/actions.ts").content;
      expect(actions.startsWith('"use server";')).toBe(true);
      const exported = [
        ...actions.matchAll(
          /export async function (\w+)\([^]*?\{\n {2}const user = await requireUser\(\);/g,
        ),
      ];
      expect(exported.map((match) => match[1]).sort()).toEqual(
        ["deleteRule", "listRules", "reorderRules", "saveRule", "toggleRule"].sort(),
      );
      expect(actions.match(/export async function/g)).toHaveLength(5);
      // Every action resolves the actor (sendo.actor → resolveRole) and needs rules.manage.
      expect(actions.match(/await actorOf\(user\)/g)).toHaveLength(5);
      expect(actions).toContain("sendo.actor(user.userId, user.tenantId)");
      expect(actions).toContain('assertCan(actor, "rules.manage")');

      const page = fileByTarget(built, "app/(protected)/inbox/rules/page.tsx").content;
      expect(page).toContain('can(actor, "rules.manage")');

      const config = fileByTarget(built, "app/(protected)/inbox/rules/rules-config.ts").content;
      expect(config).toContain("// TODO: implement requireUser()");
      expect(config).toContain("Promise.reject(");

      const route = fileByTarget(built, "app/api/sendo/tick/route.ts").content;
      expect(route).toContain("export const maxDuration = 60;");
      expect(route).toMatch(/export const GET = tick;\s+export const POST = tick;/);
      expect(Object.keys(built.envVars ?? {})).toEqual(["SENDO_CRON_SECRET"]);
      expect(built.files.map((file) => file.target)).toEqual(
        expect.arrayContaining([
          "components/sendo/workflows/AGENTS.md",
          "components/sendo/workflows/MOTION.md",
        ]),
      );
    });
  });

  describe("metrics", () => {
    const item = () => readItem("metrics");

    it("guards every server action with requireUser(), then the metrics.view actor; cost needs costs.view", () => {
      const built = item();
      const actions = fileByTarget(built, "app/(protected)/inbox/metrics/actions.ts").content;
      expect(actions.startsWith('"use server";')).toBe(true);
      const exported = [
        ...actions.matchAll(
          /export async function (\w+)\([^]*?\{\n {2}const user = await requireUser\(\);/g,
        ),
      ];
      expect(exported.map((match) => match[1])).toEqual(["loadMetrics"]);
      expect(actions.match(/export async function/g)).toHaveLength(1);
      expect(actions).toContain("sendo.actor(user.userId, user.tenantId)");
      expect(actions).toContain('assertCan(actor, "metrics.view")');
      expect(actions).toMatch(/can\(actor, "costs\.view"\) \? sendo\.metrics\.cost\(query\)/);

      const page = fileByTarget(built, "app/(protected)/inbox/metrics/page.tsx").content;
      expect(page).toContain('can(actor, "metrics.view")');

      const config = fileByTarget(built, "app/(protected)/inbox/metrics/metrics-config.ts").content;
      expect(config).toContain("// TODO: implement requireUser()");
      expect(config).toContain("Promise.reject(");
      expect(built.files.map((file) => file.target)).toEqual(
        expect.arrayContaining([
          "components/sendo/metrics/AGENTS.md",
          "components/sendo/metrics/MOTION.md",
        ]),
      );
    });
  });
  describe("broadcasts", () => {
    const item = () => readItem("broadcasts");

    it("guards every server action with requireUser(), then the broadcasts.manage actor, and fails closed", () => {
      const built = item();
      const actions = fileByTarget(built, "app/(protected)/inbox/broadcasts/actions.ts").content;
      expect(actions.startsWith('"use server";')).toBe(true);
      const ACTIONS = [
        "cancelBroadcast",
        "createBroadcast",
        "getBroadcast",
        "listAudiences",
        "listBroadcasts",
        "listRecipients",
        "listTemplates",
        "previewBroadcast",
      ];
      const exported = [
        ...actions.matchAll(
          /export async function (\w+)\([^]*?\{\n {2}const user = await requireUser\(\);/g,
        ),
      ];
      expect(exported.map((match) => match[1]).sort()).toEqual(ACTIONS);
      expect(actions.match(/export async function/g)).toHaveLength(ACTIONS.length);
      // Every action resolves the actor (sendo.actor → resolveRole) and needs broadcasts.manage.
      expect(actions.match(/await actorOf\(user\)/g)).toHaveLength(ACTIONS.length);
      expect(actions).toContain("sendo.actor(user.userId, user.tenantId)");
      expect(actions).toContain('assertCan(actor, "broadcasts.manage")');
      // Recipients are resolved on the server from an audience the config offers.
      expect(actions).toContain("broadcastAudiences.recipients(draft.audience, ctx)");

      const page = fileByTarget(built, "app/(protected)/inbox/broadcasts/page.tsx").content;
      expect(page).toContain('can(actor, "broadcasts.manage")');

      const config = fileByTarget(
        built,
        "app/(protected)/inbox/broadcasts/broadcasts-config.ts",
      ).content;
      expect(config).toContain("// TODO: implement requireUser()");
      expect(config).toContain("Promise.reject(");
      expect(built.files.map((file) => file.target)).toEqual(
        expect.arrayContaining([
          "components/sendo/broadcasts/AGENTS.md",
          "components/sendo/broadcasts/MOTION.md",
        ]),
      );
    });
  });
});

/**
 * Route handlers under `app/(protected)/` serve the same data as the server actions, so they get
 * the same guard: every exported HTTP handler calls `requireUser()` (which fails closed in the
 * template) before anything else, and resolves the actor through `sendo.actor` (resolveRole).
 * Ways it could fail: a handler that reads data before `requireUser()`, a second handler in the
 * file without the guard, or a handler that skips the actor (no role check).
 */
describe("route handlers in protected pages", () => {
  type ManifestFile = { path: string; type: string; target?: string };
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "registry/registry.json"), "utf8"),
  ) as {
    items: { name: string; files: ManifestFile[] }[];
  };
  const routes = manifest.items.flatMap((item) =>
    item.files
      .filter((file) => /^app\/\(protected\)\/.*\/route\.ts$/.test(file.target ?? ""))
      .map((file) => [`${item.name}: ${file.target ?? ""}`, file.path] as const),
  );

  it("exist (the numbers export route)", () => {
    expect(routes.map(([name]) => name)).toContain(
      "numbers: app/(protected)/inbox/numbers/export/[id]/route.ts",
    );
  });

  it.each(routes)("%s calls requireUser() first in every handler", (_name, file) => {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    const handlers = [
      ...source.matchAll(/export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD)\b/g),
    ];
    expect(handlers.length).toBeGreaterThan(0);
    const guarded = [
      ...source.matchAll(
        /export async function (GET|POST|PUT|PATCH|DELETE|HEAD)\([^]*?\): Promise<Response> \{\n {2}const user = await requireUser\(\);/g,
      ),
    ];
    expect(guarded.map((match) => match[1])).toEqual(handlers.map((match) => match[1]));
    expect(source).toContain("sendo.actor(user.userId, user.tenantId)");
  });
});

/**
 * AC-AD-3: every item in registry.json (whatever exists when the test runs) ships an AGENTS.md
 * installed at components/sendo/<dir>/AGENTS.md with the sections coding agents rely on, and
 * every item with UI ships its MOTION.md next to it.
 */
describe("agent docs in every registry item", () => {
  type ManifestFile = { path: string; type: string; target?: string };
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "registry/registry.json"), "utf8"),
  ) as {
    items: { name: string; files: ManifestFile[] }[];
  };
  const REQUIRED_SECTIONS = ["## Files", "## Don't touch", "## Connects to", "## Verify"];
  const docTarget = /^components\/sendo\/([a-z0-9-]+)\/(AGENTS|MOTION)\.md$/;

  function shipped(item: (typeof manifest.items)[number], name: "AGENTS.md" | "MOTION.md") {
    return item.files.find((file) => file.path === `registry/items/${item.name}/${name}`);
  }

  it.each(manifest.items.map((item) => [item.name, item] as const))(
    "%s lists AGENTS.md (and MOTION.md when it has UI) with the required sections",
    (_name, item) => {
      const agents = shipped(item, "AGENTS.md");
      expect(
        agents,
        `${item.name}: add registry/items/${item.name}/AGENTS.md to its files`,
      ).toBeDefined();
      const target = docTarget.exec(agents?.target ?? "");
      expect(
        target,
        `${item.name}: AGENTS.md target must be components/sendo/<dir>/AGENTS.md`,
      ).not.toBeNull();

      const text = readFileSync(path.join(REPO_ROOT, agents?.path ?? ""), "utf8");
      expect(
        text.startsWith(`# ${item.name}`),
        `${item.name}: AGENTS.md starts with "# ${item.name}"`,
      ).toBe(true);
      const intro = text.split("\n## ")[0]?.split("\n").slice(1).join(" ").trim() ?? "";
      expect(
        intro.length,
        `${item.name}: AGENTS.md needs an intro saying what the item is`,
      ).toBeGreaterThan(80);
      for (const section of REQUIRED_SECTIONS) {
        expect(text, `${item.name}: AGENTS.md is missing "${section}"`).toMatch(
          new RegExp(`^${section}\\b`, "m"),
        );
      }

      const hasUi = item.files.some((file) => file.path.endsWith(".tsx"));
      const motion = shipped(item, "MOTION.md");
      if (!hasUi) return;
      expect(
        motion,
        `${item.name} has UI: add registry/items/${item.name}/MOTION.md to its files`,
      ).toBeDefined();
      expect(existsSync(path.join(REPO_ROOT, motion?.path ?? ""))).toBe(true);
      expect(motion?.target).toBe(`components/sendo/${target?.[1] ?? ""}/MOTION.md`);
    },
  );
});

/**
 * C8: every UI item ships the same `lib/sendo-ui.ts` (the app's one place for `sendoLocale`), so
 * installing another item never changes it. Ways it could fail: a copy differs from the others
 * (even by whitespace), a copy is installed somewhere other than `lib/sendo-ui.ts`, or a listed
 * copy doesn't exist.
 */
describe("shared lib/sendo-ui.ts", () => {
  type ManifestFile = { path: string; type: string; target?: string };
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "registry/registry.json"), "utf8"),
  ) as {
    items: { name: string; files: ManifestFile[] }[];
  };

  it("is installed at lib/sendo-ui.ts and byte-identical in every item that ships it", () => {
    const copies = manifest.items.flatMap((item) =>
      item.files
        .filter((file) => file.path.endsWith("/lib/sendo-ui.ts"))
        .map((file) => ({ item: item.name, ...file })),
    );
    expect(copies.length, "the inbox ships lib/sendo-ui.ts").toBeGreaterThanOrEqual(1);
    const [first] = copies;
    const reference = readFileSync(path.join(REPO_ROOT, first?.path ?? ""));
    for (const copy of copies) {
      expect(copy.target, `${copy.item}: target of ${copy.path}`).toBe("lib/sendo-ui.ts");
      const file = path.join(REPO_ROOT, copy.path);
      expect(existsSync(file), `${copy.item}: ${copy.path} exists`).toBe(true);
      expect(
        readFileSync(file).equals(reference),
        `${copy.item}: ${copy.path} must be byte-identical to ${first?.path ?? ""}`,
      ).toBe(true);
    }
  });
});
