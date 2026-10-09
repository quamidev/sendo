import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isRegistryRequestAuthorized, type RegistryAuthEnv } from "./auth";

export const REGISTRY_ITEM_NAME = /^[a-z0-9-]+$/;
const JSON_SUFFIX = ".json";

export type RegistryHandlerOptions = {
  distDir: string;
  env: RegistryAuthEnv;
};

export function defaultRegistryDistDir(env: {
  QUAMI_REGISTRY_DIST_DIR?: string | undefined;
}): string {
  return env.QUAMI_REGISTRY_DIST_DIR
    ? path.resolve(env.QUAMI_REGISTRY_DIST_DIR)
    : path.join(process.cwd(), "registry-dist");
}

export function parseRegistryItemName(segment: string): string | null {
  if (!segment.endsWith(JSON_SUFFIX)) return null;
  const name = segment.slice(0, -JSON_SUFFIX.length);
  return REGISTRY_ITEM_NAME.test(name) ? name : null;
}

function errorResponse(status: 400 | 401 | 404 | 500, error: string): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 401) headers["WWW-Authenticate"] = 'Bearer realm="quami-registry"';
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

export async function handleRegistryRequest(
  request: Request,
  segment: string,
  options: RegistryHandlerOptions,
): Promise<Response> {
  if (!isRegistryRequestAuthorized(request.headers.get("authorization"), options.env)) {
    return errorResponse(401, "unauthorized");
  }

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
  try {
    JSON.parse(body);
  } catch {
    return errorResponse(500, "invalid registry item");
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
