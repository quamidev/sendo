import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { handleRegistryRequest } from "./handler";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const DIST_DIR = path.join(REPO_ROOT, "apps/web/registry-dist");
const TOKEN = "built-items-token";
const env = { QUAMI_REGISTRY_TOKENS: TOKEN };

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost:3001/r/wa-li-webhook.json", { headers });
}

type BuiltItem = { name: string; files: { target?: string; content: string }[] };

describe("registry endpoint with the built registry", () => {
  beforeAll(() => {
    if (existsSync(path.join(DIST_DIR, "wa-li-webhook.json"))) return;
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

  it("serves the built wa-li-webhook item with a valid token", async () => {
    const res = await handleRegistryRequest(makeRequest(`Bearer ${TOKEN}`), "wa-li-webhook.json", {
      distDir: DIST_DIR,
      env,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const item = (await res.json()) as BuiltItem;
    expect(item.name).toBe("wa-li-webhook");
    const route = item.files.find((file) => file.target === "app/api/whatsapp/route.ts");
    expect(route?.content).toContain("toNextHandlers(wa)");
  });

  it("rejects the built item without a token", async () => {
    const res = await handleRegistryRequest(makeRequest(), "wa-li-webhook.json", {
      distDir: DIST_DIR,
      env,
    });
    expect(res.status).toBe(401);
  });
});
