import { describe, expect, it } from "vitest";
import * as waLi from "./index";

describe("@quami/wa-li main entry", () => {
  it("exports the schema version", () => {
    expect(waLi.WA_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    "WhatsAppError",
    "WindowClosedError",
    "TemplateNotFoundError",
    "TemplateVariablesError",
    "MetaApiError",
    "AccountNotFoundError",
    "AmbiguousAccountError",
    "MediaTooLargeError",
    "SignatureError",
    "InvalidPhoneError",
    "ConfigError",
    "NotImplementedError",
    "PayloadValidationError",
    "normalizePhone",
    "windowStatus",
    "statusRank",
    "canTransition",
    "mediaPath",
    "META_MEDIA_LIMITS",
    "MESSAGE_TYPES",
  ])("exports %s", (name) => {
    expect(waLi).toHaveProperty(name);
  });

  it("includes the storage-only message types", () => {
    expect(waLi.MESSAGE_TYPES).toEqual(
      expect.arrayContaining(["template", "unsupported", "status_placeholder"]),
    );
  });
});
