import { describe, expect, it } from "vitest";
import { UnsupportedMediaTypeError } from "../errors";
import { assertMediaAcceptable, mediaPath, type MediaPathInput } from "./media";

const makePathInput = (overrides: Partial<MediaPathInput> = {}): MediaPathInput => ({
  tenantId: "tenant-1",
  accountId: "account-1",
  conversationId: "conv-1",
  metaMediaId: "1234567890",
  mime: "image/jpeg",
  ...overrides,
});

describe("mediaPath", () => {
  it("cannot escape its folder", () => {
    const path = mediaPath(
      makePathInput({ metaMediaId: "../../etc/passwd", conversationId: "a/b" }),
    );
    expect(path.split("/")).toHaveLength(4);
    expect(path).not.toContain("..");
  });
});

describe("assertMediaAcceptable", () => {
  it("throws UnsupportedMediaTypeError for a MIME Meta rejects", () => {
    expect(() => {
      assertMediaAcceptable("image", 10, "image/gif");
    }).toThrow(UnsupportedMediaTypeError);
  });

  it("accepts any MIME for documents", () => {
    expect(() => {
      assertMediaAcceptable("document", 10, "application/zip");
    }).not.toThrow();
  });
});
