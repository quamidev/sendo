import { describe, expect, it } from "vitest";
import { loadWebhookFixtureText } from "../../test/support/fixtures";
import { signedRequest, signFixture } from "../../test/support/sign";
import { safeEqual, signBody, verifyChallenge, verifySignature } from "./verify";

const secret = "test-app-secret";
const body = loadWebhookFixtureText("text");

describe("verifySignature", () => {
  it("accepts a valid signature for a string body", () => {
    expect(verifySignature(body, signBody(body, secret), secret)).toBe(true);
  });

  it("accepts a valid signature for a byte body", () => {
    const bytes = new TextEncoder().encode(body);
    expect(verifySignature(bytes, signBody(body, secret), secret)).toBe(true);
  });

  it("accepts an uppercase hex digest", () => {
    const header = `sha256=${signBody(body, secret).slice(7).toUpperCase()}`;
    expect(verifySignature(body, header, secret)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "", secret)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifySignature(body, signBody(body, "other-secret"), secret)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = signBody(body, secret);
    expect(verifySignature(body.replace("Hola", "Adiós"), header, secret)).toBe(false);
  });

  it.each([
    ["no prefix", signBody(body, secret).slice(7)],
    ["sha1 prefix", `sha1=${signBody(body, secret).slice(7)}`],
    ["short digest", signBody(body, secret).slice(0, -2)],
    ["non-hex digest", `sha256=${"z".repeat(64)}`],
    ["garbage", "not-a-signature"],
  ])("rejects a malformed header (%s)", (_label, header) => {
    expect(verifySignature(body, header, secret)).toBe(false);
  });

  it("rejects when no app secret is configured", () => {
    expect(verifySignature(body, signBody(body, ""), "")).toBe(false);
  });
});

describe("signFixture / signedRequest", () => {
  it("produces headers that verifySignature accepts", async () => {
    const signed = signFixture({ hello: "world" }, secret);
    expect(signed.headers["content-type"]).toBe("application/json");
    expect(verifySignature(signed.body, signed.headers["x-hub-signature-256"], secret)).toBe(true);

    const request = signedRequest("https://example.test/api/whatsapp", body, secret);
    expect(request.method).toBe("POST");
    const raw = await request.text();
    expect(raw).toBe(body);
    expect(verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)).toBe(true);
  });
});

describe("verifyChallenge", () => {
  const verifyToken = "verify-me";
  const url = (params: Record<string, string>) => {
    const result = new URL("https://example.test/api/whatsapp");
    for (const [key, value] of Object.entries(params)) result.searchParams.set(key, value);
    return result;
  };

  it("echoes the challenge when the token matches", async () => {
    const response = verifyChallenge(
      url({
        "hub.mode": "subscribe",
        "hub.verify_token": verifyToken,
        "hub.challenge": "1158201444",
      }),
      verifyToken,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("1158201444");
  });

  it("returns 403 when the token does not match", async () => {
    const response = verifyChallenge(
      url({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1" }),
      verifyToken,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("1");
  });

  it("returns 403 when the token is missing", () => {
    const response = verifyChallenge(
      url({ "hub.mode": "subscribe", "hub.challenge": "1" }),
      verifyToken,
    );
    expect(response.status).toBe(403);
  });

  it("returns 403 when the mode is not subscribe", () => {
    const response = verifyChallenge(
      url({ "hub.mode": "unsubscribe", "hub.verify_token": verifyToken, "hub.challenge": "1" }),
      verifyToken,
    );
    expect(response.status).toBe(403);
  });

  it("returns 403 when the challenge is missing", () => {
    const response = verifyChallenge(
      url({ "hub.mode": "subscribe", "hub.verify_token": verifyToken }),
      verifyToken,
    );
    expect(response.status).toBe(403);
  });

  it("returns 403 when no verify token is configured", () => {
    const response = verifyChallenge(
      url({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }),
      "",
    );
    expect(response.status).toBe(403);
  });
});

describe("safeEqual", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
