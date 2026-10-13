/**
 * Registry access boundary (AC-ST-4): items are public unless `meta.private === true`; private
 * items need a bearer token from `SENDO_REGISTRY_TOKENS` and fail closed.
 *
 * Ways it could fail:
 * 1. A public item demands a token (shadcn add breaks for everyone).
 * 2. A private item is served without a token, with a wrong token, with a non-bearer scheme, or
 *    when no tokens are configured (fail open).
 * 3. A private item is cached publicly by the CDN.
 * 4. The catalog (`registry.json`) lists private items to anonymous callers.
 * 5. `SENDO_REGISTRY_ALLOW_ANONYMOUS` accepts values other than "1".
 * 6. Names escape the dist directory (traversal, symlinks) or bypass the name pattern.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RegistryAuthEnv } from "./auth";
import { handleRegistryRequest } from "./handler";

const TOKEN = "token-abc-123";
const OTHER_TOKEN = "token-second";
const PUBLIC_ITEM = { name: "sendo-webhook", type: "registry:item", files: [] };
const PRIVATE_ITEM = {
  name: "sendo-pro",
  type: "registry:item",
  files: [],
  meta: { private: true },
};
const INDEX = {
  name: "sendo",
  homepage: "https://registry.sendo.dev",
  items: [PUBLIC_ITEM, PRIVATE_ITEM],
};

let root: string;
let distDir: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "sendo-registry-"));
  distDir = path.join(root, "registry-dist");
  await mkdir(distDir);
  await writeFile(path.join(distDir, "sendo-webhook.json"), JSON.stringify(PUBLIC_ITEM));
  await writeFile(path.join(distDir, "sendo-pro.json"), JSON.stringify(PRIVATE_ITEM));
  await writeFile(path.join(distDir, "registry.json"), JSON.stringify(INDEX));
  await writeFile(path.join(root, "secret.json"), JSON.stringify({ secret: true }));
  await symlink(path.join(root, "secret.json"), path.join(distDir, "escape.json"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://registry.sendo.dev/r/item.json", { headers });
}

function makeEnv(overrides: Partial<RegistryAuthEnv> = {}): RegistryAuthEnv {
  return { SENDO_REGISTRY_TOKENS: `${TOKEN}, ${OTHER_TOKEN}`, ...overrides };
}

function serve(segment: string, authorization?: string, env: RegistryAuthEnv = makeEnv()) {
  return handleRegistryRequest(makeRequest(authorization), segment, { distDir, env });
}

describe("GET /r/[name].json — public items", () => {
  it("serves a public item without a token, even when no tokens are configured", async () => {
    for (const env of [makeEnv(), {}]) {
      const res = await serve("sendo-webhook.json", undefined, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toContain("public");
      expect(await res.json()).toEqual(PUBLIC_ITEM);
    }
  });

  it("ignores a wrong token on a public item", async () => {
    expect((await serve("sendo-webhook.json", "Bearer nope")).status).toBe(200);
  });

  it("returns 404 for an unknown item", async () => {
    expect((await serve("does-not-exist.json")).status).toBe(404);
  });
});

describe("GET /r/[name].json — private items", () => {
  it("serves a private item with any configured token, never cached publicly", async () => {
    for (const token of [TOKEN, OTHER_TOKEN]) {
      const res = await serve("sendo-pro.json", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.json()).toEqual(PRIVATE_ITEM);
    }
  });

  it("returns 401 without a token, with a wrong token or a non-bearer scheme", async () => {
    const missing = await serve("sendo-pro.json");
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect(await missing.text()).not.toContain("sendo-pro");
    for (const header of ["Bearer nope", `Bearer ${TOKEN}x`, `Basic ${TOKEN}`, TOKEN]) {
      expect((await serve("sendo-pro.json", header)).status).toBe(401);
    }
  });

  it("fails closed when no tokens are configured", async () => {
    for (const tokens of [undefined, "", " , "]) {
      const env = { SENDO_REGISTRY_TOKENS: tokens };
      expect((await serve("sendo-pro.json", "Bearer ", env)).status).toBe(401);
      expect((await serve("sendo-pro.json", `Bearer ${TOKEN}`, env)).status).toBe(401);
    }
  });

  it("allows anonymous access only when SENDO_REGISTRY_ALLOW_ANONYMOUS=1", async () => {
    const open = { SENDO_REGISTRY_ALLOW_ANONYMOUS: "1" };
    expect((await serve("sendo-pro.json", undefined, open)).status).toBe(200);
    for (const value of ["true", "yes", "0", ""]) {
      const env = makeEnv({ SENDO_REGISTRY_ALLOW_ANONYMOUS: value });
      expect((await serve("sendo-pro.json", undefined, env)).status).toBe(401);
    }
  });
});

describe("GET /r/registry.json — the catalog", () => {
  it("hides private items from anonymous callers and lists them with a token", async () => {
    const anonymous = await serve("registry.json");
    expect(anonymous.status).toBe(200);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    const anonymousIndex = (await anonymous.json()) as typeof INDEX;
    expect(anonymousIndex.items.map((item) => item.name)).toEqual(["sendo-webhook"]);

    const withToken = (await (
      await serve("registry.json", `Bearer ${TOKEN}`)
    ).json()) as typeof INDEX;
    expect(withToken.items.map((item) => item.name)).toEqual(["sendo-webhook", "sendo-pro"]);
  });
});

describe("GET /r/[name].json — names", () => {
  it.each([
    "../secret.json",
    "..%2Fsecret.json",
    "/etc/passwd.json",
    "..\\secret.json",
    "Sendo-Webhook.json",
    "sendo-webhook",
    "sendo-webhook.json.json",
    "sendo_webhook.json",
    ".json",
  ])("rejects invalid or traversal name %s with 400", async (segment) => {
    const res = await serve(segment, `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
  });

  it("does not follow symlinks out of the dist directory", async () => {
    const res = await serve("escape.json", `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });
});
