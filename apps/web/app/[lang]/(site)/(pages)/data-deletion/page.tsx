import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/site/legal-page";
import { pageLang } from "@/lib/i18n/page-lang";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/data-deletion">): Promise<Metadata> {
  return legalMetadata("dataDeletion", await pageLang(params));
}

export default async function DataDeletionPage({ params }: PageProps<"/[lang]/data-deletion">) {
  return <LegalPage page="dataDeletion" lang={await pageLang(params)} />;
}
