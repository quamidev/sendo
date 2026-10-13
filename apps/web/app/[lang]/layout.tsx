import type { Metadata } from "next";
import { RootDocument } from "@/components/site/root-document";
import { LANGS, getDictionary } from "@/lib/i18n";
import { pageLang } from "@/lib/i18n/page-lang";
import { SITE_URL } from "@/lib/docs-source.mjs";

// Only `/es/*` and `/en/*`; any other first segment that no other route claims is a 404.
export const dynamicParams = false;

export function generateStaticParams(): { lang: string }[] {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { site } = getDictionary(await pageLang(params)).header;
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: site.title, template: site.titleTemplate },
    description: site.description,
  };
}

/** Root layout of the marketing pages: `<html lang>` follows the URL prefix (AC-ST-2). */
export default async function LangLayout({ children, params }: LayoutProps<"/[lang]">) {
  return <RootDocument lang={await pageLang(params)}>{children}</RootDocument>;
}
