import Link from "next/link";
import { notFound } from "next/navigation";
import { RulesScreen } from "@/components/sendo/workflows/rules-screen";
import {
  FIXTURE_USER_ID,
  WORKFLOWS_FIXTURES,
  workflowsFixture,
  type WorkflowsFixtureKey,
} from "@/fixtures/workflows";
import {
  deleteFixtureRule,
  listFixtureRules,
  reorderFixtureRules,
  resetFixtureRules,
  saveFixtureRule,
  toggleFixtureRule,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reglas · break-ui" };

/**
 * `break-ui` for the sendo-workflows rules screen (dev only): the real `RulesScreen` fed with the
 * datasets in `fixtures/workflows/`, switched with `?data=demo|worst|empty|invalid`. Edits stay in
 * this server process; `&reset` starts the dataset over.
 */
export default async function DevRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; reset?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const { key, fixture } = workflowsFixture(params.data);
  if (params.reset !== undefined) await resetFixtureRules(key);
  const current = await listFixtureRules(key);
  if (!current.ok) notFound();

  return (
    <main className="min-h-dvh bg-muted/30 pb-20">
      <RulesScreen
        key={key}
        initialRules={current.data}
        numbers={fixture.numbers}
        currentUserId={FIXTURE_USER_ID}
        actions={{
          listRules: listFixtureRules.bind(null, key),
          saveRule: saveFixtureRule.bind(null, key),
          toggleRule: toggleFixtureRule.bind(null, key),
          reorderRules: reorderFixtureRules.bind(null, key),
          deleteRule: deleteFixtureRule.bind(null, key),
        }}
      />
      <nav
        aria-label="Datos de prueba"
        className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 gap-1 rounded-full bg-neutral-200 p-1 font-sans text-xs shadow-sm"
      >
        {(Object.keys(WORKFLOWS_FIXTURES) as WorkflowsFixtureKey[]).map((option) => (
          <Link
            key={option}
            href={`/dev/rules?data=${option}&reset`}
            aria-current={option === key ? "page" : undefined}
            className={
              option === key
                ? "rounded-full bg-white px-3 py-1 text-neutral-900 shadow-sm"
                : "rounded-full px-3 py-1 text-neutral-600 hover:text-neutral-900"
            }
          >
            {WORKFLOWS_FIXTURES[option].label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
