import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SendoAdapter } from "../adapters/types";
import { assertMediaStore } from "../media";
import type { MediaStore } from "../media/types";

/**
 * `--config <path>`: loads the app's JS or TS module through `jiti` (CLI only; the library
 * entry never imports this file). Point it at a standalone module such as `lib/sendo-rules.ts`
 * that `lib/sendo.ts` also imports, so the CLI never loads Next.js-only code.
 */

export class ConfigLoadError extends Error {
  override readonly name = "ConfigLoadError";
}

/** The module's exports (`default` interop applied). */
export async function loadConfigModule(
  path: string,
  cwd: string,
): Promise<Record<string, unknown>> {
  const file = isAbsolute(path) ? path : resolve(cwd, path);
  if (!existsSync(file))
    throw new ConfigLoadError(
      `Config file ${file} does not exist. Check the --config path (relative to the current directory).`,
    );
  if (!statSync(file).isFile()) {
    throw new ConfigLoadError(
      `${file} is a folder. Pass the module file to --config, e.g. lib/sendo-rules.ts.`,
    );
  }
  const { createJiti } = await import("jiti");
  const jiti = createJiti(pathToFileURL(`${cwd}/`).href, {
    fsCache: false,
    moduleCache: false,
    interopDefault: true,
  });
  let mod: unknown;
  try {
    mod = await jiti.import(file);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(
      /\s*Require stack:[\s\S]*$/,
      "",
    );
    throw new ConfigLoadError(
      `Could not load ${file}: ${reason}. Fix the error in that module (it must load without Next.js).`,
      { cause: error },
    );
  }
  if (typeof mod !== "object" || mod === null) {
    throw new ConfigLoadError(`${file} does not export a module. Add named exports to it.`);
  }
  return mod as Record<string, unknown>;
}

/**
 * The `rules` export of the config module: `export const rules = [...]`, or a default export
 * that is the array or an object with `rules`.
 */
export async function loadRulesFromConfig(path: string, cwd: string): Promise<unknown> {
  const mod = await loadConfigModule(path, cwd);
  if ("rules" in mod) return mod.rules;
  const fallback = mod.default;
  if (Array.isArray(fallback)) return fallback;
  if (typeof fallback === "object" && fallback !== null && "rules" in fallback) {
    return fallback.rules;
  }
  throw new ConfigLoadError(
    `${path} does not export \`rules\`. Add \`export const rules: RuleDefinition[] = [...]\` (for example in lib/sendo-rules.ts).`,
  );
}

/** What `doctor` and `mcp` read from the `--config` module. */
export interface ConfigStorage {
  adapter: SendoAdapter;
  /** The module's `media` export (the `MediaStore` passed to `createSendo`), if any. */
  media: MediaStore | undefined;
}

function exported(mod: Record<string, unknown>, name: string): unknown {
  if (name in mod) return mod[name];
  const fallback: unknown = mod.default;
  return typeof fallback === "object" && fallback !== null && name in fallback
    ? (fallback as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The storage `doctor` and `mcp` use with `--config`: `export const adapter = …` plus an optional
 * `export const media = s3Storage(…)` (or a default export with them). For apps whose adapter
 * isn't the Supabase one built from env (Drizzle, Prisma, a custom one) or whose media lives
 * elsewhere.
 */
export async function loadStorageFromConfig(path: string, cwd: string): Promise<ConfigStorage> {
  const mod = await loadConfigModule(path, cwd);
  const candidate = exported(mod, "adapter");
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("accounts" in candidate) ||
    !("healthCheck" in candidate) ||
    typeof candidate.healthCheck !== "function"
  ) {
    throw new ConfigLoadError(
      `${path} does not export an adapter. Add \`export const adapter = supabaseAdapter(...)\` (or your Drizzle or Prisma adapter) to a module without Next.js dependencies, for example lib/sendo-adapter.ts.`,
    );
  }
  const media = exported(mod, "media");
  if (media !== undefined) {
    try {
      assertMediaStore(media, `${path}: \`media\``);
    } catch (error) {
      throw new ConfigLoadError(error instanceof Error ? error.message : String(error));
    }
  }
  return { adapter: candidate as SendoAdapter, media };
}
