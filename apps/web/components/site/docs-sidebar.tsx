"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsNav } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

export function DocsSidebar() {
  const pathname = usePathname();
  const items = [
    { href: "/docs", title: "Overview" },
    ...docsNav.map((item) => ({ href: `/docs/${item.slug}`, title: item.title })),
  ];

  return (
    <nav
      aria-label="Documentation"
      className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible"
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-sm whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground active:bg-accent",
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}
