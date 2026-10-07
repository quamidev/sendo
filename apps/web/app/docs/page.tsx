import type { Metadata } from "next";
import Link from "next/link";
import { docsNav } from "@/lib/docs-nav";

export const metadata: Metadata = { title: "Docs" };

export default function DocsIndexPage() {
  return (
    <article className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Documentation</h1>
      <p className="mt-3 text-muted-foreground">
        Everything needed to connect a Next.js + Supabase app to WhatsApp with @quami/wa-li.
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {docsNav.map((item) => (
          <li key={item.slug}>
            <Link
              href={`/docs/${item.slug}`}
              className="block h-full rounded-lg border bg-card p-4 text-card-foreground outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent"
            >
              <span className="text-sm font-medium">{item.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{item.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
