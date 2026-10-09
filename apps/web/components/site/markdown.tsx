import { toJsxRuntime, type Components } from "hast-util-to-jsx-runtime";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { slugify } from "@/lib/docs-source.mjs";
import { useMDXComponents } from "@/mdx-components";

type MdastRoot = ReturnType<typeof fromMarkdown>;
type MdastNode = MdastRoot["children"][number];

function plainText(node: MdastNode): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) return (node.children as MdastNode[]).map(plainText).join("");
  return "";
}

/**
 * Plain Markdown (GFM, no MDX: changelog entries may contain `<` or `{`) rendered with the docs
 * components. `##`/`###` get ids from `headingIds` (or a slug), unique within the page.
 */
export function Markdown({
  source,
  headingId = (text) => slugify(text),
}: {
  source: string;
  headingId?: (text: string, depth: 2 | 3, parent: string | null) => string;
}) {
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const used = new Set<string>();
  let parent: string | null = null;
  for (const node of tree.children) {
    if (node.type !== "heading" || (node.depth !== 2 && node.depth !== 3)) continue;
    const base: string = headingId(plainText(node), node.depth, parent) || "section";
    let id: string = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${String(n)}`;
    used.add(id);
    if (node.depth === 2) parent = id;
    node.data = { ...node.data, hProperties: { id } };
  }
  return toJsxRuntime(toHast(tree), {
    Fragment,
    jsx,
    jsxs,
    components: useMDXComponents() as Partial<Components>,
  });
}
