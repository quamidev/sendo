import { describe, expect, it } from "vitest";
import { loadWebhookFixtureText } from "../../test/support/fixtures";
import { signBody, verifySignature } from "./verify";

const secret = "test-app-secret";
const body = loadWebhookFixtureText("text");

describe("verifySignature", () => {
  it.each([
    ["no prefix", signBody(body, secret).slice(7)],
    ["sha1 prefix", `sha1=${signBody(body, secret).slice(7)}`],
    ["non-hex digest", `sha256=${"z".repeat(64)}`],
    ["garbage", "not-a-signature"],
  ])("rejects a malformed header (%s)", (_label, header) => {
    expect(verifySignature(body, header, secret)).toBe(false);
  });

  it("rejects when no app secret is configured", () => {
    expect(verifySignature(body, signBody(body, ""), "")).toBe(false);
  });
});
