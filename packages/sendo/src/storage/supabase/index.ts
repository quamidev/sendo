import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseAdapterError,
  isStorageNotFound,
  type StorageErrorLike,
} from "../../adapters/supabase/errors";
import type { MediaStore } from "../../media/types";

export type { MediaStore } from "../../media/types";

export interface SupabaseStorageOptions {
  /** A SERVICE ROLE Supabase client (the bucket is private). */
  client: SupabaseClient;
  /** Private Storage bucket, e.g. `sendo-media`. */
  bucket: string;
  /** TTL used when `signedUrl` is called with a non-positive TTL. Default 3600. */
  signedUrlTtlSec?: number;
}

const DEFAULT_SIGNED_URL_TTL_SEC = 3600;
/** Objects per Storage `remove` call. */
const REMOVE_BATCH = 100;

function failure(operation: string, error: StorageErrorLike): SupabaseAdapterError {
  return new SupabaseAdapterError(operation, error);
}

/**
 * `MediaStore` on a private Supabase Storage bucket. The Supabase adapter uses it by default
 * (`supabaseAdapter(client, { storageBucket })`); errors are `SupabaseAdapterError`s.
 */
export function supabaseStorage(options: SupabaseStorageOptions): MediaStore {
  const { client, bucket } = options;
  const defaultTtl = options.signedUrlTtlSec ?? DEFAULT_SIGNED_URL_TTL_SEC;
  const objects = () => client.storage.from(bucket);

  return {
    async put(path, bytes, mimeType) {
      const { error } = await objects().upload(path, bytes, {
        contentType: mimeType,
        upsert: true,
      });
      if (error) throw failure("storage.put", error);
    },
    async get(path) {
      const { data, error } = await objects().download(path);
      if (error) {
        if (isStorageNotFound(error)) return null;
        throw failure("storage.get", error);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async signedUrl(path, ttlSeconds) {
      const ttl = ttlSeconds > 0 ? Math.ceil(ttlSeconds) : defaultTtl;
      const { data, error } = await objects().createSignedUrl(path, ttl);
      if (error) throw failure("storage.signedUrl", error);
      return data.signedUrl;
    },
    async delete(paths) {
      const unique = [...new Set(paths)];
      for (let i = 0; i < unique.length; i += REMOVE_BATCH) {
        const { error } = await objects().remove(unique.slice(i, i + REMOVE_BATCH));
        if (error && !isStorageNotFound(error)) throw failure("storage.delete", error);
      }
    },
    async exists() {
      const { data, error } = await client.storage.getBucket(bucket);
      if (error) {
        if (isStorageNotFound(error)) return false;
        throw failure("storage.exists", error);
      }
      return data.id === bucket || data.name === bucket;
    },
  };
}
