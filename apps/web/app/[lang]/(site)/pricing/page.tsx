import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { Heading } from "@/components/docs/heading";
import { A, List, P } from "@/components/docs/prose";
import { alternatesFor, getDictionary, type Lang } from "@/lib/i18n";
import { pageLang } from "@/lib/i18n/page-lang";
import { rich } from "@/lib/i18n/rich";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/pricing">): Promise<Metadata> {
  const lang = await pageLang(params);
  const { meta } = getDictionary(lang).pricing;
  return { ...meta, alternates: alternatesFor("/pricing", lang) };
}

/**
 * `/[lang]/pricing` (AC-CN-5, AC-CN-7, AC-ST-11, AC-ST-12). Static; every claim mirrors
 * `content/docs/{sendo-connect,meta-pricing,coexistence}.mdx`. Each plan card states what Quami
 * sees and keeps in the same block, so the Connect privacy cost carries the same weight as
 * "Your own Meta app — Free". Meta's rates are linked, never copied.
 */
function PricingContent({ lang }: { lang: Lang }) {
  const t = getDictionary(lang).pricing;
  const plans = [
    { id: "own-app", ...t.plans.ownApp },
    { id: "connect", ...t.plans.connect },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t.title}</h1>
      <p className="mt-3 max-w-2xl text-base text-pretty text-muted-foreground">{rich(t.intro)}</p>

      <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2" aria-label={t.plansLabel}>
        {plans.map((plan) => (
          <li
            key={plan.id}
            id={plan.id}
            aria-labelledby={`${plan.id}-name`}
            className="flex scroll-mt-24 flex-col gap-4 rounded-lg border p-5"
          >
            <div>
              <h2 id={`${plan.id}-name`} className="text-base font-semibold">
                {plan.name}
              </h2>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{plan.price}</p>
              <p className="text-xs text-muted-foreground">{plan.priceNote}</p>
              <p className="mt-3 text-sm text-pretty text-muted-foreground">{plan.summary}</p>
            </div>
            <ul className="flex flex-col gap-2 text-sm">
              {plan.points.map((point) => (
                <li key={point} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground"
                  />
                  <span className="min-w-0">{rich(point)}</span>
                </li>
              ))}
            </ul>
            <section
              id={`${plan.id}-privacy`}
              aria-labelledby={`${plan.id}-privacy-title`}
              className="rounded-md border bg-muted/40 p-4"
            >
              <h3 id={`${plan.id}-privacy-title`} className="text-base font-semibold">
                {plan.privacy.title}
              </h3>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {plan.privacy.points.map((point) => (
                  <li key={point} className="text-pretty">
                    {rich(point)}
                  </li>
                ))}
              </ul>
            </section>
            <p className="mt-auto text-sm">
              <A href={plan.cta.href}>{plan.cta.label}</A>
            </p>
          </li>
        ))}
      </ul>

      <Heading level={2} id="coexistence" anchorLabel={t.anchorLabel}>
        {t.coexistence.heading}
      </Heading>
      <P>{rich(t.coexistence.body)}</P>

      <Heading level={2} id="who-pays-meta" anchorLabel={t.anchorLabel}>
        {t.whoPaysMeta.heading}
      </Heading>
      <P>{rich(t.whoPaysMeta.body)}</P>
      <P>{t.whoPaysMeta.dimensionsIntro}</P>
      <List>
        {t.whoPaysMeta.dimensions.map((point) => (
          <li key={point}>{rich(point)}</li>
        ))}
      </List>
      <P>{rich(t.whoPaysMeta.serviceChange)}</P>
      <Callout variant="warning" title={t.billing.title}>
        <p>&ldquo;{t.billing.caveat}&rdquo;</p>
        <p>{rich(t.billing.body)}</p>
      </Callout>

      <Heading level={2} id="privacy" anchorLabel={t.anchorLabel}>
        {t.privacy.heading}
      </Heading>
      <List>
        {t.privacy.points.map((point) => (
          <li key={point}>{rich(point)}</li>
        ))}
      </List>

      <Heading level={2} id="sensitive-data" anchorLabel={t.anchorLabel}>
        {t.sensitive.heading}
      </Heading>
      <P>{rich(t.sensitive.body)}</P>
    </main>
  );
}

export default async function PricingPage({ params }: PageProps<"/[lang]/pricing">) {
  return <PricingContent lang={await pageLang(params)} />;
}
