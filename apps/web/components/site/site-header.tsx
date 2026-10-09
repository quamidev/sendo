import Link from "next/link";
import { ThemeToggle } from "@/components/site/theme-toggle";

const links = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/quickstart", label: "Quickstart" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 supports-[backdrop-filter]:bg-background/80 supports-[backdrop-filter]:backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 md:px-6">
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
              className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
