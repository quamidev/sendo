/**
 * Isolation test of the tick route's auth boundary (a security boundary, AGENTS.md): the route
 * module is driven directly with `Request`s, and `sendo.maintenance.tick` is a spy. The real tick
 * through this route runs in the playground (`apps/playground/test/tick.test.ts`).
 *
 * Ways it could fail (one test each):
 * 1. A request without `Authorization` runs the tick (anyone on the internet triggers escalations,
 *    auto-close and broadcasts).
 * 2. A wrong bearer runs it: a different secret of the same length, a prefix of the secret, or the
 *    secret with extra characters.
 * 3. The right secret with the wrong scheme runs it (`Basic …`, or the raw secret without `Bearer `).
 * 4. With no secret configured (unset or blank), something like `Bearer ` or `Bearer undefined`
 *    runs it instead of failing closed.
 * 5. The right bearer is rejected, the tick isn't called exactly once, or the TickReport isn't
 *    returned as JSON — for GET (Vercel Cron) and POST (pg_cron `net.http_post`).
 * 6. Vercel's `CRON_SECRET` (what Vercel Cron sends) is not accepted next to `SENDO_CRON_SECRET`.
 * 7. A failing tick answers 200, or leaks its error message in the response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const tick = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sendo", () => ({ sendo: { maintenance: { tick } } }));

const SECRET = "s3cr3t-cron-value-0123456789abcdef";
const REPORT = {
  skipped: false,
  now: new Date("2026-10-09T15:00:00.000Z"),
  durationMs: 12,
  budgetExhausted: false,
  steps: {
    afterHours: { ran: true, count: 1, errors: 0 },
    escalations: { ran: true, count: 2, errors: 0 },
    autoClose: { ran: true, count: 0, errors: 0 },
    broadcasts: { ran: true, count: 0, errors: 0 },
    billing: { ran: true, count: 0, errors: 0 },
    prune: { ran: false, count: 0, errors: 0 },
  },
  escalations: { reassigned: 1, notified: 1, returnedToAgent: 0 },
};

function request(method: "GET" | "POST", authorization?: string): Request {
  return new Request("https://app.example.com/api/sendo/tick", {
    method,
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(() => {
  tick.mockReset();
  tick.mockResolvedValue(REPORT);
  vi.stubEnv("SENDO_CRON_SECRET", SECRET);
  vi.stubEnv("CRON_SECRET", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function expectRejected(response: Response) {
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
}

describe("app/api/sendo/tick/route.ts", () => {
  it("1. rejects a request without Authorization", async () => {
    await expectRejected(await GET(request("GET")));
    await expectRejected(await POST(request("POST")));
    expect(tick).not.toHaveBeenCalled();
  });

  it("2. rejects a wrong bearer: other secret, a prefix, or extra characters", async () => {
    const wrong = [
      `Bearer ${SECRET.replace(/.$/, "X")}`,
      `Bearer ${SECRET.slice(0, -4)}`,
      `Bearer ${SECRET}extra`,
      `Bearer ${SECRET} ${SECRET}`,
    ];
    for (const header of wrong) await expectRejected(await GET(request("GET", header)));
    expect(tick).not.toHaveBeenCalled();
  });

  it("3. rejects the right secret with the wrong scheme", async () => {
    for (const header of [`Basic ${SECRET}`, SECRET, `Token ${SECRET}`]) {
      await expectRejected(await POST(request("POST", header)));
    }
    expect(tick).not.toHaveBeenCalled();
  });

  it("4. fails closed when no secret is configured", async () => {
    for (const value of [undefined, "", "   "]) {
      vi.stubEnv("SENDO_CRON_SECRET", value);
      vi.stubEnv("CRON_SECRET", value);
      for (const header of ["Bearer ", "Bearer undefined", "Bearer null", `Bearer ${SECRET}`]) {
        await expectRejected(await GET(request("GET", header)));
      }
    }
    expect(tick).not.toHaveBeenCalled();
  });

  it("5. runs the tick once with the right bearer and returns the TickReport (GET and POST)", async () => {
    for (const handler of [GET, POST]) {
      tick.mockClear();
      const response = await handler(request(handler === GET ? "GET" : "POST", `Bearer ${SECRET}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({ ...REPORT, now: REPORT.now.toISOString() });
      expect(tick).toHaveBeenCalledTimes(1);
    }
    // The scheme is case-insensitive (RFC 9110); the secret is not.
    expect((await GET(request("GET", `bearer ${SECRET}`))).status).toBe(200);
    await expectRejected(await GET(request("GET", `Bearer ${SECRET.toUpperCase()}`)));
  });

  it("6. accepts Vercel's CRON_SECRET too", async () => {
    vi.stubEnv("CRON_SECRET", "vercel-generated-secret");
    expect((await GET(request("GET", "Bearer vercel-generated-secret"))).status).toBe(200);
    expect((await GET(request("GET", `Bearer ${SECRET}`))).status).toBe(200);
    vi.stubEnv("SENDO_CRON_SECRET", "");
    expect((await GET(request("GET", "Bearer vercel-generated-secret"))).status).toBe(200);
    await expectRejected(await GET(request("GET", `Bearer ${SECRET}`)));
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("7. answers 500 without the error message when the tick throws", async () => {
    tick.mockRejectedValueOnce(
      new Error("connection to db.internal:5432 refused (password=hunter2)"),
    );
    const response = await POST(request("POST", `Bearer ${SECRET}`));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe(JSON.stringify({ error: "tick_failed" }));
  });
});
