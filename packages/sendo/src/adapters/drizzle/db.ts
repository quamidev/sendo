import { SQL, is, sql } from "drizzle-orm";
import { ConstraintViolationError, SendoError } from "../../errors";
import { UUID_RE } from "../supabase/query";

/**
 * The part of a Drizzle Postgres database the adapter uses. `drizzle-orm/node-postgres` and
 * `drizzle-orm/postgres-js` databases (and their transactions) satisfy it.
 */
export interface DrizzleDatabase {
  execute(query: SQL): PromiseLike<unknown>;
  transaction<T>(fn: (tx: DrizzleDatabase) => Promise<T>): Promise<T>;
}

/** A Postgres error as `pg` (`constraint`) or `postgres` (`constraint_name`) reports it. */
export interface PgErrorInfo {
  code: string;
  message: string;
  constraint: string | null;
  detail: string | null;
}

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_CHECK_VIOLATION = "23514";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_UNDEFINED_TABLE = "42P01";

/**
 * A database call failed for a reason the adapter does not map to a library error (connection
 * refused, permission denied, a missing migration, constraints other than the documented ones).
 */
export class DrizzleAdapterError extends Error {
  /** Postgres SQLSTATE (e.g. `23503`), or `null` when the failure was not a Postgres error. */
  readonly code: string | null;
  /** The adapter operation, e.g. `messages.insertOutbound`. */
  readonly operation: string;
  readonly constraint: string | null;
  readonly detail: string | null;

  constructor(operation: string, cause: unknown, message?: string) {
    const pg = pgErrorOf(cause);
    const reason =
      message ?? pg?.message ?? (cause instanceof Error ? cause.message : String(cause));
    super(`sendo drizzle adapter: ${operation} failed: ${reason}`, { cause });
    this.name = "DrizzleAdapterError";
    this.operation = operation;
    this.code = pg?.code ?? null;
    this.constraint = pg?.constraint ?? null;
    this.detail = pg?.detail ?? null;
  }
}

const SQLSTATE_RE = /^[0-9A-Z]{5}$/;

/** The Postgres error behind `error` (Drizzle wraps driver errors in `DrizzleQueryError.cause`). */
export function pgErrorOf(error: unknown): PgErrorInfo | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const e = current as {
      code?: unknown;
      message?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      detail?: unknown;
      cause?: unknown;
    };
    if (typeof e.code === "string" && SQLSTATE_RE.test(e.code)) {
      const constraint = e.constraint ?? e.constraint_name;
      return {
        code: e.code,
        message: typeof e.message === "string" ? e.message : e.code,
        constraint: typeof constraint === "string" ? constraint : null,
        detail: typeof e.detail === "string" ? e.detail : null,
      };
    }
    current = e.cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = pgErrorOf(error);
  return pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === constraint;
}

/** The id in a foreign-key violation on `column` (`Key (column)=(id) is not present ...`). */
export function missingForeignKey(error: unknown, column: string): string | null {
  const pg = pgErrorOf(error);
  if (pg?.code !== PG_FOREIGN_KEY_VIOLATION) return null;
  const match = new RegExp(`Key \\(${column}\\)=\\(([^)]+)\\)`).exec(
    `${pg.detail ?? ""} ${pg.message}`,
  );
  return match?.[1] ?? null;
}

/**
 * Library errors pass through; a unique/check violation of one of `constraints` becomes a
 * `ConstraintViolationError`; anything else a `DrizzleAdapterError`.
 */
export function writeFailure(
  operation: string,
  error: unknown,
  constraints: readonly string[] = [],
): Error {
  if (error instanceof SendoError || error instanceof DrizzleAdapterError) return error;
  const pg = pgErrorOf(error);
  if (
    pg &&
    (pg.code === PG_UNIQUE_VIOLATION || pg.code === PG_CHECK_VIOLATION) &&
    pg.constraint !== null &&
    constraints.includes(pg.constraint)
  ) {
    return new ConstraintViolationError({ constraint: pg.constraint }, { cause: error });
  }
  return new DrizzleAdapterError(operation, error);
}

export type Row = Record<string, unknown>;

/** Rows of a `db.execute` result (`pg` returns `{ rows }`, `postgres` an array). */
function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result !== null && typeof result === "object") {
    const { rows } = result as { rows?: unknown };
    if (Array.isArray(rows)) return rows as Row[];
  }
  return [];
}

