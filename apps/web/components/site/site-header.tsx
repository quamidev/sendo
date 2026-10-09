import Link from "next/link";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { DEMO_CODE_URL } from "@/lib/demo/protocol";

const links: { href: string; label: string; wide?: true }[] = [
  { href: "/docs", label: "Docs" },
  { href: "/demo", label: "Demo" },
  // Hidden below `sm` so the header fits a 320 px screen.
  { href: "/changelog", label: "Changelog", wide: true },
  { href: "/pricing", label: "Pricing" },
];

const linkClass =
  "rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-5 px-4 md:gap-6 md:px-6">
        <Link
          href="/"
          className="rounded-sm font-mono text-sm font-semibold tracking-tight outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70"
        >
          Sendo
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={link.wide ? `hidden sm:inline ${linkClass}` : linkClass}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <a
            href={DEMO_CODE_URL}
            className={`hidden text-sm sm:inline ${linkClass}`}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
