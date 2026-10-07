import { describe, expect, it } from "vitest";
import { MetaApiError } from "../errors/meta-api-error";
import { createRedactingLogger, type LogFn, type Logger, redactLogValue } from "./logger";
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
  it("forwards every level", () => {
    const { logger, calls } = capture();
    const log = createRedactingLogger(logger);
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(calls.map((c) => c.level)).toEqual(["debug", "info", "warn", "error"]);
  });

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

  it("reads secrets lazily so tokens registered later are redacted", () => {
    const { logger, calls } = capture();
    const secrets: string[] = [];
    const log = createRedactingLogger(logger, () => secrets);
    secrets.push(SECRET);
    log.error(SECRET);
    expect(serialized(calls)).not.toContain(SECRET);
  });

  it("redacts errors including message, stack and cause chain", () => {
    const { logger, calls } = capture();
    const log = createRedactingLogger(logger, () => [SECRET]);
    const error = new Error(`outer ${SECRET}`, { cause: new Error(`inner ${SECRET}`) });
    log.error("failed", error);
    const text = serialized(calls);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("inner");
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

  it("is a no-op without a base logger or level", () => {
    expect(() => {
      createRedactingLogger(undefined).info("x");
    }).not.toThrow();
    const calls: unknown[] = [];
    const log = createRedactingLogger({
      warn: (...args: unknown[]) => {
        calls.push(args);
      },
    });
    log.debug("ignored");
    log.warn("kept");
    expect(calls).toHaveLength(1);
  });

  it("keeps MetaApiError output free of secrets", () => {
    const { logger, calls } = capture();
    const log = createRedactingLogger(logger, () => [SECRET]);
    log.error(MetaApiError.fromResponse(401, { error: { code: 190, message: `bad ${SECRET}` } }));
    expect(serialized(calls)).not.toContain(SECRET);
  });
});

describe("redactLogValue", () => {
  it("passes primitives through", () => {
    expect(redactLogValue(42)).toBe(42);
    expect(redactLogValue(true)).toBe(true);
    expect(redactLogValue(null)).toBeNull();
  });
});
