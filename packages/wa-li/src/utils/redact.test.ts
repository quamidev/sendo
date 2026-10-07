import { describe, expect, it } from "vitest";
import { REDACTED, redactText } from "./redact";

describe("redactText", () => {
  it("removes given secrets, access_token params and bearer credentials", () => {
    const out = redactText(
      "token EAAGsecret123 at https://graph.facebook.com/x?access_token=abc.def&y=1 with Bearer xyz-789",
      ["EAAGsecret123"],
    );
    expect(out).not.toContain("EAAGsecret123");
    expect(out).not.toContain("abc.def");
    expect(out).not.toContain("xyz-789");
    expect(out).toContain(`access_token=${REDACTED}&y=1`);
  });

  it("escapes regex characters in secrets and ignores very short ones", () => {
    expect(redactText("a+b(c)* and x", ["a+b(c)*", "x"])).toBe(`${REDACTED} and x`);
  });
});
