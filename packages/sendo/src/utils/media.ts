import { MediaTooLargeError, UnsupportedMediaTypeError } from "../errors/errors";
import type { TenantId } from "../types/entities";
import type { MediaType } from "../types/enums";

const MB = 1024 * 1024;
const KB = 1024;

/** Meta Cloud API per-type upload limits, in bytes. Stickers: 500 KB animated (100 KB static). */
export const META_MEDIA_LIMITS: Readonly<Record<MediaType, number>> = {
  image: 5 * MB,
  audio: 16 * MB,
  video: 16 * MB,
  document: 100 * MB,
  sticker: 500 * KB,
};

/** MIME types Meta accepts per media type. Documents accept any type. */
export const META_MEDIA_MIME_TYPES: Readonly<
  Record<Exclude<MediaType, "document">, readonly string[]>
> = {
  image: ["image/jpeg", "image/png"],
  audio: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
  video: ["video/mp4", "video/3gpp"],
  sticker: ["image/webp"],
};

function baseMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

/** Throws `MediaTooLargeError` or `UnsupportedMediaTypeError` when Meta would reject the upload. */
export function assertMediaAcceptable(
  mediaType: MediaType,
  sizeBytes: number,
  mime?: string,
): void {
  const limitBytes = META_MEDIA_LIMITS[mediaType];
  if (sizeBytes > limitBytes) throw new MediaTooLargeError({ mediaType, sizeBytes, limitBytes });
  if (mime === undefined || mediaType === "document") return;
  if (!META_MEDIA_MIME_TYPES[mediaType].includes(baseMime(mime))) {
    throw new UnsupportedMediaTypeError({ mediaType, mimeType: mime });
  }
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
};

/** File extension for a MIME type (parameters like `; codecs=opus` are ignored); `bin` when unknown. */
export function extensionForMime(mime: string | null | undefined): string {
  if (!mime) return "bin";
  return MIME_EXTENSIONS[baseMime(mime)] ?? "bin";
}

export interface MediaPathInput {
  tenantId: TenantId;
  accountId: string;
  conversationId: string;
  metaMediaId: string;
  mime: string | null | undefined;
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return cleaned === "" ? "_" : cleaned;
}

/** Storage path `{tenantId ?? "_"}/{accountId}/{conversationId}/{metaMediaId}.{ext}`. */
export function mediaPath(input: MediaPathInput): string {
  return [
    input.tenantId === null ? "_" : safeSegment(input.tenantId),
    safeSegment(input.accountId),
    safeSegment(input.conversationId),
    `${safeSegment(input.metaMediaId)}.${extensionForMime(input.mime)}`,
  ].join("/");
}
