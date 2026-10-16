import { handleRegistryRequest, type RegistryHandlerOptions } from "./handler";

export interface RegistryIndex {
  name: string;
  homepage: string;
  items: { name: string; url: string }[];
}

/**
 * `registry.sendo.quami.dev/` (rewritten to `/r` by `proxy.ts`): the public items of the catalog
 * (`registry.json`) with their install URLs. Built from the anonymous view of the catalog, so
 * private items never show.
 */
export async function handleRegistryIndexRequest(
  request: Request,
  options: RegistryHandlerOptions,
): Promise<Response> {
  const catalog = await handleRegistryRequest(new Request(request.url), "registry.json", options);
  if (!catalog.ok) return catalog;
  const parsed = (await catalog.json()) as {
    name?: string;
    homepage?: string;
    items?: { name?: unknown }[];
  };
  const homepage = (parsed.homepage ?? new URL(request.url).origin).replace(/\/$/, "");
  const index: RegistryIndex = {
    name: parsed.name ?? "@sendo",
    homepage,
    items: (parsed.items ?? [])
      .map((item) => item.name)
      .filter((name): name is string => typeof name === "string")
      .map((name) => ({ name, url: `${homepage}/r/${name}.json` })),
  };
  return Response.json(index, {
    headers: {
      "Cache-Control": catalog.headers.get("Cache-Control") ?? "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
