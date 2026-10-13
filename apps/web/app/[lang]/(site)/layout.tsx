import { SiteHeader } from "@/components/site/site-header";
import { pageLang } from "@/lib/i18n/page-lang";

export default async function SiteLayout({ children, params }: LayoutProps<"/[lang]">) {
  return (
    <>
      <SiteHeader lang={await pageLang(params)} />
      {children}
    </>
  );
}
