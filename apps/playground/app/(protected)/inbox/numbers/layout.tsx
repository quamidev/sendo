import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { isNumbersFixture, NUMBERS_FIXTURE_COOKIE, type NumbersFixture } from "@/fixtures/numbers";
import { playgroundMode } from "@/lib/playground-env";

// Playground only (not part of the numbers item): the break-ui dataset switch, shown in
// fixtures mode at the bottom of the numbers screen. Switching goes through /dev/numbers.

const LABELS: Record<NumbersFixture, string> = {
  demo: "Demo (1)",
  worst: "Worst case (6)",
  empty: "Empty",
  agent: "Agent role",
};

export default async function NumbersPlaygroundLayout({ children }: { children: ReactNode }) {
  if (playgroundMode() !== "fixtures") return children;
  const current = (await cookies()).get(NUMBERS_FIXTURE_COOKIE)?.value;
  const active: NumbersFixture = isNumbersFixture(current) ? current : "demo";

  return (
    <>
      {children}
      <nav
        aria-label="Test data"
        className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 gap-0.5 whitespace-nowrap rounded-full bg-zinc-200 p-0.5 font-sans text-xs shadow-sm dark:bg-zinc-800"
      >
        {(Object.keys(LABELS) as NumbersFixture[]).map((key) => (
          <a
            key={key}
            href={`/dev/numbers?data=${key}`}
            aria-current={key === active ? "true" : undefined}
            className={
              key === active
                ? "rounded-full bg-white px-3 py-1 text-zinc-900 shadow-xs dark:bg-zinc-950 dark:text-zinc-100"
                : "rounded-full px-3 py-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }
          >
            {LABELS[key]}
          </a>
        ))}
      </nav>
    </>
  );
}
