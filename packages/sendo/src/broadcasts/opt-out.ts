import { BUILT_IN_MESSAGES, type SendoLocale } from "../core/messages";
import { ConfigError } from "../errors/errors";

/** Opt-out keywords (product spec AC-BC-5). Default keywords `["BAJA","STOP","ALTO","CANCELAR"]`. */
export interface OptOutConfig {
  /** Matched exactly after trim and case/accent folding. `[]` turns keyword opt-out off. */
  keywords?: string[];
  /**
   * Sent inside the window after an opt-out. `null` sends nothing.
   * Default `BUILT_IN_MESSAGES[locale].optOutConfirmation`.
   */
  confirmation?: string | null;
}

export interface ResolvedOptOutConfig {
  /** Folded keywords (`foldOptOutText`). */
  keywords: ReadonlySet<string>;
  confirmation: string | null;
}

export const DEFAULT_OPT_OUT_KEYWORDS: readonly string[] = ["BAJA", "STOP", "ALTO", "CANCELAR"];

/** The English built-in opt-out confirmation (`BUILT_IN_MESSAGES.en.optOutConfirmation`). */
export const DEFAULT_OPT_OUT_CONFIRMATION = BUILT_IN_MESSAGES.en.optOutConfirmation;

/** Trim, collapse inner whitespace, drop accents and lowercase: `"  Cancelár "` → `"cancelar"`. */
export function foldOptOutText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Throws `ConfigError` on an invalid `optOut`. */
export function resolveOptOutConfig(
  config: OptOutConfig | undefined,
  locale: SendoLocale = "en",
): ResolvedOptOutConfig {
  const raw: unknown = config;
  if (raw !== undefined && (typeof raw !== "object" || raw === null)) {
    throw new ConfigError("createSendo: `optOut` must be an object.");
  }
  const keywords = config?.keywords ?? DEFAULT_OPT_OUT_KEYWORDS;
  if (
    !Array.isArray(keywords) ||
    keywords.some((k) => typeof k !== "string" || foldOptOutText(k) === "")
  ) {
    throw new ConfigError("createSendo: `optOut.keywords` must be an array of non-empty strings.");
  }
  const confirmation =
    config?.confirmation === undefined
      ? BUILT_IN_MESSAGES[locale].optOutConfirmation
      : config.confirmation;
  if (confirmation !== null && (typeof confirmation !== "string" || confirmation.trim() === "")) {
    throw new ConfigError("createSendo: `optOut.confirmation` must be a non-empty string or null.");
  }
  return { keywords: new Set(keywords.map(foldOptOutText)), confirmation };
}

/** The matched keyword (folded) when `text` is exactly an opt-out keyword, else null. */
export function matchOptOutKeyword(
  config: ResolvedOptOutConfig,
  text: string | null,
): string | null {
  if (text === null) return null;
  const folded = foldOptOutText(text);
  return config.keywords.has(folded) ? folded : null;
}
