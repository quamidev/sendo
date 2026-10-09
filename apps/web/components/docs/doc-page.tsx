import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Lead } from "@/components/docs/prose";
import type { DocsPage } from "@/lib/docs-nav";

const pagerLink =
  "flex min-w-0 flex-1 flex-col gap-1 rounded-lg border p-3 text-sm outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent";

/** Title, description, "On this page" (the page's `##`/`###` headings) and the pager. */
export function DocPage({ page, children }: { page: DocsPage; children: ReactNode }) {
  const { prev, next, headings: toc } = page;

  return (
    <article className="max-w-3xl min-w-0">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          {page.title}
        </h1>
        <Lead>{page.description}</Lead>
      </header>

      {toc.length > 0 ? (
        <nav aria-label="On this page" className="mt-6 rounded-lg border p-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            On this page
          </p>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className="block rounded-sm py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-70"
                >
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <div className="mt-6">{children}</div>

      <nav aria-label="Pagination" className="mt-16 flex flex-col gap-3 border-t pt-6 sm:flex-row">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className={pagerLink}>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowLeftIcon aria-hidden className="size-3" /> Previous
            </span>
            <span className="truncate font-medium">{prev.title}</span>
          </Link>
        ) : (
          <span className="hidden flex-1 sm:block" />
        )}
        {next ? (
          <Link href={`/docs/${next.slug}`} className={`${pagerLink} sm:items-end sm:text-right`}>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              Next <ArrowRightIcon aria-hidden className="size-3" />
            </span>
            <span className="truncate font-medium">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
