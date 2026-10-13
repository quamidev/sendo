import { ConfigError } from "../errors/errors";
import type { MediaStore } from "./types";

export type { MediaStore } from "./types";

const REQUIRED_METHODS = ["put", "get", "signedUrl", "delete"] as const;

/** Throws `ConfigError` when `value` isn't a `MediaStore` (JS callers may pass anything). */
export function assertMediaStore(value: unknown, name: string): asserts value is MediaStore {
  if (typeof value !== "object" || value === null) {
    throw new ConfigError(
      `${name} must be a MediaStore: { put, get, signedUrl, delete, exists? }. Use supabaseStorage() from @quami/sendo/storage/supabase or s3Storage() from @quami/sendo/storage/s3.`,
    );
  }
  const record = value as Record<string, unknown>;
  const missing = REQUIRED_METHODS.filter((method) => typeof record[method] !== "function");
  if (missing.length > 0) {
    throw new ConfigError(
      `${name} is missing ${missing.join(", ")}. A MediaStore needs put, get, signedUrl and delete.`,
    );
  }
  if (record.exists !== undefined && typeof record.exists !== "function") {
    throw new ConfigError(`${name}.exists must be a function when set.`);
  }
}

/** `config.media`, else the adapter's default store, else `null` (no media storage). */
export function resolveMediaStore(
  media: MediaStore | undefined,
  adapterStore: MediaStore | undefined,
): MediaStore | null {
  if (media !== undefined) {
    assertMediaStore(media, "createSendo: `media`");
    return media;
  }
  return adapterStore ?? null;
}

/** Error text when media must be stored or read but nothing is configured. */
export const NO_MEDIA_STORE_MESSAGE =
  "No media storage configured: pass `media` to createSendo (supabaseStorage() or s3Storage()) or use an adapter with a default store.";
