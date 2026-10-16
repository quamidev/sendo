"use client";

import { CheckIcon, ChevronDownIcon, GlobeIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LANGS, LANG_COOKIE, LANG_COOKIE_MAX_AGE, type Lang } from "@/lib/i18n/langs";
import { swapLangPrefix } from "@/lib/i18n/paths";
import { cn } from "@/lib/utils";

interface SelectorProps {
  lang: Lang;
  label: string;
  names: Record<Lang, string>;
}

function rememberLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; Max-Age=${String(LANG_COOKIE_MAX_AGE)}; Path=/; SameSite=Lax`;
}

/**
 * The selector behaviour both presentations share (AC-ST-3): one plain link per language to the
 * same page under the other prefix, so it navigates without cookies; the click also remembers the
 * choice in `sendo-lang` for `/`. A full page load, so `<html lang>` follows.
 */
function useLanguageLinks(lang: Lang) {
  const pathname = usePathname() || "/";
  return LANGS.map((each) => ({
    lang: each,
    current: each === lang,
    href: swapLangPrefix(pathname, each),
    onClick: () => rememberLang(each),
  }));
}

/** Desktop: globe button with a menu of language names, the current one checked. */
export function LanguageDropdown({ lang, label, names }: SelectorProps) {
  const links = useLanguageLinks(lang);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="group inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13px] outline-none hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent data-[state=open]:border-ring">
        <GlobeIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="sr-only">{label}: </span>
        <span className="sr-only lg:not-sr-only" lang={lang}>
          {names[lang]}
        </span>
        <span aria-hidden className="font-mono text-xs lg:hidden">
          {lang.toUpperCase()}
        </span>
        <ChevronDownIcon
          aria-hidden
          className="size-3 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-36">
        {links.map((link) => (
          <DropdownMenuItem key={link.lang} asChild className="justify-between py-2 text-[13px]">
            <a
              href={link.href}
              hrefLang={link.lang}
              lang={link.lang}
              aria-current={link.current ? "true" : undefined}
              onClick={link.onClick}
            >
              {names[link.lang]}
              {link.current ? <CheckIcon aria-hidden className="text-foreground" /> : null}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobile: ES / EN segmented toggle. Each segment is a 40 px tap target. */
export function LanguageToggle({ lang, label, names }: SelectorProps) {
  const links = useLanguageLinks(lang);
  return (
    <nav aria-label={label} className="flex items-center rounded-lg border p-0.5">
      {links.map((link) => (
        <a
          key={link.lang}
          href={link.href}
          hrefLang={link.lang}
          lang={link.lang}
          aria-label={names[link.lang]}
          aria-current={link.current ? "true" : undefined}
          onClick={link.onClick}
          className={cn(
            "relative inline-flex h-7 min-w-10 items-center justify-center rounded-md px-2 font-mono text-xs font-medium outline-none after:absolute after:inset-x-0 after:-inset-y-1.5 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            link.current
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground active:bg-accent",
          )}
        >
          {link.lang.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
