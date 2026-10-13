import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/docs/copy-button";
import { DemoExperience } from "@/components/demo/demo-experience";
import { Button } from "@/components/ui/button";

const commands = [
  { command: "pnpm add @quami/sendo ai zod", note: "The package: webhook, sending, agents, inbox" },
  {
    command: "npx shadcn add @sendo/webhook @sendo/schema",
    note: "Your code: the webhook route and the schema, from the @sendo registry",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 md:px-6 xl:h-[calc(100dvh-3.5rem)] xl:min-h-[760px] xl:py-6">
      <section className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">
            @quami/sendo · open source (MIT) · WhatsApp Cloud API · Next.js
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance md:text-[2.5rem] md:leading-[1.1]">
            The conversation inbox that lives inside your app.
          </h1>
        </div>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
          <div className="flex flex-col gap-3">
            <p className="text-base text-pretty text-muted-foreground">
              Sendo does the job of Respond.io or Kapso, WhatsApp with AI agents and people taking
              turns, but you install it as your own code. Messages live in your database, every
              contact is a user your app already has, and the inbox is one more screen of your app.
            </p>
            <p className="text-[13px] text-pretty text-muted-foreground">
              <span className="font-medium text-foreground">
                Why not an unofficial WhatsApp API?
              </span>{" "}
              They automate WhatsApp Web against Meta&rsquo;s terms, and numbers get banned. They
              also can&rsquo;t send approved templates, so they can&rsquo;t start a conversation
              outside the 24-hour window, and reminders and property management depend on exactly
              that.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2" aria-label="Install">
              {commands.map(({ command, note }) => (
                <li
                  key={command}
                  className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3"
                >
                  <div className="min-w-0 flex-1">
                    <code className="block truncate font-mono text-[13px]" title={command}>
                      <span aria-hidden className="text-muted-foreground select-none">
                        ${" "}
                      </span>
                      {command}
                    </code>
                    <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
                  </div>
                  <CopyButton value={command} />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <Button asChild size="sm" className="active:bg-primary/80">
                <Link href="/docs/quickstart">
                  Quickstart
                  <ArrowRightIcon />
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="active:bg-accent/70">
                <Link href="/docs">Docs</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="active:bg-accent/70">
                <Link href="/demo">Full-screen demo</Link>
              </Button>
              <p className="basis-full text-xs text-pretty text-muted-foreground">
                With a Meta app ready, the first agent reply on your own number takes under an hour.
                From zero, Meta&rsquo;s business verification and review can take days or weeks.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="demo-heading" className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 id="demo-heading" className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">Live demo.</span> Write as a resident in the
          chat. Next to it is the real <code className="font-mono">inbox</code> on fixtures and the
          memory adapter, showing your conversation as the team sees it.
        </h2>
        <DemoExperience className="min-h-0 flex-1 md:h-[560px] xl:h-auto" />
      </section>
    </main>
  );
}
