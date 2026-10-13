import Link from "next/link";
import { notFound } from "next/navigation";
import { buildWhatsAppLink } from "@quami/sendo";
import { SendoChatBubble } from "@/components/sendo/widgets/chat-bubble";
import { LinksScreen } from "@/components/sendo/widgets/links-screen";
import { SOURCE_PATTERN } from "@/components/sendo/widgets/types";
import { WIDGETS_FIXTURES, widgetsFixture, type WidgetsFixtureKey } from "@/fixtures/widgets";
import { createFixtureLink, listFixtureSources } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enlaces · break-ui" };

/**
 * `break-ui` for the sendo-widgets links screen (dev only): the real `LinksScreen` fed with the
 * datasets in `fixtures/widgets/`, switched with `?data=demo|worst|empty|one`.
 */
export default async function DevLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { key, fixture } = widgetsFixture((await searchParams).data);
  const first = fixture.numbers.find((number) => number.isDefault) ?? fixture.numbers[0];
  if (first === undefined) notFound();
  const initialDraft = { account: first.id, ...fixture.draft };
  const initialLink = SOURCE_PATTERN.test(initialDraft.source)
    ? buildWhatsAppLink({
        phone: first.displayPhone,
        text: initialDraft.text,
        source: initialDraft.source,
      })
    : null;

  return (
    <main className="min-h-dvh bg-muted/30 pb-20">
      <LinksScreen
        key={key}
        numbers={fixture.numbers}
        sources={fixture.sources}
        initialDraft={initialDraft}
        initialLink={initialLink}
        actions={{
          createLink: createFixtureLink.bind(null, key),
          listSources: listFixtureSources.bind(null, key),
        }}
      />
      <SendoChatBubble phone={first.displayPhone} text={fixture.draft.text} source="web" />
      <nav
        aria-label="Datos de prueba"
        className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-full bg-neutral-200 p-1 font-sans text-xs shadow-sm"
      >
        {(Object.keys(WIDGETS_FIXTURES) as WidgetsFixtureKey[]).map((option) => (
          <Link
            key={option}
            href={`/dev/links?data=${option}`}
            aria-current={option === key ? "page" : undefined}
            className={
              option === key
                ? "rounded-full bg-white px-3 py-1 text-neutral-900 shadow-sm"
                : "rounded-full px-3 py-1 text-neutral-600 hover:text-neutral-900"
            }
          >
            {WIDGETS_FIXTURES[option].label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
