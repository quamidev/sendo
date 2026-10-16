/**
 * Registry access boundary (AC-ST-4): items are public unless `meta.private === true`; private
 * items need a bearer token from `SENDO_REGISTRY_TOKENS` and fail closed.
 *
 * Ways it could fail:
 * 1. A public item demands a token (shadcn add breaks for everyone).
 * 2. A private item is served without a token, with a wrong token, with a non-bearer scheme, or
 *    when no tokens are configured (fail open).
 * 3. A private item is cached publicly by the CDN, or a public item loses its cache header
 *    (`public, max-age=300, s-maxage=3600`: browsers 5 min, Vercel's CDN 1 h).
 * 4. The catalog (`registry.json`) lists private items to anonymous callers.
 * 5. `SENDO_REGISTRY_ALLOW_ANONYMOUS` accepts values other than "1".
 * 6. Names escape the dist directory (traversal, symlinks) or bypass the name pattern.
 * 7. A legacy `sendo-<x>` name (C10) serves a different body than `<x>`, or skips `<x>`'s auth
 *    or cache rules; an inherited object key (`constructor`) resolves as an alias.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RegistryAuthEnv } from "./auth";
import { handleRegistryRequest } from "./handler";

const TOKEN = "token-abc-123";
const PUBLIC_CACHE = "public, max-age=300, s-maxage=3600";
const PRIVATE_CACHE = "private, no-store";
const OTHER_TOKEN = "token-second";
const PUBLIC_ITEM = { name: "webhook", type: "registry:item", files: [] };
/** Private only in this test, to check that a legacy name keeps the auth rules of its target. */
const PRIVATE_ALIASED_ITEM = {
  name: "inbox",
  type: "registry:item",
  files: [],
  meta: { private: true },
};
const PRIVATE_ITEM = {
  name: "sendo-pro",
  type: "registry:item",
  files: [],
  meta: { private: true },
};
const INDEX = {
  name: "sendo",
  homepage: "https://registry.sendo.quami.dev",
  items: [PUBLIC_ITEM, PRIVATE_ITEM],
};

let root: string;
let distDir: string;
/** A dist dir whose catalog lists only public items. */
let publicDistDir: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "sendo-registry-"));
  distDir = path.join(root, "registry-dist");
  await mkdir(distDir);
  await writeFile(path.join(distDir, "webhook.json"), JSON.stringify(PUBLIC_ITEM));
  await writeFile(path.join(distDir, "inbox.json"), JSON.stringify(PRIVATE_ALIASED_ITEM));
  await writeFile(path.join(distDir, "sendo-pro.json"), JSON.stringify(PRIVATE_ITEM));
  await writeFile(path.join(distDir, "registry.json"), JSON.stringify(INDEX));
  await writeFile(path.join(root, "secret.json"), JSON.stringify({ secret: true }));
  await symlink(path.join(root, "secret.json"), path.join(distDir, "escape.json"));
  publicDistDir = path.join(root, "public-dist");
  await mkdir(publicDistDir);
  await writeFile(
    path.join(publicDistDir, "registry.json"),
    JSON.stringify({ ...INDEX, items: [PUBLIC_ITEM] }),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://registry.sendo.quami.dev/r/item.json", { headers });
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
      const res = await serve("webhook.json", undefined, env);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("cache-control")).toBe(PUBLIC_CACHE);
      expect(await res.json()).toEqual(PUBLIC_ITEM);
    }
  });

  it("ignores a wrong token on a public item", async () => {
    expect((await serve("webhook.json", "Bearer nope")).status).toBe(200);
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
      expect(res.headers.get("cache-control")).toBe(PRIVATE_CACHE);
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
    expect(anonymous.headers.get("cache-control")).toBe(PRIVATE_CACHE);
    const anonymousIndex = (await anonymous.json()) as typeof INDEX;
    expect(anonymousIndex.items.map((item) => item.name)).toEqual(["webhook"]);

    const withToken = (await (
      await serve("registry.json", `Bearer ${TOKEN}`)
    ).json()) as typeof INDEX;
    expect(withToken.items.map((item) => item.name)).toEqual(["webhook", "sendo-pro"]);
  });

  it("is cacheable by the CDN when it lists only public items", async () => {
    const res = await handleRegistryRequest(makeRequest(), "registry.json", {
      distDir: publicDistDir,
      env: makeEnv(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(PUBLIC_CACHE);
  });
});

describe("GET /r/[name].json — legacy sendo-* names", () => {
  it("serves the new item's body byte for byte with the same headers", async () => {
    const current = await serve("webhook.json");
    const legacy = await serve("sendo-webhook.json");
    expect(legacy.status).toBe(200);
    expect(await legacy.text()).toBe(await current.text());
    expect([...legacy.headers]).toEqual([...current.headers]);
    expect(legacy.headers.get("cache-control")).toBe(PUBLIC_CACHE);
  });

  it("keeps the new item's auth rules", async () => {
    expect((await serve("sendo-inbox.json")).status).toBe(401);
    const res = await serve("sendo-inbox.json", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(PRIVATE_CACHE);
    expect(await res.json()).toEqual(PRIVATE_ALIASED_ITEM);
  });

  it("does not resolve inherited object keys as aliases", async () => {
    expect((await serve("constructor.json")).status).toBe(404);
  });
});

describe("GET /r/[name].json — names", () => {
  it.each([
    "../secret.json",
    "..%2Fsecret.json",
    "/etc/passwd.json",
    "..\\secret.json",
    "Sendo-Webhook.json",
    "webhook",
    "webhook.json.json",
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
