import type { Metadata } from "next";
import { Heading } from "@/components/docs/heading";
import { List, P } from "@/components/docs/prose";
import { alternatesFor, getDictionary } from "@/lib/i18n";
import { COMPARE_PRODUCTS, COMPARE_ROWS } from "@/lib/i18n/dictionaries/compare";
import { pageLang } from "@/lib/i18n/page-lang";
import { rich } from "@/lib/i18n/rich";
import { cn } from "@/lib/utils";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/compare">): Promise<Metadata> {
  const lang = await pageLang(params);
  return { ...getDictionary(lang).compare.meta, alternates: alternatesFor("/compare", lang) };
}

/**
 * `/[lang]/compare` (AC-ST-10). One comparison, two layouts: a table from `md`, one card per topic
 * below it, so a 390 px page never scrolls sideways. Competitor cells are dated and sourced in
 * the dictionary (`lib/i18n/dictionaries/compare.ts`).
 */
export default async function ComparePage({ params }: PageProps<"/[lang]/compare">) {
  const t = getDictionary(await pageLang(params)).compare;
  const rows = COMPARE_ROWS.map((id) => ({ id, ...t.rows[id] }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t.title}</h1>
      <p className="mt-3 max-w-2xl text-base text-pretty text-muted-foreground">{rich(t.intro)}</p>
      <p className="mt-6 text-sm text-pretty text-muted-foreground">{t.asOf}</p>

      <div className="mt-4 hidden md:block" data-testid="compare-table">
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">{t.table.caption}</caption>
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[32%]" />
            <col className="w-[26%]" />
            <col className="w-[26%]" />
          </colgroup>
          <thead>
            <tr className="border-b">
              <th scope="col" className="py-3 pr-4 text-left font-medium text-muted-foreground">
                {t.table.dimension}
              </th>
              {COMPARE_PRODUCTS.map((product) => (
                <th
                  key={product}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-left font-semibold",
                    product === "sendo" && "rounded-t-md bg-muted/50",
                  )}
                >
                  {t.table.products[product]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} id={`row-${row.id}`} className="border-b align-top last:border-b-0">
                <th scope="row" className="py-4 pr-4 text-left font-medium">
                  {row.label}
                </th>
                {COMPARE_PRODUCTS.map((product) => (
                  <td
                    key={product}
                    className={cn(
                      "px-4 py-4 text-pretty",
                      product === "sendo" ? "bg-muted/50" : "text-muted-foreground",
                    )}
                  >
                    {rich(row[product])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 flex flex-col gap-4 md:hidden" aria-label={t.table.caption}>
        {rows.map((row) => (
          <li key={row.id} className="min-w-0 rounded-lg border p-4">
            <h2 className="text-base font-semibold">{row.label}</h2>
            <dl className="mt-3 flex flex-col gap-3 text-sm">
              {COMPARE_PRODUCTS.map((product) => (
                <div
                  key={product}
                  className={cn("min-w-0", product === "sendo" && "rounded-md bg-muted/50 p-3")}
                >
                  <dt className="font-medium">{t.table.products[product]}</dt>
                  <dd
                    className={cn(
                      "mt-1 text-pretty break-words",
                      product !== "sendo" && "text-muted-foreground",
                    )}
                  >
                    {rich(row[product])}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <div className="max-w-3xl">
        <Heading level={2} id="fit" anchorLabel={t.anchorLabel}>
          {t.fit.heading}
        </Heading>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[t.fit.sendo, t.fit.others].map((group) => (
            <div key={group.title}>
              <h3 className="font-semibold">{group.title}</h3>
              <List>
                {group.points.map((point) => (
                  <li key={point}>{rich(point)}</li>
                ))}
              </List>
            </div>
          ))}
        </div>

        <Heading level={2} id="migrate" anchorLabel={t.anchorLabel}>
          {t.migrate.heading}
        </Heading>
        <P>{rich(t.migrate.body)}</P>

        <p className="mt-10 text-xs text-pretty text-muted-foreground">{t.disclaimer}</p>
      </div>
    </main>
  );
}
