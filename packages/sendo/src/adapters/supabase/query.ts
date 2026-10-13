import { ConstraintViolationError } from "../../errors";
import { type DbError, SupabaseAdapterError, isInvalidId, violatedConstraint } from "./errors";

/** PostgREST helpers shared by the Supabase adapter's namespaces. */

export interface DbResult {
  data: unknown;
  error: DbError | null;
  count?: number | null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Awaits a PostgREST builder as an untyped `{ data, error }` result. */
export async function settle(query: PromiseLike<DbResult>): Promise<DbResult> {
  return query;
}

export async function exec<T>(operation: string, query: PromiseLike<DbResult>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new SupabaseAdapterError(operation, error);
  return data as T;
}

/** Like `exec`, but a malformed id (`22P02`) yields `null` instead of an error. */
export async function execById<T>(
  operation: string,
  query: PromiseLike<DbResult>,
): Promise<T | null> {
  const { data, error } = await query;
  if (error) {
    if (isInvalidId(error)) return null;
    throw new SupabaseAdapterError(operation, error);
  }
  return data as T | null;
}

export async function execCount(operation: string, query: PromiseLike<DbResult>): Promise<number> {
  const { error, count } = await query;
  if (error) throw new SupabaseAdapterError(operation, error);
  return count ?? 0;
}

/**
 * `ConstraintViolationError` when `error` broke one of `constraints` (the schema rules every
 * adapter enforces), else `SupabaseAdapterError`.
 */
export function writeFailure(
  operation: string,
  error: DbError,
  constraints: readonly string[],
): ConstraintViolationError | SupabaseAdapterError {
  const constraint = violatedConstraint(error);
  if (constraint !== null && constraints.includes(constraint)) {
    return new ConstraintViolationError({ constraint }, { cause: error });
  }
  return new SupabaseAdapterError(operation, error);
}

export function encodeCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify({ t, id }), "utf8").toString("base64url");
}

/** Returns `null` for absent or malformed cursors (treated as "first page"). */
export function decodeCursor(cursor: string | null | undefined): { t: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { t, id } = parsed as { t?: unknown; id?: unknown };
    if (typeof t !== "string" || typeof id !== "string") return null;
    if (Number.isNaN(Date.parse(t)) || !UUID_RE.test(id)) return null;
    return { t, id };
  } catch {
    return null;
  }
}

/** PostgREST `or=` filter selecting rows strictly after `cursor` in `(column desc, id desc)` order. */
export function afterCursorFilter(column: string, cursor: { t: string; id: string }): string {
  return `${column}.lt."${cursor.t}",and(${column}.eq."${cursor.t}",id.lt.${cursor.id})`;
}

/** A PostgREST filter value in double quotes (safe with commas, parentheses and dots). */
export function quote(value: string): string {
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}
