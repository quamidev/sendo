"use client";

import { usePathname } from "next/navigation";
import { LANGS, LANG_COOKIE, LANG_COOKIE_MAX_AGE, type Lang } from "@/lib/i18n/langs";
import { swapLangPrefix } from "@/lib/i18n/paths";
import { cn } from "@/lib/utils";

function rememberLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; Max-Age=${String(LANG_COOKIE_MAX_AGE)}; Path=/; SameSite=Lax`;
}

/**
 * ES / EN switch (AC-ST-3). Plain links to the same page under the other prefix, so it navigates
 * without JavaScript or cookies; the click also remembers the choice in `sendo-lang` for `/`.
 * A full page load, so `<html lang>` follows. SNL-4.2 restyles it.
 */
export function LanguageSelector({
  lang,
  label,
  names,
}: {
  lang: Lang;
  label: string;
  names: Record<Lang, string>;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex items-center gap-1 font-mono text-xs">
      {LANGS.map((each) => (
        <a
          key={each}
          href={swapLangPrefix(pathname || "/", each)}
          hrefLang={each}
          lang={each}
          aria-label={names[each]}
          aria-current={each === lang ? "true" : undefined}
          onClick={() => rememberLang(each)}
          className={cn(
            "rounded-sm px-1.5 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70",
            each === lang
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {each.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
