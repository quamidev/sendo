import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "@/components/docs/doc-page";
import { getDocsNav, getDocsPage } from "@/lib/docs-nav";

// One static page per `content/docs/<slug>.mdx`; anything else is a 404. `next dev` caches
// these params: restart it after adding a new page (edits to existing pages hot-reload).
export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return getDocsNav().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = getDocsPage(slug);
  return page ? { title: page.title, description: page.description } : {};
}

export default async function DocsSlugPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const page = getDocsPage(slug);
  if (!page) notFound();
  const { default: Content } = await import(`@/content/docs/${slug}.mdx`);
  return (
    <DocPage page={page}>
      <Content />
    </DocPage>
  );
}
