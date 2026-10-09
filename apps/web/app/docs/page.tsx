import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getDocsNav } from "@/lib/docs-nav";

export const metadata: Metadata = { title: "Docs" };

const cardClass =
  "block h-full rounded-lg border bg-card p-4 text-card-foreground outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent";

export default function DocsIndexPage() {
  const [first, ...rest] = getDocsNav();
  return (
    <article className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Documentation</h1>
      <p className="mt-3 text-base text-pretty text-muted-foreground md:text-lg">
        Connect a Next.js + Supabase app to WhatsApp with{" "}
        <code className="font-mono">@quami/sendo</code>: a typed Cloud API client with AI agents,
        plus registry items for the webhook, the schema and a staff inbox. Your data stays in your
        database.
      </p>

      {first ? (
        <Link href={`/docs/${first.slug}`} className={`${cardClass} mt-8 p-5`}>
          <span className="flex items-center gap-2 text-sm font-medium">
            Start here: {first.title}
            <ArrowRightIcon aria-hidden className="size-4" />
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">{first.description}</span>
        </Link>
      ) : null}

      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {rest.map((item) => (
          <li key={item.slug}>
            <Link href={`/docs/${item.slug}`} className={cardClass}>
              <span className="text-sm font-medium">{item.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{item.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
