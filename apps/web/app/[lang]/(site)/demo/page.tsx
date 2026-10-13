import type { Metadata } from "next";
import Link from "next/link";
import { DemoExperience } from "@/components/demo/demo-experience";
import { alternatesFor, getDictionary } from "@/lib/i18n";
import { pageLang } from "@/lib/i18n/page-lang";
import { interpolate, rich } from "@/lib/i18n/rich";
import {
  DEMO_IP_DAILY_LIMIT,
  DEMO_MAX_OUTPUT_TOKENS,
  DEMO_SESSION_LIMIT,
} from "@/lib/demo/protocol";

export async function generateMetadata({ params }: PageProps<"/[lang]/demo">): Promise<Metadata> {
  const lang = await pageLang(params);
  return { ...getDictionary(lang).demo.meta, alternates: alternatesFor("/demo", lang) };
}

export default async function DemoPage({ params }: PageProps<"/[lang]/demo">) {
  const t = getDictionary(await pageLang(params)).demo;
  const intro = interpolate(t.intro, {
    sessionLimit: DEMO_SESSION_LIMIT,
    ipLimit: DEMO_IP_DAILY_LIMIT,
    maxTokens: DEMO_MAX_OUTPUT_TOKENS,
  });
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:h-[calc(100dvh-3.5rem)] md:px-6 md:py-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
        <p className="max-w-4xl text-sm text-pretty text-muted-foreground">
          {rich(intro)}{" "}
          <Link
            href="/docs/quickstart"
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t.installLink}
          </Link>
          .
        </p>
      </div>
      <DemoExperience className="min-h-0 flex-1" chatClassName="md:w-[360px]" />
    </main>
  );
}
