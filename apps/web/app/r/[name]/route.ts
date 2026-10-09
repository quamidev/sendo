import { defaultRegistryDistDir, handleRegistryRequest } from "@/lib/registry/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/r/[name]">) {
  const { name } = await ctx.params;
  const env = process.env;
  return handleRegistryRequest(request, name, {
    distDir: defaultRegistryDistDir({ QUAMI_REGISTRY_DIST_DIR: env.QUAMI_REGISTRY_DIST_DIR }),
    env: {
      QUAMI_REGISTRY_TOKENS: env.QUAMI_REGISTRY_TOKENS,
      QUAMI_REGISTRY_ALLOW_ANONYMOUS: env.QUAMI_REGISTRY_ALLOW_ANONYMOUS,
    },
  });
}
