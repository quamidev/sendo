"use client";

import { ArrowLeft } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { LinkBuilder, type LinkBuilderHandle, type LinkDraft } from "./link-builder";
import { SourcesTable } from "./sources-table";
import { resolveWidgetsStrings, type WidgetsStrings } from "./strings";
import type { LinksActions, WidgetLinkView, WidgetNumberView, WidgetSourceView } from "./types";

export interface LinksScreenProps {
  numbers: WidgetNumberView[];
  sources: WidgetSourceView[];
  initialDraft: LinkDraft;
  initialLink: WidgetLinkView | null;
  actions: LinksActions;
  /** "Volver a la bandeja"; `null` hides the link. */
  inboxHref?: string | null;
  className?: string;
  strings?: Partial<WidgetsStrings>;
}

/** The "Enlaces" screen: link builder with QR on top, sources table below. */
export function LinksScreen({
  numbers,
  sources,
  initialDraft,
  initialLink,
  actions,
  inboxHref = "/inbox",
  className,
  strings: overrides,
}: LinksScreenProps) {
  const strings = resolveWidgetsStrings(overrides);
  const builder = useRef<LinkBuilderHandle>(null);

  return (
    <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8", className)}>
      <header className="flex flex-col gap-1">
        {inboxHref !== null && (
          <a
            href={inboxHref}
            className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {strings.backToInbox}
          </a>
        )}
        <h1 className="text-[17px] font-[650] tracking-[-0.01em]">{strings.pageTitle}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{strings.pageDescription}</p>
      </header>
      <LinkBuilder
        ref={builder}
        numbers={numbers}
        actions={actions}
        initialDraft={initialDraft}
        initialLink={initialLink}
        strings={overrides}
      />
      <SourcesTable
        numbers={numbers}
        initialSources={sources}
        actions={actions}
        strings={overrides}
        onUseSource={(source) => {
          builder.current?.applySource(source);
        }}
      />
    </div>
  );
}

/** Full-page message (no access, no numbers). */
export function LinksNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-[17px] font-[650]">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
