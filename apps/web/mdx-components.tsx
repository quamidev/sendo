import type { MDXComponents } from "mdx/types";
import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { Callout } from "@/components/docs/callout";
import { CodeBlock, Sample } from "@/components/docs/code-block";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P, ScreenshotPlaceholder, Step } from "@/components/docs/prose";

/**
 * Markdown in `content/docs/*.mdx` renders with the docs components. Pages may also use
 * these JSX components without importing them (on their own lines, see
 * `lib/docs-source.mjs` for how each one is converted for llms.txt): `Sample`, `Callout`,
 * `Step`, `ScreenshotPlaceholder`.
 */

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A fenced block: the language (or `title="…"` in the fence meta) labels the header. */
function Pre({ children }: ComponentProps<"pre">) {
  const code = isValidElement<{ className?: string; "data-title"?: string; children?: ReactNode }>(
    children,
  )
    ? children.props
    : undefined;
  const language = /language-(\S+)/.exec(code?.className ?? "")?.[1];
  return (
    <CodeBlock
      code={textOf(code?.children ?? children).replace(/\n$/, "")}
      title={code?.["data-title"] ?? language}
    />
  );
}

const components = {
  h2: ({ id, children }: ComponentProps<"h2">) => (
    <Heading level={2} id={id ?? ""}>
      {children}
    </Heading>
  ),
  h3: ({ id, children }: ComponentProps<"h3">) => (
    <Heading level={3} id={id ?? ""}>
      {children}
    </Heading>
  ),
  p: ({ children }: ComponentProps<"p">) => <P>{children}</P>,
  a: ({ href, children }: ComponentProps<"a">) => <A href={href ?? "#"}>{children}</A>,
  ul: ({ children }: ComponentProps<"ul">) => <List>{children}</List>,
  ol: ({ children }: ComponentProps<"ol">) => <List ordered>{children}</List>,
  code: ({ children }: ComponentProps<"code">) => <C>{children}</C>,
  pre: Pre,
  table: ({ children }: ComponentProps<"table">) => (
    <div className="my-5 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: ComponentProps<"thead">) => (
    <thead className="bg-muted/50">{children}</thead>
  ),
  tr: ({ children }: ComponentProps<"tr">) => (
    <tr className="align-top [tbody>&]:border-t">{children}</tr>
  ),
  th: ({ children }: ComponentProps<"th">) => (
    <th scope="col" className="px-3 py-2 align-bottom font-medium whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }: ComponentProps<"td">) => (
    <td className="px-3 py-2 leading-relaxed [&_code]:whitespace-nowrap">{children}</td>
  ),
  Sample,
  Callout,
  Step,
  ScreenshotPlaceholder,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
