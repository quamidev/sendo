import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const pillars = [
  {
    title: "npm package",
    body: "@quami/sendo handles webhook verification, parsing, sending, the 24-hour window, agents and inbox operations.",
  },
  {
    title: "shadcn registry",
    body: "Install the webhook route, the Supabase migration and the inbox UI into your app, then own the code.",
  },
  {
    title: "Your database",
    body: "Messages and media stay in your Supabase project, behind your RLS and your retention policy.",
  },
];

const installSnippet = `"registries": {
  "@sendo": {
    "url": "https://registry.sendo.dev/r/{name}.json",
    "headers": { "Authorization": "Bearer \${SENDO_REGISTRY_TOKEN}" }
  }
}`;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
      <section className="max-w-2xl">
        <p className="font-mono text-xs text-muted-foreground">@quami/sendo</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance md:text-5xl">
          WhatsApp for Quami apps.
        </h1>
        <p className="mt-4 text-base text-pretty text-muted-foreground md:text-lg">
          A typed WhatsApp Cloud API library with AI agents, plus a private shadcn registry for the
          webhook, the schema and a staff inbox.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild className="active:bg-primary/80">
            <Link href="/docs/quickstart">
              Quickstart
              <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild variant="outline" className="active:bg-accent/70">
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
      </section>

      <section className="mt-16 grid gap-4 md:mt-24 md:grid-cols-3">
        {pillars.map((pillar) => (
          <div key={pillar.title} className="rounded-lg border bg-card p-5 text-card-foreground">
            <h2 className="text-sm font-medium">{pillar.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{pillar.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-16 md:mt-24">
        <h2 className="text-sm font-medium">Add the registry to components.json</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed">
          <code>{installSnippet}</code>
        </pre>
        <p className="mt-3 text-sm text-muted-foreground">
          Registry items require a token. Ask the Quami team for a{" "}
          <code className="font-mono">SENDO_REGISTRY_TOKEN</code>.
        </p>
      </section>
    </main>
  );
}
