import { CopyButton } from "@/components/docs/copy-button";
import { readSample } from "@/components/docs/read-sample";
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

export interface SampleProps {
  /** Path under `apps/web/docs-samples/`. */
  file: string;
  region?: string;
  title?: string;
  className?: string;
}

/** A `CodeBlock` whose code is read from a typechecked file in `docs-samples/`. */
export function Sample({ file, region, title, className }: SampleProps) {
  return <CodeBlock code={readSample(file, region)} title={title} className={className} />;
}
