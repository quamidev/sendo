import { SCHEMA_MIGRATIONS } from "@quami/sendo";
import type { Metadata } from "next";
import { Heading } from "@/components/docs/heading";
import { A, C, P } from "@/components/docs/prose";
import { Markdown } from "@/components/site/markdown";
import { loadChangelog, pendingMarkdown, sectionMentioning, versionId } from "@/lib/changelog";
import { alternatesFor, getDictionary } from "@/lib/i18n";
import { pageLang } from "@/lib/i18n/page-lang";
import { rich } from "@/lib/i18n/rich";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/changelog">): Promise<Metadata> {
  const lang = await pageLang(params);
  return { ...getDictionary(lang).changelog.meta, alternates: alternatesFor("/changelog", lang) };
}

/**
 * Rendered at build time from `packages/sendo/CHANGELOG.md` and the pending `.changeset/*.md`.
 * `#schema-vN` anchors are what `sendo doctor` and the schema-drift warning link to. The chrome is
 * translated; the release entries stay English inside `lang="en"` (AC-ST-4).
 */
export default async function ChangelogPage({ params }: PageProps<"/[lang]/changelog">) {
  const lang = await pageLang(params);
  const t = getDictionary(lang).changelog;
  const source = loadChangelog();
  const pending = source.pending.length > 0 ? pendingMarkdown(source.pending) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{t.title}</h1>
      <p className="mt-3 text-base text-pretty text-muted-foreground">
        {rich(t.intro)}
        {lang === "en" ? null : <> {t.entriesInEnglish}</>}
      </p>

      <Heading level={2} id="schema-versions" anchorLabel={t.anchorLabel}>
        {t.schema.heading}
      </Heading>
      <P>{rich(t.schema.body)}</P>
      <div className="my-5 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t.schema.columns.version}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t.schema.columns.file}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t.schema.columns.notes}
              </th>
            </tr>
          </thead>
          <tbody>
            {SCHEMA_MIGRATIONS.map((migration) => {
              const section = sectionMentioning(source, migration.file);
              return (
                <tr
                  key={migration.version}
                  id={`schema-v${String(migration.version)}`}
                  className="scroll-mt-24 border-t align-top target:bg-accent/60"
                >
                  <td className="px-3 py-2 font-mono">v{migration.version}</td>
                  <td className="px-3 py-2">
                    <C>{migration.file}</C>
                  </td>
                  <td className="px-3 py-2">
                    {section === null ? (
                      "—"
                    ) : (
                      <A href={`#${section}`}>
                        {section === "next-release"
                          ? t.schema.nextRelease
                          : section.slice(1).replaceAll("-", ".")}
                      </A>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pending !== null && (
        <section aria-labelledby="next-release">
          <Heading level={2} id="next-release" anchorLabel={t.anchorLabel}>
            {t.nextRelease.heading}
          </Heading>
          <P className="text-muted-foreground">{rich(t.nextRelease.body)}</P>
          <div lang="en">
            <Markdown
              source={pending}
              headingId={(text) => `next-${text.toLowerCase().replace(/\s+/g, "-")}`}
            />
          </div>
        </section>
      )}

      {source.released === null ? (
        <section aria-labelledby="releases">
          <Heading level={2} id="releases" anchorLabel={t.anchorLabel}>
            {t.releases.heading}
          </Heading>
          <P className="text-muted-foreground">{rich(t.releases.empty)}</P>
        </section>
      ) : (
        <div lang="en">
          <Markdown
            source={source.released}
            headingId={(text, depth, parent) => {
              const version = /^(\d+\.\d+\.\d+\S*)/.exec(text)?.[1];
              if (depth === 2 && version !== undefined) return versionId(version);
              return `${parent ?? "release"}-${text.toLowerCase().replace(/\s+/g, "-")}`;
            }}
          />
        </div>
      )}
    </main>
  );
}
