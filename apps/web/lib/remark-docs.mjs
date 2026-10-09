// remark plugin for content/docs (registered by path in next.config.ts, so it must stay
// plain ESM with serializable options for Turbopack):
// - `## Title [#custom-id]` sets the heading id (otherwise the id is the slugified text);
// - a code fence's `title="…"` meta becomes `data-title` on the `<code>` element.
import { headingId } from "./docs-source.mjs";

const ID_SUFFIX_RE = /\s*\[#[a-z0-9][a-z0-9-]*\]\s*$/;

function toText(node) {
  if (typeof node.value === "string") return node.value;
  return Array.isArray(node.children) ? node.children.map(toText).join("") : "";
}

function walk(node, fn) {
  fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, fn);
}

function setProperty(node, key, value) {
  node.data = node.data ?? {};
  node.data.hProperties = { ...node.data.hProperties, [key]: value };
}

export default function remarkDocs() {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type === "heading") {
        const { id } = headingId(toText(node).trim());
        const last = node.children?.[node.children.length - 1];
        if (last?.type === "text") last.value = last.value.replace(ID_SUFFIX_RE, "");
        setProperty(node, "id", id);
      } else if (node.type === "code" && typeof node.meta === "string") {
        const title = /(?:^|\s)title="([^"]*)"/.exec(node.meta);
        if (title) setProperty(node, "data-title", title[1]);
      }
    });
  };
}
