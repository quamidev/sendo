/** Marketing site languages (C9). Docs stay English at `/docs` with no prefix. */
export const LANGS = ["es", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** The remembered choice, set only by the header's language selector (AC-ST-3, AC-ST-15). */
export const LANG_COOKIE = "sendo-lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Used when neither the cookie nor `Accept-Language` names a supported language. */
export const DEFAULT_LANG: Lang = "en";

export function isLang(value: string | null | undefined): value is Lang {
  return value === "es" || value === "en";
}
