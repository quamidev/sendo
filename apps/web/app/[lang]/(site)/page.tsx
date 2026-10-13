import { ArrowRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/docs/copy-button";
import { DemoExperience } from "@/components/demo/demo-experience";
import { LinkHint } from "@/components/site/header/link-hint";
import { MobileInstallTabs } from "@/components/site/mobile-install-tabs";
import { UnofficialApiNote } from "@/components/site/unofficial-api-note";
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

/**
 * Home, "Your app stage" (`home-option-b.html`). From `md` the page is exactly one viewport tall
 * under the header (AC-ST-6; its 56 px bar plus a 1 px bottom border): the hero, the install row and the footer line take their
 * natural height and the stage (`DemoExperience variant="stage"`) gets the rest, with the inbox
 * scrolling inside its frame. Below `md` ("Two-view toggle", `home-mobile-option-a.html`): eyebrow,
 * headline and lede; the demo (the same `DemoExperience`, one pane at a time); the tabbed install
 * box; Quickstart and Docs; the compare card and the bigger-screen note. The `md:hidden` /
 * `max-md:hidden` sections are the only parts that differ.
 */
export default async function HomePage({ params }: PageProps<"/[lang]">) {
  const lang = await pageLang(params);
  const dictionary = getDictionary(lang);
  const t = dictionary.home;
  const docsHint =
    lang === "en"
      ? undefined
      : { text: dictionary.header.docsHint, label: dictionary.header.docsHintLabel };
  const commands = [
    { command: INSTALL_COMMANDS.package, note: t.install.notes.package },
    { command: INSTALL_COMMANDS.registry, note: t.install.notes.registry },
  ];
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-3.5 px-3.5 pt-[18px] pb-7 md:h-[calc(100dvh-3.5rem-1px)] md:min-h-[640px] md:gap-4 md:px-6 md:pt-5 md:pb-4">
      <section className="flex flex-col gap-2.5 max-md:items-start md:items-center md:text-center">
        <p className="font-mono text-[11px] text-muted-foreground md:hidden">{t.mobile.eyebrow}</p>
        <h1 className="max-w-[24ch] text-[1.6875rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance md:text-[2.5rem] md:leading-[1.05] md:tracking-[-0.035em]">
          {t.headline.lead}
          <em className="whitespace-nowrap text-whatsapp-strong not-italic">{t.headline.accent}</em>
          {t.headline.tail}
        </h1>
        <p className="max-w-[68rem] text-sm leading-normal text-pretty text-muted-foreground md:text-[15px]">
          {t.lede}
        </p>
        <div className="mt-1.5 flex w-full flex-wrap items-center justify-center gap-2 max-md:hidden">
          <ul
            aria-label={t.install.label}
            className="flex max-w-full min-w-0 flex-wrap items-center justify-center gap-2"
          >
            {commands.map(({ command, note }) => (
              <li
                key={command}
                data-testid="install-command"
                className="flex max-w-full min-w-0 items-center gap-2.5 rounded-[10px] border bg-background py-1 pr-1 pl-3"
              >
                <code className="min-w-0 truncate font-mono text-[12.5px]" title={command}>
                  <span aria-hidden className="text-muted-foreground select-none">
                    ${" "}
                  </span>
                  {command}
                </code>
                <span className="shrink-0 border-l pl-2.5 text-[11px] text-muted-foreground">
                  {note}
                </span>
                <CopyButton value={command} labels={t.install.copy} className="bg-muted" />
              </li>
            ))}
          </ul>
          <Button asChild size="sm" className="h-[34px] px-3.5 active:bg-primary/80">
            <Link href="/docs/quickstart">
              {t.quickstart}
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      <DemoExperience lang={lang} variant="stage" className="mt-1 md:flex-1" />

      <section aria-label={t.mobile.install.label} className="flex flex-col gap-2.5 md:hidden">
        <MobileInstallTabs
          label={t.mobile.install.label}
          copyLabels={t.install.copy}
          tabs={[
            { id: "package", label: t.mobile.install.tabs[0], command: INSTALL_COMMANDS.package },
            { id: "registry", label: t.mobile.install.tabs[1], command: INSTALL_COMMANDS.registry },
          ]}
        />
        <div className="flex gap-2">
          <Button asChild className="h-10 flex-1 rounded-[10px] active:bg-primary/80">
            <Link href="/docs/quickstart">
              {t.quickstart}
              <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-10 flex-1 rounded-[10px] active:bg-accent/70"
          >
            <Link href="/docs" hrefLang={docsHint === undefined ? undefined : "en"}>
              <span>
                {t.mobile.docs}
                {docsHint !== undefined && <LinkHint hint={docsHint} />}
              </span>
            </Link>
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2.5 border-t border-dashed pt-3.5 md:hidden">
        <Link
          href={localizedPath(lang, "/compare")}
          className="flex min-h-10 items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5 text-sm outline-none hover:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
        >
          <span className="flex min-w-0 flex-col">
            {t.mobile.compare.title}
            <small className="text-xs text-muted-foreground">{t.mobile.compare.detail}</small>
          </span>
          <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        <p className="text-xs leading-normal text-pretty text-muted-foreground [&_code]:text-foreground">
          {rich(t.mobile.biggerScreen)}
        </p>
      </section>

      <p className="flex flex-wrap items-center justify-center gap-x-[18px] gap-y-1 text-center text-xs text-muted-foreground max-md:hidden">
        <span>{t.footer.timeNote}</span>
        <Link
          href={localizedPath(lang, "/compare")}
          className="rounded-sm underline decoration-border underline-offset-[3px] outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:text-foreground/80"
        >
          {t.footer.compare}
        </Link>
        <UnofficialApiNote {...t.footer.unofficial} />
      </p>
    </main>
  );
}
