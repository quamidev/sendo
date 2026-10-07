import { describe, expect, it } from "vitest";
import {
  AccountNotFoundError,
  AmbiguousAccountError,
  ConfigError,
  DuplicateAccountError,
  InvalidPhoneError,
  MediaTooLargeError,
  MetaApiError,
  NotImplementedError,
  PayloadValidationError,
  RecordNotFoundError,
  SignatureError,
  TemplateNotFoundError,
  TemplateVariablesError,
  UnsupportedMediaTypeError,
  WhatsAppError,
  WindowClosedError,
  isWhatsAppError,
} from ".";

const TOKEN = "EAAGm0PX4ZCpsBAKZCZBSecretToken123";

const makeGraphErrorBody = (message = "Error validating access token: Session has expired") => ({
  error: {
    message,
    type: "OAuthException",
    code: 190,
    error_subcode: 463,
    error_data: { details: `token ${TOKEN} expired` },
    fbtrace_id: "AbCdEf123",
  },
});

describe("error classes", () => {
  const cases: [WhatsAppError, string][] = [
    [new WindowClosedError({ conversationId: "c1", expiresAt: new Date(0) }), "WINDOW_CLOSED"],
    [new TemplateNotFoundError({ name: "hola", language: "es" }), "TEMPLATE_NOT_FOUND"],
    [new TemplateVariablesError({ name: "hola", expected: 2, received: 1 }), "TEMPLATE_VARIABLES"],
    [new MetaApiError({ status: 400, metaCode: 100 }), "META_API_ERROR"],
    [new AccountNotFoundError({ account: "a1" }), "ACCOUNT_NOT_FOUND"],
    [new AmbiguousAccountError({ candidates: ["a1", "a2"] }), "AMBIGUOUS_ACCOUNT"],
    [new DuplicateAccountError({ phoneNumberId: "123" }), "ACCOUNT_EXISTS"],
    [
      new MediaTooLargeError({ mediaType: "image", sizeBytes: 2, limitBytes: 1 }),
      "MEDIA_TOO_LARGE",
    ],
    [
      new UnsupportedMediaTypeError({ mediaType: "image", mimeType: "image/gif" }),
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    [new SignatureError(), "INVALID_SIGNATURE"],
    [new InvalidPhoneError({ input: "x" }), "INVALID_PHONE"],
    [
      new PayloadValidationError({ field: "buttons", message: "max 3", limit: 3 }),
      "INVALID_PAYLOAD",
    ],
    [new RecordNotFoundError({ entity: "message", id: "m1" }), "RECORD_NOT_FOUND"],
    [new ConfigError("two agents match account a1"), "CONFIG_ERROR"],
    [new NotImplementedError("quamiCloud"), "NOT_IMPLEMENTED"],
  ];

  it.each(cases)("%s has a stable code, name and base class", (error, code) => {
    expect(error).toBeInstanceOf(WhatsAppError);
    expect(error).toBeInstanceOf(Error);
    expect(isWhatsAppError(error)).toBe(true);
    expect(error.code).toBe(code);
    expect(error.name).toBe(error.constructor.name);
    expect(error.toJSON()).toMatchObject({ code, name: error.name, message: error.message });
  });

  it("isWhatsAppError rejects plain errors", () => {
    expect(isWhatsAppError(new Error("x"))).toBe(false);
  });

  it("toJSON omits cause and stack", () => {
    const error = new ConfigError("bad", { cause: new Error(`fetch failed ${TOKEN}`) });
    expect(error.cause).toBeInstanceOf(Error);
    const json = JSON.stringify(error);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("stack");
  });
});

describe("MetaApiError", () => {
  it("maps a Graph error body", () => {
    const error = MetaApiError.fromResponse(401, makeGraphErrorBody());
    expect(error).toMatchObject({
      code: "META_API_ERROR",
      status: 401,
      metaCode: 190,
      subcode: 463,
      type: "OAuthException",
      fbtraceId: "AbCdEf123",
    });
    expect(error.isInvalidToken).toBe(true);
    expect(error.message).toContain("190");
  });

  it("handles bodies that are not Graph errors", () => {
    const error = MetaApiError.fromResponse(502, "<html>Bad gateway</html>");
    expect(error).toMatchObject({ status: 502, metaCode: null, subcode: null, fbtraceId: null });
    expect(error.isInvalidToken).toBe(false);
  });

  it("never exposes the token through message, toString, JSON or own properties", () => {
    const error = MetaApiError.fromResponse(
      401,
      makeGraphErrorBody(`Invalid OAuth access token ${TOKEN} (access_token=${TOKEN})`),
      { secrets: [TOKEN] },
    );
    const surfaces = [
      error.message,
      error.toString(),
      JSON.stringify(error),
      JSON.stringify({ wrapped: error }),
      String(error.stack),
      ...Object.values(error).map(String),
    ];
    for (const surface of surfaces) expect(surface).not.toContain(TOKEN);
  });

  it("redacts access_token params even without known secrets", () => {
    const error = new MetaApiError({
      status: 400,
      metaCode: 100,
      message: `bad request to /messages?access_token=${TOKEN}`,
    });
    expect(error.message).not.toContain(TOKEN);
  });
});
