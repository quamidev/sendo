import type { Metadata } from "next";
import { LANGS, isLang, type Lang } from "./langs";

/** `/pricing` + `es` → `/es/pricing`; `""` or `/` → `/es`. */
export function localizedPath(lang: Lang, pathWithoutLang: string): string {
  const path = pathWithoutLang === "" || pathWithoutLang === "/" ? "" : pathWithoutLang;
  return `/${lang}${path.startsWith("/") || path === "" ? path : `/${path}`}`;
}

/** `/es/pricing` → `en` → `/en/pricing`. A path without a language prefix goes to that language's home. */
export function swapLangPrefix(pathname: string, lang: Lang): string {
  const [, first, ...rest] = pathname.split("/");
  if (!isLang(first)) return localizedPath(lang, "/");
  return localizedPath(lang, rest.length > 0 ? `/${rest.join("/")}` : "/");
}

/** AC-ST-2: canonical plus `hreflang` alternates (`es`, `en`, `x-default` → English). */
export function alternatesFor(pathWithoutLang: string, lang: Lang): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const each of LANGS) languages[each] = localizedPath(each, pathWithoutLang);
  languages["x-default"] = localizedPath("en", pathWithoutLang);
  return { canonical: localizedPath(lang, pathWithoutLang), languages };
}
