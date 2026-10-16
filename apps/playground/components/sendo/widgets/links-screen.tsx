"use client";

import { ArrowLeft } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { LinkBuilder, type LinkBuilderHandle, type LinkDraft } from "./link-builder";
import { SourcesTable } from "./sources-table";
import type { WidgetsLocaleProps } from "./strings";
import { useWidgetsStrings, WidgetsStringsProvider } from "./strings-context";
import type { LinksActions, WidgetLinkView, WidgetNumberView, WidgetSourceView } from "./types";

export interface LinksScreenProps extends WidgetsLocaleProps {
  numbers: WidgetNumberView[];
  sources: WidgetSourceView[];
  initialDraft: LinkDraft;
  initialLink: WidgetLinkView | null;
  actions: LinksActions;
  /** The `backToInbox` link; `null` hides it. */
  inboxHref?: string | null;
  className?: string;
}

/** The links screen: link builder with QR on top, sources table below, in `locale`. */
export function LinksScreen({
  numbers,
  sources,
  initialDraft,
  initialLink,
  actions,
  inboxHref = "/inbox",
  className,
  locale,
  formatLocale,
  strings: overrides,
}: LinksScreenProps) {
  const builder = useRef<LinkBuilderHandle>(null);
  const language = { locale, formatLocale, strings: overrides };

  return (
    <WidgetsStringsProvider {...language}>
      <div className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8", className)}>
        <LinksHeader inboxHref={inboxHref} />
        <LinkBuilder
          ref={builder}
          numbers={numbers}
          actions={actions}
          initialDraft={initialDraft}
          initialLink={initialLink}
          {...language}
        />
        <SourcesTable
          numbers={numbers}
          initialSources={sources}
          actions={actions}
          {...language}
          onUseSource={(source) => {
            builder.current?.applySource(source);
          }}
        />
      </div>
    </WidgetsStringsProvider>
  );
}

function LinksHeader({ inboxHref }: { inboxHref: string | null }) {
  const strings = useWidgetsStrings();
  return (
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
  );
}

/** Which full-page message `LinksNotice` shows. */
export type LinksNoticeKind = "forbidden" | "noNumbers";

/** Full-page message instead of the screen (no access, no numbers), in `locale`. */
export function LinksNotice({
  kind,
  locale,
  formatLocale,
  strings,
}: WidgetsLocaleProps & { kind: LinksNoticeKind }) {
  return (
    <WidgetsStringsProvider locale={locale} formatLocale={formatLocale} strings={strings}>
      <NoticeMessage kind={kind} />
    </WidgetsStringsProvider>
  );
}

function NoticeMessage({ kind }: { kind: LinksNoticeKind }) {
  const strings = useWidgetsStrings();
  const title = kind === "forbidden" ? strings.forbiddenTitle : strings.noNumbersTitle;
  const body = kind === "forbidden" ? strings.forbiddenBody : strings.noNumbersBody;
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-[17px] font-[650]">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
