import Link from "next/link";
import { LinkHint } from "@/components/site/header/link-hint";
import type { HeaderLink } from "@/components/site/header/links";
import { MobileMenu } from "@/components/site/header/mobile-menu";
import { VersionBadge } from "@/components/site/header/version-badge";
import { LanguageDropdown, LanguageToggle } from "@/components/site/language-selector";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { DEMO_CODE_URL } from "@/lib/demo/protocol";
import { getDictionary, localizedPath, type Lang } from "@/lib/i18n";

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The site header (`home-option-b.html` from `md`, `home-mobile-option-a.html` below). On marketing
 * pages `lang` is the URL prefix: links keep it and the language selector shows. Docs (English only)
 * pass no `lang`: labels are English, marketing links are unprefixed (so `proxy.ts` sends the
 * visitor to their remembered or detected language) and there is no selector.
 */
export function SiteHeader({ lang }: { lang?: Lang }) {
  const t = getDictionary(lang ?? "en").header;
  const page = (path: string) => (lang ? localizedPath(lang, path) : path);
  const docs: HeaderLink = {
    href: "/docs",
    label: t.nav.docs,
    hint: lang === "es" ? { text: t.docsHint, label: t.docsHintLabel } : undefined,
  };
  const github: HeaderLink = { href: DEMO_CODE_URL, label: t.github, external: true };
  const rest = (demoLabel: string): HeaderLink[] => [
    { href: page("/demo"), label: demoLabel },
    { href: page("/compare"), label: t.nav.compare },
    { href: page("/changelog"), label: t.nav.changelog },
    { href: page("/pricing"), label: t.nav.pricing },
  ];
  const selector = lang ? { lang, label: t.language.label, names: t.language.names } : null;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3.5 md:grid md:grid-cols-[auto_1fr_auto] md:gap-4 md:px-6 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={page("/")}
            aria-label={t.homeLabel}
            className={`inline-flex h-10 items-center rounded-sm font-mono text-sm font-semibold tracking-tight hover:text-muted-foreground active:opacity-70 ${focusRing}`}
          >
            Sendo
          </Link>
          <VersionBadge label={t.version.label} />
        </div>

        <nav
          aria-label={t.navLabel}
          className="hidden items-center gap-1 justify-self-center rounded-full bg-muted p-[3px] md:flex"
        >
          {[docs, ...rest(t.nav.demo)].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full px-2.5 py-1.5 text-[13px] leading-none whitespace-nowrap text-muted-foreground hover:bg-background hover:text-foreground active:bg-background/60 lg:px-3 ${focusRing}`}
            >
              {link.label}
              {link.hint ? <LinkHint hint={link.hint} /> : null}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:ml-0 md:justify-self-end">
          {selector ? (
            <div className="md:hidden">
              <LanguageToggle {...selector} />
            </div>
          ) : null}
          <div className="md:hidden">
            <MobileMenu
              links={[docs, ...rest(t.fullDemo), github]}
              navLabel={t.navLabel}
              labels={t.menu}
              themeLabel={t.themeToggle}
            />
          </div>
          <div className="hidden items-center gap-2.5 md:flex">
            {selector ? <LanguageDropdown {...selector} /> : null}
            <a
              href={github.href}
              target="_blank"
              rel="noreferrer"
              className={`rounded-sm text-[13px] text-muted-foreground hover:text-foreground active:opacity-70 ${focusRing}`}
            >
              {github.label}
            </a>
            <ThemeToggle label={t.themeToggle} />
          </div>
        </div>
      </div>
    </header>
  );
}
