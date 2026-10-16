import { DEFAULT_LANG, isLang, type Lang } from "./langs";

/**
 * AC-ST-1: a valid `sendo-lang` cookie wins; else the highest-quality `Accept-Language` entry whose
 * primary subtag is `es` or `en` (`es-GT` → `es`); else `en`.
 */
export function negotiateLang(cookie: string | undefined, acceptLanguage: string | null): Lang {
  if (isLang(cookie)) return cookie;
  if (!acceptLanguage) return DEFAULT_LANG;

  const ranges: { lang: Lang; q: number; index: number }[] = [];
  acceptLanguage.split(",").forEach((part, index) => {
    const [tag = "", ...params] = part.trim().split(";");
    const primary = tag.trim().toLowerCase().split("-")[0];
    if (!isLang(primary)) return;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.trim().split("=");
      if (key?.trim().toLowerCase() !== "q") continue;
      q = Number(value);
    }
    if (!Number.isFinite(q) || q <= 0 || q > 1) return;
    ranges.push({ lang: primary, q, index });
  });

  ranges.sort((a, b) => b.q - a.q || a.index - b.index);
  return ranges[0]?.lang ?? DEFAULT_LANG;
}
