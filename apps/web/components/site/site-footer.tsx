import Link from "next/link";
import { legalLinks } from "@/components/site/legal-page";
import { DEMO_CODE_URL } from "@/lib/demo/protocol";
import { getDictionary, localizedPath, type Lang } from "@/lib/i18n";

const linkClass =
  "inline-flex min-h-8 items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:text-foreground/80 md:min-h-0";

interface FooterLink {
  href: string;
  label: string;
  external?: true;
  hrefLang?: string;
}

function LinkGroup({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <ul className="mt-2 flex flex-col gap-0.5 text-sm md:mt-3 md:gap-2">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a href={link.href} target="_blank" rel="noreferrer" className={linkClass}>
                {link.label}
              </a>
            ) : (
              <Link href={link.href} hrefLang={link.hrefLang} className={linkClass}>
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The footer of the content pages (pricing, compare, changelog, legal): product and legal links. */
export function SiteFooter({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).footer;
  const page = (path: string) => localizedPath(lang, path);
  const product: FooterLink[] = [
    { href: "/docs", label: t.links.docs, hrefLang: lang === "en" ? undefined : "en" },
    { href: page("/pricing"), label: t.links.pricing },
    { href: page("/compare"), label: t.links.compare },
    { href: page("/changelog"), label: t.links.changelog },
    { href: DEMO_CODE_URL, label: t.links.github, external: true },
  ];

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 md:flex-row md:justify-between md:px-6 md:py-10">
        <div className="max-w-xs">
          <p className="font-mono text-sm font-semibold tracking-tight">Sendo</p>
          <p className="mt-2 text-sm text-pretty text-muted-foreground">{t.tagline}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            {t.license} {t.madeBy}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 md:flex md:gap-16">
          <LinkGroup title={t.groups.product} links={product} />
          <LinkGroup title={t.groups.legal} links={legalLinks(lang)} />
        </div>
      </div>
    </footer>
  );
}
