import Link from "next/link";
import { notFound } from "next/navigation";
import { BroadcastsScreen } from "@/components/sendo/broadcasts/broadcasts-screen";
import {
  BROADCASTS_FIXTURES,
  broadcastsFixture,
  type BroadcastsFixtureKey,
} from "@/fixtures/broadcasts";
import {
  cancelFixtureBroadcast,
  createFixtureBroadcast,
  getFixtureBroadcast,
  listFixtureAudiences,
  listFixtureBroadcasts,
  listFixtureRecipients,
  listFixtureTemplates,
  previewFixtureBroadcast,
  resetFixtureBroadcasts,
} from "./actions";
import { sendoLocale } from "@/lib/sendo-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broadcasts · break-ui" };

/**
 * `break-ui` for the broadcasts screen (dev only): the real `BroadcastsScreen` fed with the
 * datasets in `fixtures/broadcasts/`, switched with
 * `?data=demo|zero|huge|failed|paused|empty`. `&reset` starts the dataset over.
 */
export default async function DevBroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; reset?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const { key, fixture } = broadcastsFixture(params.data);
  if (params.reset !== undefined) await resetFixtureBroadcasts(key);
  const first = await listFixtureBroadcasts(key);
  if (!first.ok) notFound();
  const opened = fixture.open === undefined ? null : await getFixtureBroadcast(key, fixture.open);

  return (
    <main className="min-h-dvh bg-muted/30 pb-20">
      <BroadcastsScreen
        key={key}
        locale={sendoLocale}
        numbers={fixture.numbers}
        initialBroadcasts={first.data}
        initialBroadcast={opened?.ok === true ? opened.data : null}
        initialCompose={fixture.compose === true}
        syncUrl={false}
        pollMs={2000}
        actions={{
          listBroadcasts: listFixtureBroadcasts.bind(null, key),
          getBroadcast: getFixtureBroadcast.bind(null, key),
          listRecipients: listFixtureRecipients.bind(null, key),
          listTemplates: listFixtureTemplates.bind(null, key),
          listAudiences: listFixtureAudiences.bind(null, key),
          previewBroadcast: previewFixtureBroadcast.bind(null, key),
          createBroadcast: createFixtureBroadcast.bind(null, key),
          cancelBroadcast: cancelFixtureBroadcast.bind(null, key),
        }}
      />
      <nav
        aria-label="Datos de prueba"
        className="fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full bg-neutral-200 p-1 font-sans text-xs shadow-sm"
      >
        {(Object.keys(BROADCASTS_FIXTURES) as BroadcastsFixtureKey[]).map((option) => (
          <Link
            key={option}
            href={`/dev/broadcasts?data=${option}&reset`}
            aria-current={option === key ? "page" : undefined}
            className={
              option === key
                ? "rounded-full bg-white px-3 py-1 whitespace-nowrap text-neutral-900 shadow-sm"
                : "rounded-full px-3 py-1 whitespace-nowrap text-neutral-600 hover:text-neutral-900"
            }
          >
            {BROADCASTS_FIXTURES[option].label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
