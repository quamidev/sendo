import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isRegistryRequestAuthorized, type RegistryAuthEnv } from "./auth";

export const REGISTRY_ITEM_NAME = /^[a-z0-9-]+$/;
const JSON_SUFFIX = ".json";
/** `registry-dist/registry.json`: the catalog shadcn reads; private items are listed only with a token. */
const INDEX_NAME = "registry";

export type RegistryHandlerOptions = {
  distDir: string;
  env: RegistryAuthEnv;
};

export function defaultRegistryDistDir(env: {
  SENDO_REGISTRY_DIST_DIR?: string | undefined;
}): string {
  return env.SENDO_REGISTRY_DIST_DIR
    ? path.resolve(env.SENDO_REGISTRY_DIST_DIR)
    : path.join(process.cwd(), "registry-dist");
}

export function parseRegistryItemName(segment: string): string | null {
  if (!segment.endsWith(JSON_SUFFIX)) return null;
  const name = segment.slice(0, -JSON_SUFFIX.length);
  return REGISTRY_ITEM_NAME.test(name) ? name : null;
}

function errorResponse(status: 400 | 401 | 404 | 500, error: string): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 401) headers["WWW-Authenticate"] = 'Bearer realm="sendo-registry"';
  return Response.json({ error }, { status, headers });
}

async function resolveInside(distDir: string, fileName: string): Promise<string | null> {
  try {
    const root = await realpath(/*turbopackIgnore: true*/ distDir);
    const file = await realpath(/*turbopackIgnore: true*/ path.join(root, fileName));
    const relative = path.relative(root, file);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return file;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `meta.private === true` in `registry.json` (copied into the built item by `shadcn build`). */
export function isPrivateItem(item: unknown): boolean {
  return isObject(item) && isObject(item.meta) && item.meta.private === true;
}

function json(body: string, cacheable: boolean): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Public items may be cached by the CDN; anything behind a token never is.
      "Cache-Control": cacheable
        ? "public, max-age=300, s-maxage=300, stale-while-revalidate=86400"
        : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * `GET /r/<name>.json` (AC-ST-4). Items are public unless their `meta.private` is `true`; a
 * private item needs `Authorization: Bearer <token>` with a token from `SENDO_REGISTRY_TOKENS`
 * (no tokens configured → 401, fail closed). `SENDO_REGISTRY_ALLOW_ANONYMOUS=1` serves private
 * items without a token (local development only). The catalog (`registry.json`) lists private
 * items only to authorized requests.
 */
export async function handleRegistryRequest(
  request: Request,
  segment: string,
  options: RegistryHandlerOptions,
): Promise<Response> {
  const name = parseRegistryItemName(segment);
  if (!name) return errorResponse(400, "invalid registry item name");

  const file = await resolveInside(options.distDir, `${name}${JSON_SUFFIX}`);
  if (!file) return errorResponse(404, "not found");

  let body: string;
  try {
    body = await readFile(/*turbopackIgnore: true*/ file, "utf8");
  } catch {
    return errorResponse(404, "not found");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return errorResponse(500, "invalid registry item");
  }

  const authorized = (): boolean =>
    isRegistryRequestAuthorized(request.headers.get("authorization"), options.env);

  if (name === INDEX_NAME && isObject(parsed) && Array.isArray(parsed.items)) {
    const items: unknown[] = parsed.items;
    if (!items.some(isPrivateItem)) return json(body, true);
    if (authorized()) return json(body, false);
    return json(
      JSON.stringify({ ...parsed, items: items.filter((item) => !isPrivateItem(item)) }),
      false,
    );
  }

  if (!isPrivateItem(parsed)) return json(body, true);
  if (!authorized()) return errorResponse(401, "unauthorized");
  return json(body, false);
}
