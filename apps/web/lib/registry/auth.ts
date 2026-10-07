import { createHash, timingSafeEqual } from "node:crypto";

export type RegistryAuthEnv = {
  QUAMI_REGISTRY_TOKENS?: string | undefined;
  QUAMI_REGISTRY_ALLOW_ANONYMOUS?: string | undefined;
};

const BEARER = /^Bearer\s+(.+)$/i;

export function parseAllowedTokens(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isTokenAllowed(candidate: string, allowed: readonly string[]): boolean {
  const candidateDigest = digest(candidate);
  let matched = false;
  for (const token of allowed) {
    if (timingSafeEqual(candidateDigest, digest(token))) matched = true;
  }
  return matched;
}

export function isRegistryRequestAuthorized(
  authorizationHeader: string | null,
  env: RegistryAuthEnv,
): boolean {
  if (env.QUAMI_REGISTRY_ALLOW_ANONYMOUS === "1") return true;
  const allowed = parseAllowedTokens(env.QUAMI_REGISTRY_TOKENS);
  if (allowed.length === 0) return false;
  const token = extractBearerToken(authorizationHeader);
  if (!token) return false;
  return isTokenAllowed(token, allowed);
}
