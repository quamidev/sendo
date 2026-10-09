/**
 * BM25 search over the docs bundled in `docs/docs.json` (written by `apps/web/scripts/build-llms.mjs`).
 * Pages are split into sections at `##` / `###` headings so a hit points at an anchor.
 */

export interface DocHeading {
  level: number;
  id: string;
  title: string;
}

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  group?: string;
  url: string;
  headings?: DocHeading[];
  /** Markdown with the code samples inlined. */
  body: string;
}

export interface DocSection {
  slug: string;
  pageTitle: string;
  /** `null` for the text before the first heading. */
  heading: string | null;
  anchor: string | null;
  url: string;
  text: string;
}

export interface DocsSearchHit {
  section: DocSection;
  score: number;
  snippet: string;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be by can do does for from has have how i if in into is it its of on or " +
    "that the their then there these this to use used using what when where which with you your " +
    "al con como de del el en es la las lo los para por que se sin su sus un una y o"
  ).split(" "),
);

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Lowercase, accent-folded, stop words removed, naive plural stemming. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .map(stem);
}

function stripInline(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

/** Splits a page at level 2–3 headings outside code fences. */
export function splitSections(page: DocPage): DocSection[] {
  const sections: DocSection[] = [];
  const unused = [...(page.headings ?? [])];
  let current: DocSection = {
    slug: page.slug,
    pageTitle: page.title,
    heading: null,
    anchor: null,
    url: page.url,
    text: "",
  };
  const lines: string[] = [];
  const flush = () => {
    current.text = lines.join("\n").trim();
    if (current.text !== "" || current.heading !== null) sections.push(current);
    lines.length = 0;
  };
  let inFence = false;
  for (const line of page.body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match === null) {
      lines.push(line);
      continue;
    }
    flush();
    const title = stripInline(match[2] ?? "");
    const index = unused.findIndex((h) => h.title === title);
    const id = index === -1 ? null : (unused.splice(index, 1)[0]?.id ?? null);
    current = {
      slug: page.slug,
      pageTitle: page.title,
      heading: title,
      anchor: id,
      url: id === null ? page.url : `${page.url}#${id}`,
      text: "",
    };
  }
  flush();
  return sections;
}

function snippetOf(text: string, terms: ReadonlySet<string>, max = 320): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const words = flat.split(" ");
  const first = words.findIndex((word) => tokenize(word).some((t) => terms.has(t)));
  const start = Math.max(0, first - 12);
  let snippet = words.slice(start).join(" ");
  if (snippet.length > max) snippet = `${snippet.slice(0, max).replace(/\s+\S*$/, "")} …`;
  return start > 0 ? `… ${snippet}` : snippet;
}

const K1 = 1.2;
const B = 0.75;
/** Page title and section heading count this many extra times. */
const TITLE_BOOST = 3;

export interface DocsIndex {
  sections: readonly DocSection[];
  search(query: string, limit?: number): DocsSearchHit[];
}

export function createDocsIndex(pages: readonly DocPage[]): DocsIndex {
  const sections = pages.flatMap(splitSections);
  const docs = sections.map((section) => {
    const titleTokens = tokenize(`${section.pageTitle} ${section.heading ?? ""}`);
    const tokens = [
      ...tokenize(section.text),
      ...Array.from({ length: TITLE_BOOST }, () => titleTokens).flat(),
    ];
    const tf = new Map<string, number>();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    return { length: tokens.length, tf };
  });
  const df = new Map<string, number>();
  for (const doc of docs)
    for (const token of doc.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(docs.length, 1);
  const n = docs.length;

  return {
    sections,
    search(query, limit = 5) {
      const terms = [...new Set(tokenize(query))];
      if (terms.length === 0) return [];
      const scored: DocsSearchHit[] = [];
      docs.forEach((doc, i) => {
        let score = 0;
        for (const term of terms) {
          const freq = doc.tf.get(term) ?? 0;
          if (freq === 0) continue;
          const docFreq = df.get(term) ?? 0;
          const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
          score += (idf * (freq * (K1 + 1))) / (freq + K1 * (1 - B + (B * doc.length) / avgLength));
        }
        const section = sections[i];
        if (score > 0 && section !== undefined) {
          scored.push({ section, score, snippet: snippetOf(section.text, new Set(terms)) });
        }
      });
      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };
}