/** Runs `query`; failures become `writeFailure(operation, error, constraints)`. */
export async function execute(
  db: DrizzleDatabase,
  operation: string,
  query: SQL,
  constraints: readonly string[] = [],
): Promise<Row[]> {
  try {
    return rowsOf(await db.execute(query));
  } catch (error) {
    throw writeFailure(operation, error, constraints);
  }
}

/**
 * Runs a query whose rows have one `r` column (`to_jsonb(...) as r`). Rows come back as JSON,
 * shaped like PostgREST's (ISO timestamps, numbers for numeric), whatever the driver.
 */
export async function jsonRows<T>(
  db: DrizzleDatabase,
  operation: string,
  query: SQL,
  constraints: readonly string[] = [],
): Promise<T[]> {
  const rows = await execute(db, operation, query, constraints);
  return rows.map((row) => row.r as T);
}

export async function jsonRow<T>(
  db: DrizzleDatabase,
  operation: string,
  query: SQL,
  constraints: readonly string[] = [],
): Promise<T | null> {
  const [row] = await jsonRows<T>(db, operation, query, constraints);
  return row ?? null;
}

/** First column of the first row as a number (`count(*)`), `0` when there is none. */
export async function scalar(db: DrizzleDatabase, operation: string, query: SQL): Promise<number> {
  const [row] = await execute(db, operation, query);
  const value = row ? Object.values(row)[0] : 0;
  return Number(value ?? 0);
}

/** Runs `fn` in a transaction; errors are mapped like `execute`. */
export async function transaction<T>(
  db: DrizzleDatabase,
  operation: string,
  fn: (tx: DrizzleDatabase) => Promise<T>,
  constraints: readonly string[] = [],
): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (error) {
    throw writeFailure(operation, error, constraints);
  }
}

// ---------- SQL building ----------

export const isUuid = (value: string): boolean => UUID_RE.test(value);

/** A `jsonb` value (any JSON, strings included); `null` stays SQL `null`. */
export function jsonb(value: unknown): SQL {
  return value === null || value === undefined
    ? sql`null::jsonb`
    : sql`${JSON.stringify(value)}::jsonb`;
}

/** A bind parameter: SQL passes through, dates as ISO text, objects and arrays as `jsonb`. */
export function param(value: unknown): SQL {
  if (is(value, SQL)) return value;
  if (value instanceof Date) return sql`${value.toISOString()}`;
  if (value !== null && typeof value === "object") return jsonb(value);
  return sql`${value}`;
}

export const ident = (name: string): SQL => sql`${sql.identifier(name)}`;

/** `column = value::uuid`, or `false` when `value` is not a uuid (it can never match). */
export function uuidEq(column: SQL, value: string): SQL {
  return isUuid(value) ? sql`${column} = ${value}::uuid` : sql`false`;
}

/** `column is not distinct from tenant` (`null` matches rows without a tenant). */
export function tenantEq(column: SQL, tenantId: string | null): SQL {
  if (tenantId !== null && !isUuid(tenantId)) return sql`false`;
  return sql`${column} is not distinct from ${tenantId}::uuid`;
}

/** A `text[]` built from one JSON parameter (drivers disagree on array parameters). */
export function textArray(values: readonly string[]): SQL {
  return sql`array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
}

/** A `uuid[]` of the valid uuids among `values`. */
export function uuidArray(values: readonly string[]): SQL {
  const ids = [...new Set(values)].filter(isUuid);
  return sql`array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) x)`;
}

/** `insert into table as t (cols) values (...) returning to_jsonb(t) as r` (undefined skipped). */
export function insertReturning(table: string, values: Record<string, unknown>): SQL {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  return sql`insert into ${ident(table)} as t (${sql.join(
    entries.map(([k]) => ident(k)),
    sql`, `,
  )}) values (${sql.join(
    entries.map(([, v]) => param(v)),
    sql`, `,
  )}) returning to_jsonb(t) as r`;
}

/** `col = value, ...` for the defined entries of `values`. */
export function assignments(values: Record<string, unknown>): SQL {
  return sql.join(
    Object.entries(values)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => sql`${ident(k)} = ${param(v)}`),
    sql`, `,
  );
}

/** `%needle%` for `ilike`, with `\`, `%` and `_` matched literally. */
export function likePattern(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
