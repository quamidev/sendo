export type DocsNavItem = {
  slug: string;
  title: string;
  description: string;
};

export const docsNav = [
  {
    slug: "quickstart",
    title: "Quickstart",
    description: "From an empty Next.js + Supabase app to the first agent reply.",
  },
  {
    slug: "meta-setup",
    title: "Meta setup",
    description: "App, WhatsApp product, test number, system user token and webhook.",
  },
  {
    slug: "api-reference",
    title: "API reference",
    description: "Config, events, sending, templates, conversations, agents and adapters.",
  },
  {
    slug: "inbox",
    title: "Inbox",
    description: "Strings, motion tokens and server-action auth for the staff inbox.",
  },
  {
    slug: "security",
    title: "Security",
    description: "Sensitive data, private storage, signed URLs, tokens and authorization inside tools.",
  },
  {
    slug: "retention",
    title: "Retention",
    description: "Pruning sendo_events with pg_cron or a Vercel Cron route, and your own policy for messages and media.",
  },
  {
    slug: "multi-number",
    title: "Multi-number",
    description: "Several numbers and tenants on one deployment: routing, accounts and access.",
  },
  {
    slug: "cli",
    title: "CLI",
    description: "npx @quami/sendo doctor and accounts add: checks, flags and environment.",
  },
  {
    slug: "roadmap",
    title: "Roadmap",
    description: "What V2 and V3 add. Interfaces only: none of this ships in V1.",
  },
] as const satisfies readonly DocsNavItem[];

export type DocsSlug = (typeof docsNav)[number]["slug"];

export function findDocsNavItem(slug: string): DocsNavItem | undefined {
  return docsNav.find((item) => item.slug === slug);
}
