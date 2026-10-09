import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RegistryAuthEnv } from "./auth";
import { handleRegistryRequest } from "./handler";

const TOKEN = "token-abc-123";
const OTHER_TOKEN = "token-second";
const ITEM = { name: "wa-li-webhook", type: "registry:item", files: [] };

let root: string;
let distDir: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "wa-li-registry-"));
  distDir = path.join(root, "registry-dist");
  await mkdir(distDir);
  await writeFile(path.join(distDir, "wa-li-webhook.json"), JSON.stringify(ITEM));
  await writeFile(path.join(root, "secret.json"), JSON.stringify({ secret: true }));
  await symlink(path.join(root, "secret.json"), path.join(distDir, "escape.json"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://registry.quami.dev/r/item.json", { headers });
}

function makeEnv(overrides: Partial<RegistryAuthEnv> = {}): RegistryAuthEnv {
  return { QUAMI_REGISTRY_TOKENS: `${TOKEN}, ${OTHER_TOKEN}`, ...overrides };
}

function serve(segment: string, authorization?: string, env: RegistryAuthEnv = makeEnv()) {
  return handleRegistryRequest(makeRequest(authorization), segment, { distDir, env });
}

describe("GET /r/[name].json", () => {
  it("returns 200 with the item JSON for a valid token", async () => {
    const res = await serve("wa-li-webhook.json", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual(ITEM);
  });

  it("accepts any token from the comma-separated list", async () => {
    const res = await serve("wa-li-webhook.json", `Bearer ${OTHER_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("returns 401 without an Authorization header", async () => {
    const res = await serve("wa-li-webhook.json");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("returns 401 for a wrong token", async () => {
    expect((await serve("wa-li-webhook.json", "Bearer nope")).status).toBe(401);
    expect((await serve("wa-li-webhook.json", `Bearer ${TOKEN}x`)).status).toBe(401);
  });

  it("returns 401 for a non-bearer scheme", async () => {
    expect((await serve("wa-li-webhook.json", `Basic ${TOKEN}`)).status).toBe(401);
    expect((await serve("wa-li-webhook.json", TOKEN)).status).toBe(401);
  });

  it("fails closed when no tokens are configured", async () => {
    for (const tokens of [undefined, "", " , "]) {
      const res = await serve("wa-li-webhook.json", "Bearer ", { QUAMI_REGISTRY_TOKENS: tokens });
      expect(res.status).toBe(401);
    }
    const res = await serve("wa-li-webhook.json", `Bearer ${TOKEN}`, { QUAMI_REGISTRY_TOKENS: "" });
    expect(res.status).toBe(401);
  });

  it("checks auth before revealing whether an item exists", async () => {
    expect((await serve("does-not-exist.json")).status).toBe(401);
  });

  it.each([
    "../secret.json",
    "..%2Fsecret.json",
    "/etc/passwd.json",
    "..\\secret.json",
    "Wa-Li.json",
    "wa-li-webhook",
    "wa-li-webhook.json.json",
    "wa_li.json",
    ".json",
  ])("rejects invalid or traversal name %s with 400", async (segment) => {
    const res = await serve(segment, `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
  });

  it("does not follow symlinks out of the dist directory", async () => {
    const res = await serve("escape.json", `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it("allows anonymous access when QUAMI_REGISTRY_ALLOW_ANONYMOUS=1", async () => {
    const env = { QUAMI_REGISTRY_ALLOW_ANONYMOUS: "1" };
    expect((await serve("wa-li-webhook.json", undefined, env)).status).toBe(200);
    expect((await serve("missing.json", undefined, env)).status).toBe(404);
  });

  it("ignores anonymous override values other than 1", async () => {
    const env = makeEnv({ QUAMI_REGISTRY_ALLOW_ANONYMOUS: "true" });
    expect((await serve("wa-li-webhook.json", undefined, env)).status).toBe(401);
  });
});
