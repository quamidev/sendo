import type { Metadata } from "next";
import Link from "next/link";
import { DemoExperience } from "@/components/demo/demo-experience";
import {
  DEMO_IP_DAILY_LIMIT,
  DEMO_MAX_OUTPUT_TOKENS,
  DEMO_SESSION_LIMIT,
} from "@/lib/demo/protocol";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Write to an AI agent on a demo WhatsApp number and watch the same conversation in the real Sendo inbox.",
};

export default function DemoPage() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:h-[calc(100dvh-3.5rem)] md:px-6 md:py-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Live demo</h1>
        <p className="max-w-4xl text-sm text-pretty text-muted-foreground">
          The chat is a resident of a demo building writing on WhatsApp; an agent with a real model
          answers and can check the apartment&rsquo;s balance in the app or hand you to a person.
          The inbox is the real <code className="font-mono text-[13px]">sendo-inbox</code>: open
          your conversation and reply from it. Nothing is stored: your browser keeps the
          conversation and every message rebuilds it on a fresh in-memory Sendo with a fake Meta.
          Limits: {DEMO_SESSION_LIMIT} messages per session, {DEMO_IP_DAILY_LIMIT} per network per
          day, {DEMO_MAX_OUTPUT_TOKENS} output tokens per reply.{" "}
          <Link
            href="/docs/quickstart"
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Install it in your app
          </Link>
          .
        </p>
      </div>
      <DemoExperience className="min-h-0 flex-1" chatClassName="md:w-[360px]" />
    </main>
  );
}
