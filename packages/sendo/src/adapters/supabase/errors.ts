/** Shape shared by PostgREST errors (`PostgrestError`) and plain `{ code, message }` objects. */
export interface DbError {
  code?: string | null;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** Shape of storage-js errors (`StorageApiError` / `StorageUnknownError`). */
export interface StorageErrorLike {
  message: string;
  status?: number | string;
  statusCode?: string | number;
  name?: string;
}

/**
 * A database or storage call failed for a reason the adapter does not map to a
 * library error (connection refused, permission denied, constraint violations
 * other than the documented ones...).
 */
export class SupabaseAdapterError extends Error {
  /** Postgres / PostgREST error code (e.g. `23503`, `PGRST301`), or `null`. */
  readonly code: string | null;
  /** The adapter operation, e.g. `messages.insertOutbound`. */
  readonly operation: string;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(operation: string, error: DbError | StorageErrorLike, options?: { cause?: unknown }) {
    super(`sendo supabase adapter: ${operation} failed: ${error.message}`, {
      cause: options?.cause ?? error,
    });
    this.name = "SupabaseAdapterError";
    this.operation = operation;
    const code = "code" in error ? error.code : "statusCode" in error ? error.statusCode : null;
    this.code = code == null ? null : String(code);
    this.details = "details" in error ? (error.details ?? null) : null;
    this.hint = "hint" in error ? (error.hint ?? null) : null;
  }
}

/** Postgres `unique_violation`. */
export const PG_UNIQUE_VIOLATION = "23505";
/** Postgres `undefined_table`. */
export const PG_UNDEFINED_TABLE = "42P01";
/** Postgres `invalid_text_representation` (e.g. a malformed uuid). */
export const PG_INVALID_TEXT = "22P02";
/** PostgREST: relation not found in the schema cache. */
export const PGRST_TABLE_NOT_FOUND = "PGRST205";

export function isUniqueViolation(error: DbError, constraint?: string): boolean {
  if (error.code !== PG_UNIQUE_VIOLATION) return false;
  if (constraint === undefined) return true;
  return `${error.message} ${error.details ?? ""}`.includes(constraint);
}

export function isMissingTable(error: DbError): boolean {
  return error.code === PG_UNDEFINED_TABLE || error.code === PGRST_TABLE_NOT_FOUND;
}

/** A malformed id can never match a row: `get` returns null, updates throw not found. */
export function isInvalidId(error: DbError): boolean {
  return error.code === PG_INVALID_TEXT;
}

export function isStorageNotFound(error: StorageErrorLike): boolean {
  const status = error.status === undefined ? NaN : Number(error.status);
  const statusCode = error.statusCode === undefined ? "" : String(error.statusCode);
  return (
    status === 404 ||
    statusCode === "404" ||
    statusCode === "not_found" ||
    statusCode === "NoSuchKey" ||
    statusCode === "NoSuchBucket" ||
    /not.?found/i.test(error.message)
  );
}
