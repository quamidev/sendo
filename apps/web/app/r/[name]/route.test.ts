import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const TOKEN = "route-token";

function makeContext(name: string) {
  return { params: Promise.resolve({ name }) };
}

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  return new Request("http://localhost:3001/r/item.json", { headers });
}

// The route wires the handler to the environment: SENDO_REGISTRY_DIST_DIR, SENDO_REGISTRY_TOKENS
// and SENDO_REGISTRY_ALLOW_ANONYMOUS come from process.env at request time.
describe("app/r/[name]/route GET", () => {
  let distDir: string;

  beforeEach(async () => {
    distDir = await mkdtemp(path.join(os.tmpdir(), "sendo-route-"));
    await writeFile(path.join(distDir, "schema.json"), JSON.stringify({ name: "schema" }));
    await writeFile(
      path.join(distDir, "sendo-pro.json"),
      JSON.stringify({ name: "sendo-pro", meta: { private: true } }),
    );
    vi.stubEnv("SENDO_REGISTRY_DIST_DIR", distDir);
    vi.stubEnv("SENDO_REGISTRY_TOKENS", TOKEN);
    vi.stubEnv("SENDO_REGISTRY_ALLOW_ANONYMOUS", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(distDir, { recursive: true, force: true });
  });

  it("serves public items from SENDO_REGISTRY_DIST_DIR without a token", async () => {
    const res = await GET(makeRequest(), makeContext("schema.json"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "schema" });
  });

  it("serves the renamed item for its legacy sendo-* name", async () => {
    const res = await GET(makeRequest(), makeContext("sendo-schema.json"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "schema" });
  });

  it("requires a token from SENDO_REGISTRY_TOKENS for private items", async () => {
    expect((await GET(makeRequest(), makeContext("sendo-pro.json"))).status).toBe(401);
    const res = await GET(makeRequest(`Bearer ${TOKEN}`), makeContext("sendo-pro.json"));
    expect(res.status).toBe(200);
  });

  it("serves private items anonymously when SENDO_REGISTRY_ALLOW_ANONYMOUS=1", async () => {
    vi.stubEnv("SENDO_REGISTRY_TOKENS", "");
    vi.stubEnv("SENDO_REGISTRY_ALLOW_ANONYMOUS", "1");
    expect((await GET(makeRequest(), makeContext("sendo-pro.json"))).status).toBe(200);
  });
});
