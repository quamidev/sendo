import type { Metadata } from "next";
import { alternatesFor, getDictionary } from "@/lib/i18n";
import { pageLang } from "@/lib/i18n/page-lang";
import { rich } from "@/lib/i18n/rich";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/compare">): Promise<Metadata> {
  const lang = await pageLang(params);
  return { ...getDictionary(lang).compare.meta, alternates: alternatesFor("/compare", lang) };
}

/** Placeholder from SNL-4.1; SNL-4.6 fills in the comparison. */
export default async function ComparePage({ params }: PageProps<"/[lang]/compare">) {
  const t = getDictionary(await pageLang(params)).compare;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t.title}</h1>
      <p className="mt-3 max-w-2xl text-base text-pretty text-muted-foreground">{rich(t.intro)}</p>
      <p className="mt-6 text-sm text-muted-foreground">{t.placeholder}</p>
    </main>
  );
}
