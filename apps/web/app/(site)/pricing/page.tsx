import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Callout } from "@/components/docs/callout";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P } from "@/components/docs/prose";
import { BILLING_CAVEAT, CONNECT_PRICE } from "./pricing-copy";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Sendo is free and open source. Sendo Connect, Quami as your Meta Tech Provider, is the only paid piece. Meta bills messages to the WhatsApp Business account owner.",
};

interface Plan {
  id: string;
  name: string;
  price: string;
  priceNote: string;
  summary: string;
  points: ReactNode[];
  cta: { href: string; label: string };
}

const plans: Plan[] = [
  {
    id: "own-app",
    name: "Your own Meta app",
    price: "Free",
    priceNote: "MIT license",
    summary: "You are your own Meta Tech Provider. Everything runs on your servers.",
    points: [
      "The package, the migrations and every registry component",
      "Webhooks go straight from Meta to your app",
      "Meta's business verification and app review are on you (days to weeks)",
      "The right choice for apps with sensitive data",
    ],
    cta: { href: "/docs/meta-setup", label: "Meta setup guide" },
  },
  {
    id: "connect",
    name: "Sendo Connect",
    price: CONNECT_PRICE,
    priceNote: "per connected number, per month",
    summary: "Quami is the Tech Provider, so your customers can connect numbers the same day.",
    points: [
      <>
        Configuration only: add <C>connect</C> to <C>createSendo</C>; the code is identical
      </>,
      "Embedded Signup through Quami's Meta app, no paperwork for you",
      "Webhooks relayed through Quami, signed with your own secret",
      "Sending and your data stay between your server and Meta",
    ],
    cta: { href: "/docs/sendo-connect", label: "How Connect works" },
  },
];

/** `/pricing` (AC-CN-5). Static; every claim mirrors `content/docs/sendo-connect.mdx`. */
export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Pricing</h1>
      <p className="mt-3 max-w-2xl text-base text-pretty text-muted-foreground">
        Sendo is free and open source. The only paid piece is <strong>Sendo Connect</strong>, for
        teams that would rather not do Meta&rsquo;s paperwork. Quami never bills you for messages.
      </p>

      <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Plans">
        {plans.map((plan) => (
          <li
            key={plan.id}
            id={plan.id}
            aria-labelledby={`${plan.id}-name`}
            className="flex scroll-mt-24 flex-col gap-4 rounded-lg border p-5"
          >
            <div>
              <h2 id={`${plan.id}-name`} className="text-base font-semibold">
                {plan.name}
              </h2>
              <p className="mt-2 text-2xl font-semibold tracking-tight">{plan.price}</p>
              <p className="text-xs text-muted-foreground">{plan.priceNote}</p>
              <p className="mt-3 text-sm text-pretty text-muted-foreground">{plan.summary}</p>
            </div>
            <ul className="flex flex-col gap-2 text-sm">
              {plan.points.map((point, index) => (
                <li key={index} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground"
                  />
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto text-sm">
              <A href={plan.cta.href}>{plan.cta.label}</A>
            </p>
          </li>
        ))}
      </ul>

      <Heading level={2} id="who-pays-meta">
        Who pays Meta
      </Heading>
      <P>
        Meta bills the WhatsApp messages{" "}
        <strong>directly to the owner of the WhatsApp Business account</strong> (the building, the
        clinic, your customer), per delivered message. Sendo moves no money, and Quami bills only
        for Connect, never for messages. Rates depend on the country and the template category; we
        link to <A href="/docs/meta-pricing">Meta&rsquo;s official pricing</A> instead of copying
        it.
      </P>
      <Callout variant="warning" title="Before a customer connects a number">
        <p lang="es">&ldquo;{BILLING_CAVEAT}&rdquo;</p>
        <p>
          As a Tech Provider, Quami has no credit line with Meta: each customer adds their own card
          in Meta Business Settings. Until they do, sends fail with error 131042, and Sendo shows
          &ldquo;falta método de pago&rdquo; on the number (<C>billingReady</C>).
        </p>
      </Callout>

      <Heading level={2} id="privacy">
        What passes through Quami
      </Heading>
      <List>
        <li>
          With Connect, webhooks <strong>pass through Quami in transit</strong>: the relay receives
          them from Meta and forwards them to your app, signed with your secret.
        </li>
        <li>
          Message bodies are <strong>never stored</strong> or logged by Connect. Only delivery
          metadata (ids, timestamps, status codes) is kept, for 7 days.
        </li>
        <li>
          The number&rsquo;s access token is returned to your server once and never stored by
          Connect. Messages and contacts live in your database.
        </li>
      </List>

      <Heading level={2} id="sensitive-data">
        Apps with sensitive data
      </Heading>
      <P>
        If your app handles sensitive data, for example clinical conversations in an app like MIDI
        Med, <strong>use your own Meta app</strong> so that no third party sits in the message path.
        It is free and documented just as well: start with <A href="/docs/meta-setup">Meta setup</A>{" "}
        and <A href="/docs/embedded-signup">Embedded Signup</A>.
      </P>
    </main>
  );
}
