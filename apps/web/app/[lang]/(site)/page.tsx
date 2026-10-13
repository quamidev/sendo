import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/docs/copy-button";
import { DemoExperience } from "@/components/demo/demo-experience";
import { Button } from "@/components/ui/button";
import { alternatesFor, getDictionary, localizedPath } from "@/lib/i18n";
import { INSTALL_COMMANDS } from "@/lib/i18n/dictionaries/home";
import { pageLang } from "@/lib/i18n/page-lang";
import { rich } from "@/lib/i18n/rich";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const lang = await pageLang(params);
  return {
    description: getDictionary(lang).home.meta.description,
    alternates: alternatesFor("/", lang),
  };
}

export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const lang = await pageLang(params);
  const t = getDictionary(lang).home;
  const commands = [
    { command: INSTALL_COMMANDS.package, note: t.installNotes.package },
    { command: INSTALL_COMMANDS.registry, note: t.installNotes.registry },
  ];
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 md:px-6 xl:h-[calc(100dvh-3.5rem)] xl:min-h-[760px] xl:py-6">
      <section className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{t.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance md:text-[2.5rem] md:leading-[1.1]">
            {t.headline}
          </h1>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <div className="flex flex-col gap-3">
            <p className="text-base text-pretty text-muted-foreground">{t.lede}</p>
            <p className="text-[13px] text-pretty text-muted-foreground">
              <span className="font-medium text-foreground">{t.unofficial.question}</span>{" "}
              {t.unofficial.answer}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2" aria-label={t.installLabel}>
              {commands.map(({ command, note }) => (
                <li
                  key={command}
                  className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3"
                >
                  <div className="min-w-0 flex-1">
                    <code className="block truncate font-mono text-[13px]" title={command}>
                      <span aria-hidden className="text-muted-foreground select-none">
                        ${" "}
                      </span>
                      {command}
                    </code>
                    <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
                  </div>
                  <CopyButton value={command} />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <Button asChild size="sm" className="active:bg-primary/80">
                <Link href="/docs/quickstart">
                  {t.quickstart}
                  <ArrowRightIcon />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="active:bg-accent/70">
                <Link href="/docs">{t.docs}</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="active:bg-accent/70">
                <Link href={localizedPath(lang, "/demo")}>{t.fullDemo}</Link>
              </Button>
              <p className="basis-full text-xs text-pretty text-muted-foreground">{t.timeNote}</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="demo-heading" className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 id="demo-heading" className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">{t.demo.lead}</span> {rich(t.demo.body)}
        </h2>
        <DemoExperience className="min-h-0 flex-1 md:h-[560px] xl:h-auto" />
      </section>
    </main>
  );
}
