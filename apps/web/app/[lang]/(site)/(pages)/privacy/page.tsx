import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/site/legal-page";
import { pageLang } from "@/lib/i18n/page-lang";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  return legalMetadata("privacy", await pageLang(params));
}

export default async function PrivacyPage({ params }: PageProps<"/[lang]/privacy">) {
  return <LegalPage page="privacy" lang={await pageLang(params)} />;
}
