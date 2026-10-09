import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/site/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row md:gap-10 md:px-6 md:py-10">
      <aside className="border-b pb-3 md:sticky md:top-24 md:w-52 md:shrink-0 md:self-start md:border-b-0 md:pb-0">
        <DocsSidebar />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
