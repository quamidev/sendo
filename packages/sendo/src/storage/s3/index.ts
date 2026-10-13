import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaStore } from "../../media/types";

export type { MediaStore } from "../../media/types";

export interface S3StorageOptions {
  /**
   * An `S3Client` from `@aws-sdk/client-s3` with credentials that can put, get and delete objects
   * in `bucket`. For R2, MinIO and other S3-compatible stores set its `endpoint` (and
   * `forcePathStyle` when the store needs it).
   */
  client: S3Client;
  /** A private bucket. */
  bucket: string;
  /** TTL used when `signedUrl` is called with a non-positive TTL. Default 3600. */
  signedUrlTtlSec?: number;
}

const DEFAULT_SIGNED_URL_TTL_SEC = 3600;
/** SigV4 presigned URLs are valid for at most 7 days. */
export const S3_MAX_SIGNED_URL_TTL_SEC = 604_800;
/** `DeleteObjects` accepts at most 1000 keys per request. */
const DELETE_BATCH = 1000;

/** An S3 call failed (credentials, permissions, network, a missing bucket on `put`...). */
export class S3StorageError extends Error {
  override readonly name = "S3StorageError";
  /** The `MediaStore` operation, e.g. `storage.put`. */
  readonly operation: string;
  /** S3 error code (`AccessDenied`, `NoSuchBucket`...), or `null`. */
  readonly code: string | null;
  /** HTTP status of the S3 response, or `null`. */
  readonly status: number | null;

  constructor(
    operation: string,
    detail: { code: string | null; status: number | null; message: string },
    options?: { cause?: unknown },
  ) {
    super(
      `sendo s3 storage: ${operation} failed: ${detail.code ?? "error"}: ${detail.message}`,
      options,
    );
    this.operation = operation;
    this.code = detail.code;
    this.status = detail.status;
  }
}

interface S3ErrorShape {
  name?: unknown;
  Code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
}

function describe(error: unknown): { code: string | null; status: number | null; message: string } {
  const shape = (typeof error === "object" && error !== null ? error : {}) as S3ErrorShape;
  const code =
    typeof shape.Code === "string"
      ? shape.Code
      : typeof shape.name === "string"
        ? shape.name
        : null;
  const status =
    typeof shape.$metadata?.httpStatusCode === "number" ? shape.$metadata.httpStatusCode : null;
  const message =
    typeof shape.message === "string" && shape.message !== "" ? shape.message : String(error);
  return { code, status, message };
}

function failure(operation: string, error: unknown): S3StorageError {
  return new S3StorageError(operation, describe(error), { cause: error });
}

function isNotFound(error: unknown, codes: readonly string[]): boolean {
  const { code, status } = describe(error);
  return status === 404 || (code !== null && codes.includes(code));
}

/**
 * `MediaStore` on an S3 bucket (AWS S3, Cloudflare R2, MinIO and other S3-compatible stores).
 * Needs the optional peers `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Signed
 * URLs are SigV4 presigned `GetObject` URLs (at most 7 days). Errors are `S3StorageError`s.
 */
export function s3Storage(options: S3StorageOptions): MediaStore {
  const { client, bucket } = options;
  const defaultTtl = options.signedUrlTtlSec ?? DEFAULT_SIGNED_URL_TTL_SEC;

  return {
    async put(path, bytes, mimeType) {
      try {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: path, Body: bytes, ContentType: mimeType }),
        );
      } catch (error) {
        throw failure("storage.put", error);
      }
    },
    async get(path) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: path }));
        if (response.Body === undefined) return new Uint8Array();
        return await response.Body.transformToByteArray();
      } catch (error) {
        if (isNotFound(error, ["NoSuchKey", "NotFound"])) return null;
        throw failure("storage.get", error);
      }
    },
    async signedUrl(path, ttlSeconds) {
      const ttl = Math.min(
        ttlSeconds > 0 ? Math.ceil(ttlSeconds) : defaultTtl,
        S3_MAX_SIGNED_URL_TTL_SEC,
      );
      try {
        return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: path }), {
          expiresIn: ttl,
        });
      } catch (error) {
        throw failure("storage.signedUrl", error);
      }
    },
    async delete(paths) {
      const keys = [...new Set(paths)];
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        let errors: { Key?: string; Code?: string; Message?: string }[];
        try {
          const response = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                Objects: keys.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })),
                Quiet: true,
              },
            }),
          );
          errors = response.Errors ?? [];
        } catch (error) {
          throw failure("storage.delete", error);
        }
        const first = errors.find((e) => e.Code !== "NoSuchKey");
        if (first !== undefined) {
          throw new S3StorageError("storage.delete", {
            code: first.Code ?? null,
            status: null,
            message: `${String(errors.length)} object(s) not deleted, first ${first.Key ?? "?"}: ${first.Message ?? ""}`,
          });
        }
      }
    },
    async exists() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return true;
      } catch (error) {
        if (isNotFound(error, ["NotFound", "NoSuchBucket"])) return false;
        throw failure("storage.exists", error);
      }
    },
  };
}
