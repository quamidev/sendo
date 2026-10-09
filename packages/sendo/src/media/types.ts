/**
 * Where media bytes live (product spec AC-AP-3). Paths are the `storagePath` of `sendo_media`
 * rows (`{tenant}/{account}/{conversation}/{metaMediaId}.{ext}`). Every method is async.
 *
 * Shipped: `supabaseStorage()` (`@quami/sendo/storage/supabase`, the Supabase adapter's default)
 * and `s3Storage()` (`@quami/sendo/storage/s3`, S3, R2 and other S3-compatible stores). Pass
 * your own as `createSendo({ media })`.
 */
export interface MediaStore {
  /** Stores (or replaces) the object. */
  put(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  /** The object's bytes, or `null` when it doesn't exist (agents read images, voice notes). */
  get(path: string): Promise<Uint8Array | null>;
  /** A time-limited URL the browser can download the object from. */
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
  /** Deletes the objects; paths that don't exist are ignored. `[]` does nothing. */
  delete(paths: string[]): Promise<void>;
  /** Whether the bucket exists and is reachable (`sendo doctor`). */
  exists?(): Promise<boolean>;
}
