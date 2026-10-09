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

describe("app/r/[name]/route GET", () => {
  let distDir: string;

  beforeEach(async () => {
    distDir = await mkdtemp(path.join(os.tmpdir(), "wa-li-route-"));
    await writeFile(
      path.join(distDir, "wa-li-schema.json"),
      JSON.stringify({ name: "wa-li-schema" }),
    );
    vi.stubEnv("QUAMI_REGISTRY_DIST_DIR", distDir);
    vi.stubEnv("QUAMI_REGISTRY_TOKENS", TOKEN);
    vi.stubEnv("QUAMI_REGISTRY_ALLOW_ANONYMOUS", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(distDir, { recursive: true, force: true });
  });

  it("rejects requests without a token", async () => {
    const res = await GET(makeRequest(), makeContext("wa-li-schema.json"));
    expect(res.status).toBe(401);
  });
});
