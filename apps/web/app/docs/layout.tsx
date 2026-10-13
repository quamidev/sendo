import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/site/docs-sidebar";
import { RootDocument } from "@/components/site/root-document";
import { SiteHeader } from "@/components/site/site-header";
import { getDocsNavGroups } from "@/lib/docs-nav";
import { SITE_URL } from "@/lib/docs-source.mjs";
import { getDictionary } from "@/lib/i18n";

const { site } = getDictionary("en").header;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: site.title, template: site.titleTemplate },
  description: site.description,
};

/** Root layout of `/docs`: English only, no language prefix, same header as the site. */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <RootDocument lang="en">
      <SiteHeader />
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row md:gap-10 md:px-6 md:py-10">
        <aside className="border-b pb-3 md:sticky md:top-24 md:w-52 md:shrink-0 md:self-start md:border-b-0 md:pb-0">
          <DocsSidebar groups={getDocsNavGroups()} />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </RootDocument>
  );
}
