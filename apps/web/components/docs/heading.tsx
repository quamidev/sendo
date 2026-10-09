import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const styles = {
  2: "mt-12 mb-3 scroll-mt-24 text-xl font-semibold tracking-tight md:text-2xl",
  3: "mt-8 mb-2 scroll-mt-24 text-base font-semibold tracking-tight md:text-lg",
} as const;

/** Section heading with a hover/focus anchor link. */
export function Heading({
  level = 2,
  id,
  children,
}: {
  level?: 2 | 3;
  id: string;
  children: ReactNode;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag id={id} className={cn("group/heading", styles[level])}>
      {children}
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="ml-2 rounded-sm text-muted-foreground opacity-0 outline-none group-hover/heading:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-60"
      >
        #
      </a>
    </Tag>
  );
}
