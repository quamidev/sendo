import { describe, expect, it } from "vitest";
import { createRedactingLogger, type LogFn, type Logger } from "./logger";
import { REDACTED } from "./redact";

const SECRET = "EAAG-very-secret-token-987";

function capture(): { logger: Logger; calls: { level: string; args: unknown[] }[] } {
  const calls: { level: string; args: unknown[] }[] = [];
  const at =
    (level: string): LogFn =>
    (...args) =>
      calls.push({ level, args });
  return {
    logger: { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") },
    calls,
  };
}

function serialized(calls: { args: unknown[] }[]): string {
  return calls
    .map((c) => c.args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))
    .join("\n");
}

describe("createRedactingLogger", () => {
  it("redacts registered secrets, bearer headers and access_token params in messages and args", () => {
    const { logger, calls } = capture();
    const log = createRedactingLogger(logger, () => [SECRET]);
    log.info(
      `token ${SECRET}`,
      "Authorization: Bearer abc.def-ghi",
      "https://x.dev/?access_token=zzz&a=1",
    );
    log.warn("request", {
      headers: { Authorization: `Bearer ${SECRET}` },
      nested: { deep: [`prefix ${SECRET} suffix`] },
      access_token: "plain-value",
    });
    const text = serialized(calls);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("abc.def-ghi");
    expect(text).not.toContain("zzz");
    expect(text).not.toContain("plain-value");
    expect(text).toContain(REDACTED);
    expect(text).toContain("a=1");
  });

  it("handles circular structures, Headers and binary data", () => {
    const { logger, calls } = capture();
    const log = createRedactingLogger(logger, () => [SECRET]);
    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;
    log.debug(loop, new Headers({ Authorization: `Bearer ${SECRET}` }), new Uint8Array(4));
    const text = serialized(calls);
    expect(text).toContain("[Circular]");
    expect(text).toContain("4 bytes");
    expect(text).not.toContain(SECRET);
  });
});
