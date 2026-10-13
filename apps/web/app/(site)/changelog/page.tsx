import { SCHEMA_MIGRATIONS } from "@quami/sendo";
import type { Metadata } from "next";
import { Heading } from "@/components/docs/heading";
import { A, C, P } from "@/components/docs/prose";
import { Markdown } from "@/components/site/markdown";
import { loadChangelog, pendingMarkdown, sectionMentioning, versionId } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Every @quami/sendo release, the next one, and the schema migrations each version needs.",
};

/**
 * Rendered at build time from `packages/sendo/CHANGELOG.md` and the pending `.changeset/*.md`.
 * `#schema-vN` anchors are what `sendo doctor` and the schema-drift warning link to.
 */
export default function ChangelogPage() {
  const source = loadChangelog();
  const pending = source.pending.length > 0 ? pendingMarkdown(source.pending) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Changelog</h1>
      <p className="mt-3 text-base text-pretty text-muted-foreground">
        Releases of <C>@quami/sendo</C>. Registry items are copied into your app and don&rsquo;t
        update themselves, so read the notes before you upgrade and run the migrations below.
      </p>

      <Heading level={2} id="schema-versions">
        Schema versions
      </Heading>
      <P>
        <C>npx @quami/sendo doctor</C> compares your database with the package. When it reports
        drift, copy each missing file from the <C>schema</C> registry item (or re-run{" "}
        <C>npx shadcn add @sendo/schema</C>) into <C>supabase/migrations/</C> and run it, in order.
      </P>
      <div className="my-5 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Version
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Migration file
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Notes
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
                          ? "Next release"
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
          <Heading level={2} id="next-release">
            Next release
          </Heading>
          <P className="text-muted-foreground">
            Merged and waiting for the next <C>@quami/sendo</C> version.
          </P>
          <Markdown
            source={pending}
            headingId={(text) => `next-${text.toLowerCase().replace(/\s+/g, "-")}`}
          />
        </section>
      )}

      {source.released === null ? (
        <section aria-labelledby="releases">
          <Heading level={2} id="releases">
            Releases
          </Heading>
          <P className="text-muted-foreground">
            No release yet: <C>0.1.0</C> is the first public version. Its notes are under Next
            release until it is published.
          </P>
        </section>
      ) : (
        <Markdown
          source={source.released}
          headingId={(text, depth, parent) => {
            const version = /^(\d+\.\d+\.\d+\S*)/.exec(text)?.[1];
            if (depth === 2 && version !== undefined) return versionId(version);
            return `${parent ?? "release"}-${text.toLowerCase().replace(/\s+/g, "-")}`;
          }}
        />
      )}
    </main>
  );
}
