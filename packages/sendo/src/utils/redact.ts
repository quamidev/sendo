export const REDACTED = "[REDACTED]";

const MIN_SECRET_LENGTH = 4;

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

const TOKEN_PATTERNS: readonly [RegExp, string][] = [
  [/(access_token=)[^&\s"']+/gi, `$1${REDACTED}`],
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`],
];

/**
 * Removes secrets from a string: every given secret value, `access_token=` query
 * values and `Bearer` credentials.
 */
export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    out = out.replace(new RegExp(secret.replace(ESCAPE_RE, "\\$&"), "g"), REDACTED);
  }
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
