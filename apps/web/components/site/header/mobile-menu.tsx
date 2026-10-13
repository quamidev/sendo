"use client";

import { ArrowRightIcon, MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LinkHint } from "./link-hint";
import type { HeaderLink } from "./links";

const iconButton =
  "inline-flex size-10 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent [&_svg]:size-[18px]";

/** Below `md`: hamburger that opens a top sheet with every header destination. */
export function MobileMenu({
  links,
  navLabel,
  labels,
  themeLabel,
}: {
  links: HeaderLink[];
  navLabel: string;
  labels: { title: string; open: string; close: string };
  themeLabel: string;
}) {
  return (
    <Sheet>
      <SheetTrigger className={iconButton} aria-label={labels.open}>
        <MenuIcon aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="top"
        showCloseButton={false}
        aria-describedby={undefined}
        className="gap-0"
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b px-3.5">
          <SheetTitle className="font-mono text-sm">{labels.title}</SheetTitle>
          <div className="flex items-center gap-1">
            <ThemeToggle label={themeLabel} className="size-10" />
            <SheetClose className={iconButton} aria-label={labels.close}>
              <XIcon aria-hidden />
            </SheetClose>
          </div>
        </div>
        <nav aria-label={navLabel} className="flex flex-col px-3.5 pt-1 pb-4">
          {links.map((link) => {
            const content = (
              <>
                <span>
                  {link.label}
                  {link.hint ? <LinkHint hint={link.hint} /> : null}
                </span>
                <ArrowRightIcon aria-hidden className="size-4 text-muted-foreground" />
              </>
            );
            const className =
              "flex min-h-12 items-center justify-between border-b text-[15px] outline-none last:border-b-0 hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:text-muted-foreground";
            return (
              <SheetClose key={link.href} asChild>
                {link.external ? (
                  <a href={link.href} target="_blank" rel="noreferrer" className={className}>
                    {content}
                  </a>
                ) : (
                  <Link href={link.href} className={className}>
                    {content}
                  </Link>
                )}
              </SheetClose>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
