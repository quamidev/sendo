import type { Metadata } from "next";
import { InboxFrame } from "@/components/demo/inbox-frame";
import { seedDemoFixtures } from "@/lib/demo/fixtures";
import { inboxSnapshot } from "@/lib/demo/snapshot";
import { createDemoWorld } from "@/lib/demo/world";
import { DEFAULT_LANG, isLang } from "@/lib/i18n/langs";
import "@/components/sendo/motion.css";

export const metadata: Metadata = {
  title: "Demo inbox",
  robots: { index: false, follow: false },
};

/**
 * The demo inbox embedded by `/[lang]` and `/[lang]/demo` (`/demo/inbox?lang=es|en`, default
 * `en`): the real `inbox` component on fixtures in that language, computed by the real
 * `sendo.inbox` API over the memory adapter at request time (times are relative to the render).
 */
export default async function DemoInboxFramePage({ searchParams }: PageProps<"/demo/inbox">) {
  const requested = (await searchParams).lang;
  const lang = typeof requested === "string" && isLang(requested) ? requested : DEFAULT_LANG;
  const world = await createDemoWorld(lang);
  const ids = await seedDemoFixtures(world);
  const fixtures = await inboxSnapshot(world, ids);
  return <InboxFrame lang={lang} fixtures={fixtures} />;
}
