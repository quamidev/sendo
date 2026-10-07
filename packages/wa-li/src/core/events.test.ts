import { describe, expect, it } from "vitest";
import { captureLogger, makeClient } from "./test-utils";
import { createEmitter } from "./events";
import { createRedactingLogger } from "../utils/logger";

const unrouted = { phoneNumberId: "999", raw: {} };

describe("event emitter", () => {
  it("runs handlers sequentially and returns an unsubscribe function", async () => {
    const { wa, ctx } = makeClient();
    const order: string[] = [];
    wa.on("event.unrouted", async (payload) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`first:${payload.phoneNumberId}`);
    });
    const off = wa.on("event.unrouted", () => {
      order.push("second");
    });
    await ctx.emitter.emit("event.unrouted", unrouted);
    expect(order).toEqual(["first:999", "second"]);

    off();
    off();
    await ctx.emitter.emit("event.unrouted", unrouted);
    expect(order).toEqual(["first:999", "second", "first:999"]);
    expect(ctx.emitter.listenerCount("event.unrouted")).toBe(1);
  });

  it("logs a throwing handler and keeps running the others", async () => {
    const { logs, logger } = captureLogger();
    const emitter = createEmitter(createRedactingLogger(logger));
    const seen: string[] = [];
    emitter.on("event.unrouted", () => {
      throw new Error("boom");
    });
    emitter.on("event.unrouted", () => Promise.reject(new Error("async boom")));
    emitter.on("event.unrouted", () => {
      seen.push("ok");
    });
    await expect(emitter.emit("event.unrouted", unrouted)).resolves.toBeUndefined();
    expect(seen).toEqual(["ok"]);
    expect(logs.of("error")).toHaveLength(2);
    expect(logs.of("error")[0]).toContain("event.unrouted");
    expect(logs.of("error")[0]).toContain("boom");
  });

  it("supports registering the same function twice", async () => {
    const { wa, ctx } = makeClient();
    let calls = 0;
    const handler = () => {
      calls++;
    };
    const offA = wa.on("event.unrouted", handler);
    wa.on("event.unrouted", handler);
    offA();
    await ctx.emitter.emit("event.unrouted", unrouted);
    expect(calls).toBe(1);
  });
});
