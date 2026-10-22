/**
 * `proxy.ts` is the routing boundary between unprefixed URLs, the `/{lang}` marketing pages, the
 * English docs and the registry host. Driven with real `NextRequest`s. Ways it can fail:
 *
 * 1. The remembered choice is ignored: a valid `sendo-lang` cookie must beat `Accept-Language`.
 * 2. A bogus cookie (`sendo-lang=fr`) is trusted instead of falling back to detection.
 * 3. Region subtags don't match: `es-GT` must reach `/es`.
 * 4. Unsupported or missing languages don't fall back to `/en` (`fr`, no header).
 * 5. Quality values are ignored: the highest `q` wins and `q=0` means "not this one".
 * 6. Deep links lose their path or query string (`/changelog/x?y=1` → `/en/changelog/x?y=1`).
 * 7. The language redirect is permanent (cached), so a later choice could never apply: must be 307.
 * 8. Paths the proxy must never touch get redirected: `/docs`, `/r`, `/api`, `/_next`,
 *    `/llms*.txt`, static files, the demo iframe (`/demo/inbox`) and already-prefixed pages.
 * 9. The proxy sets a cookie (AC-ST-15: only the language selector may).
 * 10. The registry host serves more than `/r/*` and its index, or redirects to the wrong place
 *     (must be a 308 to the same path and query on `https://sendo.quami.dev`).
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function run(path: string, headers: Record<string, string> = {}, host = "sendo.quami.dev") {
  return proxy(new NextRequest(`https://${host}${path}`, { headers: { host, ...headers } }));
}

function redirectOf(path: string, headers: Record<string, string> = {}) {
  const res = run(path, headers);
  return { status: res.status, location: res.headers.get("location") };
}

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy: language redirect (AC-ST-1)", () => {
  it("[1] a valid sendo-lang cookie wins over Accept-Language", () => {
    expect(redirectOf("/", { cookie: "sendo-lang=es", "accept-language": "en-US,en" })).toEqual({
      status: 307,
      location: "https://sendo.quami.dev/es",
    });
    expect(redirectOf("/pricing", { cookie: "sendo-lang=en", "accept-language": "es" })).toEqual({
      status: 307,
      location: "https://sendo.quami.dev/en/pricing",
    });
  });

  it("[2] an invalid cookie falls back to Accept-Language", () => {
    expect(redirectOf("/", { cookie: "sendo-lang=fr", "accept-language": "es-MX" }).location).toBe(
      "https://sendo.quami.dev/es",
    );
  });

  it("[3] Accept-Language es-GT goes to /es", () => {
    expect(redirectOf("/", { "accept-language": "es-GT,es;q=0.9" }).location).toBe(
      "https://sendo.quami.dev/es",
    );
  });

  it("[4] fr, or no Accept-Language at all, goes to /en", () => {
    expect(redirectOf("/", { "accept-language": "fr-FR,fr;q=0.9" }).location).toBe(
      "https://sendo.quami.dev/en",
    );
    expect(redirectOf("/").location).toBe("https://sendo.quami.dev/en");
  });

  it("[5] respects quality values", () => {
    expect(redirectOf("/", { "accept-language": "fr, en;q=0.5, es;q=0.8" }).location).toBe(
      "https://sendo.quami.dev/es",
    );
    expect(redirectOf("/", { "accept-language": "es;q=0, en;q=0.1" }).location).toBe(
      "https://sendo.quami.dev/en",
    );
    expect(redirectOf("/", { "accept-language": "es;q=0" }).location).toBe(
      "https://sendo.quami.dev/en",
    );
  });

  it("[6] unprefixed deep links keep their path and query", () => {
    for (const [path, target] of [
      ["/pricing", "/es/pricing"],
      ["/demo", "/es/demo"],
      ["/compare", "/es/compare"],
      ["/privacy", "/es/privacy"],
      ["/terms", "/es/terms"],
      ["/data-deletion", "/es/data-deletion"],
      ["/changelog/x?y=1", "/es/changelog/x?y=1"],
    ] as const) {
      expect(redirectOf(path, { "accept-language": "es-GT" }).location).toBe(
        `https://sendo.quami.dev${target}`,
      );
    }
  });

  it("[7] the language redirect is a 307", () => {
    expect(redirectOf("/changelog").status).toBe(307);
  });

  it("[8] never touches docs, registry, API, Next assets, llms files, static files, the demo frame or prefixed pages", () => {
    for (const path of [
      "/docs",
      "/docs/quickstart",
      "/r/webhook.json",
      "/api/demo",
      "/_next/static/chunks/app.js",
      "/llms.txt",
      "/llms-full.txt",
      "/icon.svg",
      "/demo/inbox",
      "/demo/inbox?lang=es",
      "/es",
      "/en/pricing",
      "/es/changelog",
    ]) {
      const res = run(path, { "accept-language": "es", cookie: "sendo-lang=es" });
      expect(passes(res), path).toBe(true);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("[9] sets no cookie", () => {
    for (const res of [
      run("/", { "accept-language": "es" }),
      run("/pricing", { cookie: "sendo-lang=en" }),
      run("/docs"),
      run("/pricing", {}, "registry.sendo.quami.dev"),
    ]) {
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });
});

describe("proxy: registry host (AC-ST-14)", () => {
  const registry = (path: string, headers: Record<string, string> = {}) =>
    run(path, headers, "registry.sendo.quami.dev");

  it("[10] serves /r/* and the JSON index at /, and sends everything else to sendo.quami.dev with a 308", () => {
    expect(passes(registry("/r/webhook.json"))).toBe(true);
    expect(passes(registry("/r/registry.json"))).toBe(true);

    const index = registry("/", { "accept-language": "es" });
    expect(index.headers.get("x-middleware-rewrite")).toBe("https://registry.sendo.quami.dev/r");
    expect(index.headers.get("location")).toBeNull();

    for (const path of ["/pricing", "/docs/quickstart", "/es", "/llms.txt", "/api/demo?x=1"]) {
      const res = registry(path);
      expect(res.status, path).toBe(308);
      expect(res.headers.get("location"), path).toBe(`https://sendo.quami.dev${path}`);
    }

    const withPort = run("/pricing", {}, "Registry.Sendo.Quami.Dev:443");
    expect(withPort.headers.get("location")).toBe("https://sendo.quami.dev/pricing");
  });
});
