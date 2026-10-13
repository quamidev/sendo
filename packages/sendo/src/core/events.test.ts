import { describe, expect, it } from "vitest";
import { captureLogger } from "./test-utils";
import { createEmitter } from "./events";
import { createRedactingLogger } from "../utils/logger";

const unrouted = {
  reason: "unknown_account",
  object: "whatsapp_business_account",
  phoneNumberId: "999",
  raw: {},
} as const;

describe("event emitter", () => {
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
});
