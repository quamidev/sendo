import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { Heading } from "@/components/docs/heading";
import { A, List, P } from "@/components/docs/prose";
import { alternatesFor, getDictionary, localizedPath, type Lang } from "@/lib/i18n";
import type { LegalBlock } from "@/lib/i18n/dictionaries/legal";
import { interpolate, rich } from "@/lib/i18n/rich";
import { LEGAL_ENTITY, LEGAL_PHONE_URI, LEGAL_PLACEHOLDERS } from "@/lib/legal/entity";

/** The three legal pages, keyed like their dictionary entries, with their path under `/{lang}`. */
export const LEGAL_PAGES = {
  privacy: "/privacy",
  terms: "/terms",
  dataDeletion: "/data-deletion",
} as const;

export type LegalPageKey = keyof typeof LEGAL_PAGES;

const fill = (text: string) => interpolate(text, LEGAL_PLACEHOLDERS);

/** The registered name and address are Spanish proper names: marked so on `/en` pages too. */
const Es = ({ children }: { children: ReactNode }) => <span lang="es">{children}</span>;

/** `rich(fill(text))`, with `{legalName}` rendered as `<span lang="es">`. */
function legalText(text: string): ReactNode {
  const parts = text.split("{legalName}");
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <Es>{LEGAL_ENTITY.legalName}</Es>}
      {rich(fill(part))}
    </Fragment>
  ));
}

export function legalMetadata(page: LegalPageKey, lang: Lang): Metadata {
  const { meta } = getDictionary(lang).legal[page];
  return {
    title: fill(meta.title),
    description: fill(meta.description),
    alternates: alternatesFor(LEGAL_PAGES[page], lang),
  };
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <P>{legalText(block)}</P>;
  return (
    <List>
      {block.map((item) => (
        <li key={item}>{legalText(item)}</li>
      ))}
    </List>
  );
}

/**
 * `/[lang]/{privacy,terms,data-deletion}`: the copy from `lib/i18n/dictionaries/legal*.ts`, with
 * the provider's identity (`LEGAL_ENTITY`) and the last-updated date shared by all three.
 */
export function LegalPage({ page, lang }: { page: LegalPageKey; lang: Lang }) {
  const { labels, [page]: t } = getDictionary(lang).legal;
  const updated = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${LEGAL_ENTITY.lastUpdated}T00:00:00Z`),
  );
  const rows: { label: string; value: ReactNode }[] = [
    { label: labels.entity.legalName, value: <Es>{LEGAL_ENTITY.legalName}</Es> },
    { label: labels.entity.taxId, value: LEGAL_ENTITY.taxId },
    LEGAL_ENTITY.address === ""
      ? { label: labels.entity.country, value: LEGAL_ENTITY.country }
      : { label: labels.entity.address, value: <Es>{LEGAL_ENTITY.address}</Es> },
    {
      label: labels.entity.phone,
      value: <A href={LEGAL_PHONE_URI}>{LEGAL_ENTITY.phone}</A>,
    },
    {
      label: labels.entity.email,
      value: <A href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</A>,
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {labels.lastUpdated} <time dateTime={LEGAL_ENTITY.lastUpdated}>{updated}</time>
      </p>
      <p className="mt-4 text-base text-pretty text-muted-foreground">
        {legalText(labels.tradeName)} {legalText(t.intro)}
      </p>

      <section
        aria-label={labels.entity.title}
        data-testid="legal-entity"
        className="mt-6 rounded-md border bg-muted/40 p-4"
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words max-sm:mb-2">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <nav aria-label={labels.contents} className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">{labels.contents}</h2>
        <ol className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {t.sections.map((section) => (
            <li key={section.id} className="min-w-0">
              <a
                href={`#${section.id}`}
                className="rounded-sm text-muted-foreground underline decoration-border underline-offset-[3px] outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:text-foreground/80"
              >
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {t.sections.map((section) => (
        <section key={section.id} aria-labelledby={section.id}>
          <Heading level={2} id={section.id} anchorLabel={labels.anchorLabel}>
            {section.heading}
          </Heading>
          {section.blocks.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </main>
  );
}

/** `[{ href: "/es/privacy", label: "Privacidad" }, …]` for the footer and the home's footer line. */
export function legalLinks(lang: Lang): { href: string; label: string }[] {
  const labels = getDictionary(lang).footer.legal;
  return (Object.keys(LEGAL_PAGES) as LegalPageKey[]).map((page) => ({
    href: localizedPath(lang, LEGAL_PAGES[page]),
    label: labels[page],
  }));
}
