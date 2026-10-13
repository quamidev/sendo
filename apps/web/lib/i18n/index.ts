/** Site i18n (contract C9). Docs are English only and live outside `[lang]`. */
export { DEFAULT_LANG, LANGS, LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLang, type Lang } from "./langs";
export { negotiateLang } from "./negotiate";
export { alternatesFor, localizedPath, swapLangPrefix } from "./paths";
export { DICTIONARY_SECTIONS, getDictionary, type SiteDictionary } from "./dictionary";
