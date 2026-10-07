import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("my-4 leading-7 text-pretty", className)}>{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-base text-pretty text-muted-foreground md:text-lg">{children}</p>;
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words">
      {children}
    </code>
  );
}

export function List({
  children,
  ordered = false,
}: {
  children: ReactNode;
  ordered?: boolean;
}) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "my-4 space-y-2 pl-5 leading-7 marker:text-muted-foreground",
        ordered ? "list-decimal" : "list-disc",
      )}
    >
      {children}
    </Tag>
  );
}

const linkClass =
  "rounded-sm font-medium underline decoration-muted-foreground/50 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70";

/** Internal (`/docs/...`) or external link. External links open in a new tab. */
export function A({ href, children, ...props }: ComponentProps<"a"> & { href: string }) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} className={linkClass}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass} {...props}>
      {children}
    </a>
  );
}

/** Numbered step with its own anchor (quickstart). */
export function Step({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="relative mt-10 border-l pl-6 md:pl-8">
      <span
        aria-hidden
        className="absolute top-0 -left-3.5 flex size-7 items-center justify-center rounded-full border bg-background font-mono text-xs font-medium"
      >
        {n}
      </span>
      <h2
        id={id}
        className="scroll-mt-24 text-lg leading-7 font-semibold tracking-tight md:text-xl"
      >
        {title}
      </h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Marks where a screenshot will go. Real screenshots are a TODO. */
export function ScreenshotPlaceholder({ caption }: { caption: string }) {
  return (
    <figure className="my-5 flex aspect-[16/7] items-center justify-center rounded-lg border border-dashed bg-muted/30 p-4 text-center">
      <figcaption className="max-w-sm text-sm text-muted-foreground">
        <span className="font-mono text-xs">TODO screenshot</span>
        <span className="mt-1 block">{caption}</span>
      </figcaption>
    </figure>
  );
}
