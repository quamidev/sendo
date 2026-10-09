import { REDACTED, redactText } from "./redact";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFn = (...args: unknown[]) => void;

/** Any console-like object. Missing levels are skipped (`console` fits). */
export type Logger = Partial<Record<LogLevel, LogFn>>;

/** A logger with every level present that redacts all output. */
export type RedactingLogger = Record<LogLevel, LogFn>;

const SENSITIVE_KEYS = new Set([
  "authorization",
  "access_token",
  "accesstoken",
  "token",
  "apikey",
  "api_key",
  "appsecret",
  "app_secret",
  "verifytoken",
  "verify_token",
]);

const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/-/g, "_"));
}

function errorToPlain(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const plain: Record<string, unknown> = { name: error.name, message: error.message };
  if (error.stack !== undefined) plain.stack = error.stack;
  for (const [key, value] of Object.entries(error)) {
    plain[key] = isSensitiveKey(key) ? REDACTED : toPlain(value, depth + 1, seen);
  }
  if (error.cause !== undefined) plain.cause = toPlain(error.cause, depth + 1, seen);
  return plain;
}

/** Converts a value into JSON-safe data, masking sensitive keys and breaking cycles. */
function toPlain(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth > MAX_DEPTH) return "[Object]";
  seen.add(value);
  if (value instanceof Error) return errorToPlain(value, depth, seen);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return value.toString();
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return Object.fromEntries(
      [...value.entries()].map(([k, v]) => [k, isSensitiveKey(k) ? REDACTED : v]),
    );
  }
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength} bytes]`;
  if (value instanceof Map) return toPlain(Object.fromEntries(value), depth + 1, seen);
  if (value instanceof Set) return toPlain([...value], depth + 1, seen);
  if (Array.isArray(value)) return value.map((item) => toPlain(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : toPlain(item, depth + 1, seen);
  }
  return out;
}

/**
 * Returns a redacted, log-safe copy of a value. Strings are redacted in place;
 * objects and errors are serialized to a redacted JSON string so nothing
 * (nested fields, `cause`, headers) can carry a secret through.
 */
export function redactLogValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  const plain = toPlain(value, 0, new WeakSet());
  if (typeof plain === "string") return redactText(plain, secrets);
  return redactText(JSON.stringify(plain), secrets);
}

/**
 * Wraps a console-like logger so every message and argument has secrets removed:
 * each value returned by `secrets()`, `Authorization`/`Bearer` credentials and
 * `access_token` params. A missing `base` (or level) is a no-op.
 */
export function createRedactingLogger(
  base: Logger | undefined,
  secrets: () => readonly string[] = () => [],
): RedactingLogger {
  const make =
    (level: LogLevel): LogFn =>
    (...args) => {
      const fn = base?.[level];
      if (fn === undefined) return;
      const current = secrets();
      fn.apply(
        base,
        args.map((arg) => redactLogValue(arg, current)),
      );
    };
  return { debug: make("debug"), info: make("info"), warn: make("warn"), error: make("error") };
}

/** A logger that discards everything. */
export const noopLogger: RedactingLogger = createRedactingLogger(undefined);
