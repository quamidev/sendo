import Link from "next/link";
import { LanguageSelector } from "@/components/site/language-selector";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { DEMO_CODE_URL } from "@/lib/demo/protocol";
import { getDictionary, localizedPath, type Lang } from "@/lib/i18n";

const linkClass =
  "rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70";

/**
 * The site header. On marketing pages `lang` is the URL prefix: links keep it and the language
 * selector shows. Docs (English only) pass no `lang`: labels are English and marketing links are
 * unprefixed, so `proxy.ts` sends the visitor back to their remembered or detected language.
 */
export function SiteHeader({ lang }: { lang?: Lang }) {
  const t = getDictionary(lang ?? "en").header;
  const page = (path: string) => (lang ? localizedPath(lang, path) : path);
  const links: { href: string; label: string; hint?: string; wide?: true }[] = [
    { href: "/docs", label: t.nav.docs, hint: lang === "es" ? t.docsHint : undefined },
    { href: page("/demo"), label: t.nav.demo },
    // Hidden below `sm` so the header (with the language selector) fits a 320 px screen until
    // SNL-4.2's mobile sheet.
    { href: page("/changelog"), label: t.nav.changelog, wide: true },
    { href: page("/pricing"), label: t.nav.pricing, wide: true },
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 md:gap-6 md:px-6">
        <Link
          href={page("/")}
          aria-label={t.homeLabel}
          className="rounded-sm font-mono text-sm font-semibold tracking-tight outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70"
        >
          Sendo
        </Link>
        <nav aria-label={t.navLabel} className="flex items-center gap-4 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={link.wide ? `hidden sm:inline ${linkClass}` : linkClass}
            >
              {link.label}
              {link.hint ? (
                <span lang="en" className="ml-1 align-super font-mono text-[10px]">
                  {link.hint}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {lang ? (
            <LanguageSelector lang={lang} label={t.language.label} names={t.language.names} />
          ) : null}
          <a
            href={DEMO_CODE_URL}
            className={`hidden text-sm sm:inline ${linkClass}`}
            target="_blank"
            rel="noreferrer"
          >
            {t.github}
          </a>
          <ThemeToggle label={t.themeToggle} />
        </div>
      </div>
    </header>
  );
}
