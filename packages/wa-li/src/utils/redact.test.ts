import { describe, expect, it } from "vitest";
import { REDACTED, redactText } from "./redact";

describe("redactText", () => {
  it("escapes regex characters in secrets and ignores very short ones", () => {
    expect(redactText("a+b(c)* and x", ["a+b(c)*", "x"])).toBe(`${REDACTED} and x`);
  });
});
