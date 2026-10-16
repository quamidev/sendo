/**
 * The registry host rule in `proxy.ts`, over HTTP with `Host: registry.sendo.quami.dev` (SNL-7.1). The
 * live domain and HTTPS are the deploy checks in `docs/deploy.md`; this is the code part.
 *
 * - [AC-ST-14] [AC-RR-2] `/r/webhook.json` answers 200 with the registry item.
 * - [AC-RR-2] the legacy alias `/r/sendo-webhook.json` answers 200 with the identical body.
 * - [AC-ST-14] a non-registry path (`/pricing?x=1`) is a 308 to the same path on
 *   `https://sendo.quami.dev`.
 */
import { expect, test } from "@playwright/test";

const REGISTRY_HOST = "registry.sendo.quami.dev";

test.describe("[AC-ST-14] [AC-RR-2] registry host", () => {
  test.use({ extraHTTPHeaders: { host: REGISTRY_HOST } });

  test("[AC-ST-14] [AC-RR-2] /r/webhook.json and its legacy alias answer with the same item", async ({
    request,
  }) => {
    const current = await request.get("/r/webhook.json", { maxRedirects: 0 });
    expect(current.status()).toBe(200);
    expect(current.headers()["content-type"]).toContain("application/json");
    const body = await current.text();
    expect(JSON.parse(body)).toMatchObject({ name: "webhook" });

    const legacy = await request.get("/r/sendo-webhook.json", { maxRedirects: 0 });
    expect(legacy.status()).toBe(200);
    expect(await legacy.text()).toBe(body);
  });

  test("[AC-ST-14] /pricing on the registry host is a 308 to sendo.quami.dev", async ({
    request,
  }) => {
    const response = await request.get("/pricing?x=1", { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe("https://sendo.quami.dev/pricing?x=1");
  });
});
