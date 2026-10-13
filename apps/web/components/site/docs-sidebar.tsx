"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DocsNavGroup } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

const linkClass =
  "shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/** Renders the nav derived from the docs frontmatter (`lib/docs-nav.ts`). */
export function DocsSidebar({ groups }: { groups: DocsNavGroup[] }) {
  const pathname = usePathname();
  const sections = [
    { group: null, items: [{ href: "/docs", title: "Overview" }] },
    ...groups.map(({ group, items }) => ({
      group,
      items: items.map((item) => ({ href: `/docs/${item.slug}`, title: item.title })),
    })),
  ];

  return (
    <nav
      aria-label="Documentation"
      className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
    >
      {sections.map(({ group, items }, index) => (
        <div key={group ?? `ungrouped-${index}`} className="contents md:block">
          {group ? (
            <p className="hidden px-3 pt-4 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase md:block">
              {group}
            </p>
          ) : null}
          <ul className="contents md:flex md:flex-col md:gap-1">
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href} className="contents">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      linkClass,
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground active:bg-accent",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
