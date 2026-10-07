import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { docsNav, findDocsNavItem } from "@/lib/docs-nav";

export const dynamicParams = false;

export function generateStaticParams() {
  return docsNav.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: findDocsNavItem(slug)?.title ?? "Docs" };
}

export default async function DocsPlaceholderPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const item = findDocsNavItem(slug);
  if (!item) notFound();

  return (
    <article className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{item.title}</h1>
      <p className="mt-3 text-muted-foreground">{item.description}</p>
      <p className="mt-8 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        This page is being written.
      </p>
    </article>
  );
}
