import type { Metadata } from "next";
import { LegalPage, legalMetadata } from "@/components/site/legal-page";
import { pageLang } from "@/lib/i18n/page-lang";

export async function generateMetadata({ params }: PageProps<"/[lang]/terms">): Promise<Metadata> {
  return legalMetadata("terms", await pageLang(params));
}

export default async function TermsPage({ params }: PageProps<"/[lang]/terms">) {
  return <LegalPage page="terms" lang={await pageLang(params)} />;
}
