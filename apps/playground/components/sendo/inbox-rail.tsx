"use client";

import {
  ChartLineIcon,
  InboxIcon,
  PhoneIcon,
  QrCodeIcon,
  SendIcon,
  SlidersHorizontalIcon,
  TagsIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AssigneeAvatar } from "./assignee-avatar";
import { useInboxStrings } from "./strings-context";
import { pressClass } from "./transitions";
import type { InboxCurrentUser, InboxNavLinks } from "./types";

const itemClass = cn(
  "grid size-[38px] place-items-center rounded-[9px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:size-[18px]",
  pressClass,
);

function RailItem({
  label,
  href,
  current = false,
  onClick,
  children,
}: {
  label: string;
  href?: string;
  current?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = cn(itemClass, current && "bg-accent text-foreground");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href === undefined ? (
          <button
            type="button"
            className={className}
            aria-label={label}
            aria-current={current ? "page" : undefined}
            onClick={onClick}
          >
            {children}
          </button>
        ) : (
          <a href={href} className={className} aria-label={label}>
            {children}
          </a>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export interface InboxRailProps {
  currentUser: InboxCurrentUser;
  /** Links to the installed Sendo screens; `null` entries are hidden. */
  nav: InboxNavLinks;
  /** Opens the snippets manager (SND-3.6); hidden when omitted. */
  onOpenSnippets?: () => void;
  /** Opens the tag catalog manager (SND-3.6, admins); hidden when omitted. */
  onOpenTags?: () => void;
  className?: string;
}

/** The icon rail: Bandeja, Números, Reglas, Envíos, Métricas, Enlaces, Respuestas rápidas, the operator. */
export function InboxRail({
  currentUser,
  nav,
  onOpenSnippets,
  onOpenTags,
  className,
}: InboxRailProps) {
  const strings = useInboxStrings();
  return (
    <nav
      aria-label={strings.navLabel}
      className={cn(
        "flex w-14 shrink-0 flex-col items-center gap-1.5 border-r bg-background py-3.5",
        className,
      )}
    >
      <span
        className="mb-3 grid size-[30px] place-items-center rounded-[9px] bg-primary text-sm font-bold tracking-tight text-primary-foreground"
        aria-hidden
      >
        S
      </span>
      <RailItem label={strings.navInbox} current>
        <InboxIcon aria-hidden />
      </RailItem>
      {nav.numbers !== null && (
        <RailItem label={strings.navNumbers} href={nav.numbers}>
          <PhoneIcon aria-hidden />
        </RailItem>
      )}
      {nav.rules !== null && (
        <RailItem label={strings.navRules} href={nav.rules}>
          <SlidersHorizontalIcon aria-hidden />
        </RailItem>
      )}
      {nav.broadcasts !== null && (
        <RailItem label={strings.navBroadcasts} href={nav.broadcasts}>
          <SendIcon aria-hidden />
        </RailItem>
      )}
      {nav.metrics !== null && (
        <RailItem label={strings.navMetrics} href={nav.metrics}>
          <ChartLineIcon aria-hidden />
        </RailItem>
      )}
      {nav.links !== null && (
        <RailItem label={strings.navLinks} href={nav.links}>
          <QrCodeIcon aria-hidden />
        </RailItem>
      )}
      {onOpenSnippets !== undefined && (
        <RailItem label={strings.navSnippets} onClick={onOpenSnippets}>
          <ZapIcon aria-hidden />
        </RailItem>
      )}
      {onOpenTags !== undefined && (
        <RailItem label={strings.navTags} onClick={onOpenTags}>
          <TagsIcon aria-hidden />
        </RailItem>
      )}
      <span className="mt-auto" title={currentUser.name ?? strings.you}>
        <AssigneeAvatar id={currentUser.id} name={currentUser.name} size="sm" className="size-8" />
      </span>
    </nav>
  );
}
