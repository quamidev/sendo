import { SiteFooter } from "@/components/site/site-footer";
import { pageLang } from "@/lib/i18n/page-lang";

/** Content pages get the site footer; the home and the demo fill one screen (AC-ST-6) and don't. */
export default async function PagesLayout({ children, params }: LayoutProps<"/[lang]">) {
  return (
    <>
      {children}
      <SiteFooter lang={await pageLang(params)} />
    </>
  );
}
