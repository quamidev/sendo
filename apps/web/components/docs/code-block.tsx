import { CopyButton } from "@/components/docs/copy-button";
import { readRepoFile, readSample } from "@/components/docs/read-sample";
import { cn } from "@/lib/utils";

export interface CodeBlockProps {
  code: string;
  /** Shown in the header: a file path or a language label. */
  title?: string;
  className?: string;
}

export function CodeBlock({ code, title, className }: CodeBlockProps) {
  return (
    <figure
      className={cn("group/code my-5 overflow-hidden rounded-lg border bg-muted/40", className)}
    >
      <figcaption className="flex min-h-10 items-center justify-between gap-3 border-b bg-muted/60 py-1.5 pr-1.5 pl-3">
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
          {title ?? ""}
        </span>
        <CopyButton value={code} />
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export type SampleProps = {
  title?: string;
  className?: string;
} & (
  | {
      /** Path under `apps/web/docs-samples/`. */
      file: string;
      region?: string;
      repoFile?: never;
    }
  | {
      /** Path from the repo root, shown verbatim (e.g. a registry item file). */
      repoFile: string;
      file?: never;
      region?: never;
    }
);

/**
 * A `CodeBlock` whose code is read from a typechecked file in `docs-samples/` (or a repo
 * file). In MDX: `<Sample file="send.ts" region="send" title="ts" />` on its own line;
 * `scripts/build-llms.mjs` inlines the same code into llms-full.txt.
 */
export function Sample({ title, className, ...source }: SampleProps) {
  const code =
    source.repoFile !== undefined
      ? readRepoFile(source.repoFile)
      : readSample(source.file, source.region);
  return <CodeBlock code={code} title={title} className={className} />;
}
