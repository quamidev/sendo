import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DIST_DIR = path.join(REPO_ROOT, "apps/web/registry-dist");
const ITEM_NAMES = ["wa-li-webhook", "wa-li-schema", "wa-li-inbox"] as const;

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

function source(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, "registry", relativePath), "utf8");
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

  it("emits one JSON file per declared item", () => {
    const manifest = JSON.parse(source("registry.json")) as {
      name: string;
      items: { name: string }[];
    };
    expect(manifest.name).toBe("@quami");
    expect(manifest.items.map((item) => item.name)).toEqual([...ITEM_NAMES]);
    for (const name of ITEM_NAMES) {
      expect(readItem(name).name).toBe(name);
    }
  });

  describe("wa-li-webhook", () => {
    const item = () => readItem("wa-li-webhook");

    it("installs the webhook route with the spec content", () => {
      const route = fileByTarget(item(), "app/api/whatsapp/route.ts");
      expect(route.content).toBe(source("items/wa-li-webhook/app/api/whatsapp/route.ts"));
      expect(route.content).toContain('import { wa } from "@/lib/whatsapp";');
      expect(route.content).toContain("export const { GET, POST } = toNextHandlers(wa);");
      expect(route.content).toContain('export const runtime = "nodejs";');
      expect(route.content).toContain("export const maxDuration = 60;");
    });

    it("installs the client config with the Supabase adapter and TODO hooks", () => {
      const lib = fileByTarget(item(), "lib/whatsapp.ts");
      expect(lib.content).toBe(source("items/wa-li-webhook/lib/whatsapp.ts"));
      expect(lib.content).toContain("createWhatsApp(");
      expect(lib.content).toContain("supabaseAdapter(");
      expect(lib.content).toContain('process.env.WA_STORAGE_BUCKET ?? "whatsapp-media"');
      expect(lib.content).toContain("process.env[account.tokenRef]");
      expect(lib.content).toMatch(/TODO[^\n]*\n[^\n]*\n\s*linkContact:/);
      expect(lib.content).toMatch(/TODO[^\n]*\n[^\n]*\n\s*resolveHandoffTargets:/);
      expect(lib.content).toContain("WA_AGENT_MODEL");
    });

    it("declares dependencies, env vars and docs", () => {
      const built = item();
      expect(built.dependencies).toEqual(["@quami/wa-li", "@supabase/supabase-js"]);
      expect(Object.keys(built.envVars ?? {}).sort()).toEqual(
        [
          "NEXT_PUBLIC_SUPABASE_URL",
          "SUPABASE_SERVICE_ROLE_KEY",
          "WA_AGENT_MODEL",
          "WA_APP_SECRET",
          "WA_STORAGE_BUCKET",
          "WA_TOKEN_MAIN",
          "WA_VERIFY_TOKEN",
        ].sort(),
      );
      expect(built.docs).toContain("/api/whatsapp");
    });
  });

  describe("wa-li-schema", () => {
    it("installs the migration under supabase/migrations with no dependencies", () => {
      const built = readItem("wa-li-schema");
      const target = "supabase/migrations/20261006000000_quami_whatsapp_v1.sql";
      const migration = fileByTarget(built, target);
      expect(migration.type).toBe("registry:file");
      expect(migration.content).toBe(source(`items/wa-li-schema/${target}`));
      expect(migration.content).toMatch(/create table if not exists public\.wa_accounts/i);
      expect(built.dependencies ?? []).toEqual([]);
    });
  });

  describe("wa-li-inbox", () => {
    const item = () => readItem("wa-li-inbox");
    const componentNames = [
      "inbox",
      "conversation-list",
      "thread",
      "message-bubble",
      "composer",
      "template-picker",
      "window-indicator",
      "status-ticks",
      "media-preview",
    ];

    it("installs the inbox components, page, server actions and realtime hook", () => {
      const built = item();
      expect(built.type).toBe("registry:item");
      for (const name of componentNames) {
        const file = fileByTarget(built, `components/whatsapp/${name}.tsx`);
        expect(file.type).toBe("registry:component");
        expect(file.content.startsWith('"use client";')).toBe(true);
        expect(file.content).toBe(source(`items/wa-li-inbox/components/whatsapp/${name}.tsx`));
      }
      expect(fileByTarget(built, "components/whatsapp/strings.ts").content).toContain(
        "export const defaultInboxStrings: InboxStrings",
      );
      expect(fileByTarget(built, "app/(protected)/whatsapp/page.tsx").type).toBe("registry:page");
      expect(fileByTarget(built, "hooks/use-whatsapp-realtime.ts").type).toBe("registry:hook");
      expect(fileByTarget(built, "lib/whatsapp-realtime.ts").type).toBe("registry:lib");
      expect(built.files.every((file) => !file.target?.endsWith(".test.tsx"))).toBe(true);
    });

    it("ships the motion tokens", () => {
      const css = fileByTarget(item(), "components/whatsapp/motion.css");
      expect(css.type).toBe("registry:file");
      expect(css.content).toContain("--wa-ease-out");
      expect(css.content).toContain("prefers-reduced-motion");
    });

    it("guards every server action with requireUser(), which fails closed in the template", () => {
      const built = item();
      const actions = fileByTarget(built, "app/(protected)/whatsapp/actions.ts").content;
      expect(actions.startsWith('"use server";')).toBe(true);
      const exported = [
        ...actions.matchAll(
          /export async function (\w+)\([^]*?\{\n {2}const user = await requireUser\(\);/g,
        ),
      ];
      expect(exported.map((match) => match[1]).sort()).toEqual(
        [
          "close",
          "list",
          "listTemplates",
          "markSeen",
          "reply",
          "returnToAgent",
          "take",
          "thread",
        ].sort(),
      );
      expect(actions.match(/export async function/g)).toHaveLength(8);
      expect(actions).toContain("{ by: user.userId }");
      expect(actions).toContain('status: "APPROVED"');

      const config = fileByTarget(built, "app/(protected)/whatsapp/inbox-config.ts").content;
      expect(config).toContain("// TODO: implement requireUser()");
      expect(config).toContain("Promise.reject(");
    });

    it("declares shadcn primitives, npm dependencies and docs", () => {
      const built = item() as BuiltItem & { registryDependencies?: string[] };
      expect(built.registryDependencies).toEqual([
        "button",
        "input",
        "textarea",
        "badge",
        "avatar",
        "scroll-area",
        "tabs",
        "dialog",
        "select",
        "tooltip",
        "sonner",
        "sheet",
      ]);
      expect(built.dependencies).toEqual([
        "@quami/wa-li",
        "@supabase/supabase-js",
        "date-fns",
        "motion",
      ]);
      expect(built.docs).toContain("requireUser()");
    });
  });
});
