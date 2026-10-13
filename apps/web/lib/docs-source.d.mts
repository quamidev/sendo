export interface DocFrontmatter {
  title: string;
  description: string;
  order: number;
  group?: string;
}

export interface DocSource extends DocFrontmatter {
  slug: string;
  /** The MDX after the frontmatter. */
  body: string;
}

export interface DocHeading {
  level: number;
  id: string;
  title: string;
}

export interface DocsArtifacts {
  slugs: string[];
  llmsTxt: string;
  llmsFullTxt: string;
  docsJson: string;
}

export const SITE_URL: string;
export function docsPaths(webRoot: string): {
  contentDir: string;
  samplesDir: string;
  repoRoot: string;
};
export function parseDoc(
  source: string,
  file?: string,
): { frontmatter: DocFrontmatter; body: string };
export function loadDocs(contentDir: string): DocSource[];
export function groupDocs<T extends { group?: string }>(
  docs: T[],
): { group: string | null; items: T[] }[];
export function slugify(text: string): string;
export function headingId(rawText: string): { text: string; id: string };
export function extractHeadings(body: string): DocHeading[];
export function extractRegion(source: string, region?: string): string;
export function displaySample(source: string): string;
export function readSampleFrom(samplesDir: string, file: string, region?: string): string;
export function readRepoFileFrom(repoRoot: string, relativePath: string): string;
export function sampleLanguage(file: string): string;
export function mdxToMarkdown(
  body: string,
  options: { samplesDir: string; repoRoot: string; file?: string },
): string;
export function docUrl(slug: string): string;
export function buildDocsArtifacts(webRoot: string): DocsArtifacts;
