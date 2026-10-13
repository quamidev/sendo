import { defaultRegistryDistDir } from "@/lib/registry/handler";
import { handleRegistryIndexRequest } from "@/lib/registry/catalog-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The registry host's `/` (see `proxy.ts`): item names and their JSON URLs. */
export async function GET(request: Request) {
  const env = process.env;
  return handleRegistryIndexRequest(request, {
    distDir: defaultRegistryDistDir({ SENDO_REGISTRY_DIST_DIR: env.SENDO_REGISTRY_DIST_DIR }),
    env: { SENDO_REGISTRY_TOKENS: env.SENDO_REGISTRY_TOKENS },
  });
}
