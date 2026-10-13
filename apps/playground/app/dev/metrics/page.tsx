import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricsScreen } from "@/components/sendo/metrics/metrics-screen";
import {
  FIXTURE_TODAY,
  METRICS_FIXTURES,
  fixtureReport,
  initialFilters,
  metricsFixture,
  type MetricsFixtureKey,
} from "@/fixtures/metrics";
import { sendoLocale } from "@/lib/sendo-ui";
import { loadFixtureMetrics } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Metrics · break-ui" };

/**
 * `break-ui` for the metrics screen (dev only): the real `MetricsScreen` fed with the
 * datasets in `fixtures/metrics/`, switched with
 * `?data=demo|worst|empty|one|ninety|heavy|supervisor`.
 */
export default async function DevMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { key, fixture } = metricsFixture((await searchParams).data);

  return (
    <main className="min-h-dvh bg-muted/30 pb-20">
      <MetricsScreen
        key={key}
        locale={sendoLocale}
        initialReport={fixtureReport(key, initialFilters(fixture))}
        numbers={fixture.numbers}
        tags={fixture.tags}
        today={FIXTURE_TODAY}
        actions={{ loadMetrics: loadFixtureMetrics.bind(null, key) }}
      />
      <nav
        aria-label="Test data"
        className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 gap-1 overflow-x-auto rounded-full bg-neutral-200 p-1 font-sans text-xs shadow-sm"
      >
        {(Object.keys(METRICS_FIXTURES) as MetricsFixtureKey[]).map((option) => (
          <Link
            key={option}
            href={`/dev/metrics?data=${option}`}
            aria-current={option === key ? "page" : undefined}
            className={
              option === key
                ? "shrink-0 rounded-full bg-white px-3 py-1 text-neutral-900 shadow-sm"
                : "shrink-0 rounded-full px-3 py-1 text-neutral-600 hover:text-neutral-900"
            }
          >
            {METRICS_FIXTURES[option].label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
