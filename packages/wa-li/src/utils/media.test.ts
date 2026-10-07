import { describe, expect, it } from "vitest";
import { MediaTooLargeError, UnsupportedMediaTypeError } from "../errors";
import {
  META_MEDIA_LIMITS,
  assertMediaAcceptable,
  extensionForMime,
  mediaPath,
  type MediaPathInput,
} from "./media";

const makePathInput = (overrides: Partial<MediaPathInput> = {}): MediaPathInput => ({
  tenantId: "tenant-1",
  accountId: "account-1",
  conversationId: "conv-1",
  metaMediaId: "1234567890",
  mime: "image/jpeg",
  ...overrides,
});

describe("mediaPath", () => {
  it("builds tenant/account/conversation/mediaId.ext", () => {
    expect(mediaPath(makePathInput())).toBe("tenant-1/account-1/conv-1/1234567890.jpg");
  });

  it("uses _ for a null tenant", () => {
    expect(mediaPath(makePathInput({ tenantId: null }))).toBe("_/account-1/conv-1/1234567890.jpg");
  });

  it("ignores MIME parameters and falls back to bin", () => {
    expect(mediaPath(makePathInput({ mime: "audio/ogg; codecs=opus" }))).toMatch(/\.ogg$/);
    expect(mediaPath(makePathInput({ mime: "application/x-unknown" }))).toMatch(/\.bin$/);
    expect(mediaPath(makePathInput({ mime: null }))).toMatch(/\.bin$/);
  });

  it("cannot escape its folder", () => {
    const path = mediaPath(
      makePathInput({ metaMediaId: "../../etc/passwd", conversationId: "a/b" }),
    );
    expect(path.split("/")).toHaveLength(4);
    expect(path).not.toContain("..");
  });
});

describe("extensionForMime", () => {
  it("maps common WhatsApp types", () => {
    expect(extensionForMime("application/pdf")).toBe("pdf");
    expect(extensionForMime("image/webp")).toBe("webp");
    expect(extensionForMime("VIDEO/MP4")).toBe("mp4");
  });
});

describe("assertMediaAcceptable", () => {
  it("accepts media at the limit", () => {
    expect(() => {
      assertMediaAcceptable("image", META_MEDIA_LIMITS.image, "image/png");
    }).not.toThrow();
  });

  it("throws MediaTooLargeError above the limit", () => {
    expect(() => {
      assertMediaAcceptable("image", META_MEDIA_LIMITS.image + 1, "image/png");
    }).toThrow(MediaTooLargeError);
  });

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
