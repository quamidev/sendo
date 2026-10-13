"use client";

import { InfoIcon, LoaderIcon, PauseIcon, PlayIcon, UnplugIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { actorName, useInboxPeople } from "./people";
import { useInboxStrings } from "./strings";
import { enterBannerClass, pressClass } from "./transitions";
import type { InboxConversationView } from "./types";
import { DEFAULT_INBOX_TIME_ZONE, formatClock } from "./utils";

export type BannerKind = "handoff" | "paused" | "disconnected";

/** Which banners a conversation shows (AC-IB-2, IB-6, IB-8). */
export function visibleBanners(
  conversation: Pick<InboxConversationView, "status" | "handoff" | "agentPaused" | "accountActive">,
): BannerKind[] {
  const kinds: BannerKind[] = [];
  if (!conversation.accountActive) kinds.push("disconnected");
  if (conversation.status === "human" && conversation.handoff !== null) kinds.push("handoff");
  if (conversation.agentPaused && conversation.status !== "closed") kinds.push("paused");
  return kinds;
}

export interface ThreadBannersProps {
  conversation: InboxConversationView;
  /** `by` of the latest pause (system line), when known. */
  pausedBy: string | null;
  /** Supervisor/admin: shows **Reanudar** on a conversation pause. */
  canResume: boolean;
  onResume: () => void;
  resuming?: boolean;
  timeZone?: string;
}

function Banner({
  kind,
  icon,
  entering,
  action,
  children,
}: {
  kind: BannerKind;
  icon: ReactNode;
  entering: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={kind === "disconnected" ? "alert" : "status"}
      data-banner={kind}
      data-motion={entering ? "enter" : undefined}
      className={cn(
        "flex items-start gap-2.5 border-b px-4 py-2.5 text-[13px] md:px-5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
        kind === "handoff" && "bg-blue-50/70 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100",
        kind === "paused" && "bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
        kind === "disconnected" && "bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-100",
        entering && enterBannerClass,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action}
    </div>
  );
}

/**
 * Banners above the thread: why it was handed to a person (only while `human`), the agent pause
 * with **Reanudar**, and a disconnected number. Banners present when the thread opens are drawn
 * in place; one that appears while it is open drops in.
 */
export function ThreadBanners({
  conversation,
  pausedBy,
  canResume,
  onResume,
  resuming = false,
  timeZone = DEFAULT_INBOX_TIME_ZONE,
}: ThreadBannersProps) {
  const strings = useInboxStrings();
  const people = useInboxPeople();
  const kinds = visibleBanners(conversation);
  // The thread is keyed by conversation: banners on screen when it opened are drawn in place;
  // one that appears later (also after leaving and coming back) is marked as entering.
  const [seen, setSeen] = useState<{ visible: string; entering: ReadonlySet<BannerKind> }>(() => ({
    visible: kinds.join(),
    entering: new Set(),
  }));
  if (seen.visible !== kinds.join()) {
    const before = new Set(seen.visible.split(","));
    setSeen({
      visible: kinds.join(),
      entering: new Set(kinds.filter((kind) => !before.has(kind) || seen.entering.has(kind))),
    });
  }
  const initial = { has: (kind: BannerKind) => !seen.entering.has(kind) };
  if (kinds.length === 0) return null;
  const { handoff } = conversation;
  const pausedOnAccount = conversation.agentPausedOn === "account";

  return (
    <div className="flex flex-col" data-slot="thread-banners">
      {kinds.includes("disconnected") && (
        <Banner
          kind="disconnected"
          icon={<UnplugIcon aria-hidden />}
          entering={!initial.has("disconnected")}
        >
          <b className="font-semibold">{strings.disconnectedTitle}</b>{" "}
          <span className="opacity-80">{strings.disconnectedHint}</span>
        </Banner>
      )}
      {kinds.includes("handoff") && handoff !== null && (
        <Banner kind="handoff" icon={<InfoIcon aria-hidden />} entering={!initial.has("handoff")}>
          {/* Long reasons are clamped on phones; the handoff system line in the thread has it all. */}
          <p className="max-md:line-clamp-3" title={handoff.reason}>
            <b className="font-semibold">{strings.handoffBannerTitle}</b> {handoff.reason}
          </p>
          {(handoff.by !== null || handoff.at !== null) && (
            <div className="mt-0.5 text-xs opacity-70">
              {[
                handoff.by === null ? null : actorName(handoff.by, people, strings),
                handoff.at === null ? null : formatClock(handoff.at, timeZone),
              ]
                .filter((part) => part !== null)
                .join(" · ")}
            </div>
          )}
        </Banner>
      )}
      {kinds.includes("paused") && (
        <Banner
          kind="paused"
          icon={<PauseIcon aria-hidden />}
          entering={!initial.has("paused")}
          action={
            canResume && !pausedOnAccount ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resuming}
                onClick={onResume}
                className={cn(
                  "-my-1 h-7 shrink-0 bg-background/70 active:bg-accent/70",
                  pressClass,
                )}
              >
                {resuming ? <LoaderIcon aria-hidden /> : <PlayIcon aria-hidden />}
                {strings.resume}
              </Button>
            ) : undefined
          }
        >
          <b className="font-semibold">
            {pausedOnAccount ? strings.pausedAccountTitle : strings.pausedBannerTitle}
          </b>
          <div className="mt-0.5 text-xs opacity-80">
            {pausedOnAccount
              ? strings.pausedAccountHint
              : pausedBy === "business_app"
                ? strings.pausedByPhone
                : pausedBy === null
                  ? strings.pausedBannerHint
                  : strings.pausedBannerBy(actorName(pausedBy, people, strings))}
          </div>
        </Banner>
      )}
    </div>
  );
}
