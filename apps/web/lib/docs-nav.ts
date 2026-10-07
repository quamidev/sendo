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
    description: "Customizing strings, motion tokens and server-action auth.",
  },
  {
    slug: "security",
    title: "Security",
    description: "Private storage, signed URLs and authorization inside tools.",
  },
  {
    slug: "retention",
    title: "Retention",
    description: "Pruning messages and media on a schedule.",
  },
  {
    slug: "multi-number",
    title: "Multi-number",
    description: "Several numbers and tenants on one deployment.",
  },
  { slug: "cli", title: "CLI", description: "wa-li doctor and wa-li accounts add." },
  { slug: "roadmap", title: "Roadmap", description: "What V2 and V3 add, interfaces only." },
] as const satisfies readonly DocsNavItem[];

export type DocsSlug = (typeof docsNav)[number]["slug"];

export function findDocsNavItem(slug: string): DocsNavItem | undefined {
  return docsNav.find((item) => item.slug === slug);
}
