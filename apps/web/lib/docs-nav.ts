import path from "node:path";
import {
  docsPaths,
  extractHeadings,
  groupDocs,
  loadDocs,
  type DocHeading,
  type DocSource,
} from "@/lib/docs-source.mjs";

/**
 * The docs nav is derived from the frontmatter of `content/docs/*.mdx`
 * (`title`, `description`, `order`, optional `group`). Add a page by adding a file.
 * Server-only: reads the content directory (at build time for the static pages).
 */
export type DocsNavItem = {
  slug: string;
  title: string;
  description: string;
  order: number;
  group?: string;
};

export type DocsNavGroup = {
  /** `null` for pages without a `group`; they come first. */
  group: string | null;
  items: DocsNavItem[];
};

export type DocsPage = DocsNavItem & {
  headings: DocHeading[];
  prev?: DocsNavItem;
  next?: DocsNavItem;
};

let cache: DocSource[] | undefined;

function docs(): DocSource[] {
  // Re-read in development so new or edited pages show up without a restart.
  if (cache === undefined || process.env.NODE_ENV === "development") {
    cache = loadDocs(docsPaths(path.resolve(/*turbopackIgnore: true*/ process.cwd())).contentDir);
  }
  return cache;
}

function toNavItem({ slug, title, description, order, group }: DocSource): DocsNavItem {
  return { slug, title, description, order, ...(group === undefined ? {} : { group }) };
}

export function getDocsNavGroups(): DocsNavGroup[] {
  return groupDocs(docs()).map(({ group, items }) => ({ group, items: items.map(toNavItem) }));
}

/** Pages in reading order (sidebar order). */
export function getDocsNav(): DocsNavItem[] {
  return getDocsNavGroups().flatMap((group) => group.items);
}

export function findDocsNavItem(slug: string): DocsNavItem | undefined {
  return getDocsNav().find((item) => item.slug === slug);
}

export function getDocsPage(slug: string): DocsPage | undefined {
  const nav = getDocsNav();
  const index = nav.findIndex((item) => item.slug === slug);
  const item = nav[index];
  const doc = docs().find((source) => source.slug === slug);
  if (item === undefined || doc === undefined) return undefined;
  return {
    ...item,
    headings: extractHeadings(doc.body),
    prev: nav[index - 1],
    next: nav[index + 1],
  };
}
