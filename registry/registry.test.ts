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

  describe("wa-li-inbox", () => {
    const item = () => readItem("wa-li-inbox");

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
  });
});
