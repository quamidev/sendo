import { notFound } from "next/navigation";
import { isLang, type Lang } from "./langs";

/** The `[lang]` route param as a `Lang`; anything else is a 404. */
export async function pageLang(params: Promise<{ lang: string }>): Promise<Lang> {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return lang;
}
