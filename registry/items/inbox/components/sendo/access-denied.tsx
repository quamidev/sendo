"use client";

import { ShieldOffIcon } from "lucide-react";
import type { SendoLocale } from "@/lib/sendo-ui";
import { cn } from "@/lib/utils";
import type { InboxStrings } from "./strings";
import { InboxStringsProvider, useInboxStrings } from "./strings-context";

function AccessDeniedMessage({ className }: { className?: string }) {
  const strings = useInboxStrings();
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col items-center justify-center gap-3 bg-muted/30 p-8 text-center",
        className,
      )}
      role="alert"
      data-slot="inbox-access-denied"
    >
      <ShieldOffIcon className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-base font-semibold">{strings.accessDeniedTitle}</h1>
      <p className="max-w-sm text-sm text-pretty text-muted-foreground">
        {strings.accessDeniedHint}
      </p>
    </div>
  );
}

/**
 * "You don't have access to the inbox" (`accessDeniedTitle`, AC-RL-4): the page renders it when
 * `resolveRole` gives the operator no role, and the inbox switches to it when the list comes back
 * `FORBIDDEN`.
 */
export function InboxAccessDenied({
  locale,
  formatLocale,
  strings,
  className,
}: {
  locale: SendoLocale;
  formatLocale?: string;
  strings?: Partial<InboxStrings>;
  className?: string;
}) {
  return (
    <InboxStringsProvider locale={locale} formatLocale={formatLocale} strings={strings}>
      <AccessDeniedMessage className={className} />
    </InboxStringsProvider>
  );
}
