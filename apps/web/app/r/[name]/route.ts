import { defaultRegistryDistDir, handleRegistryRequest } from "@/lib/registry/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/r/[name]">) {
  const { name } = await ctx.params;
  const env = process.env;
  return handleRegistryRequest(request, name, {
    distDir: defaultRegistryDistDir({ SENDO_REGISTRY_DIST_DIR: env.SENDO_REGISTRY_DIST_DIR }),
    env: {
      SENDO_REGISTRY_TOKENS: env.SENDO_REGISTRY_TOKENS,
      SENDO_REGISTRY_ALLOW_ANONYMOUS: env.SENDO_REGISTRY_ALLOW_ANONYMOUS,
    },
  });
}
