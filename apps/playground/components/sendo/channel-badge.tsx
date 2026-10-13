"use client";

import type { Channel } from "@quami/sendo";
import { MessageCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings-context";

export interface ChannelBadgeProps {
  channel: Channel;
  /** `dot`: the small badge on an avatar corner; `label`: icon and channel name inline. */
  variant?: "dot" | "label";
  className?: string;
}

/** Which channel a conversation runs on (AC-IB-7). WhatsApp is the only channel today. */
export function ChannelBadge({ channel, variant = "dot", className }: ChannelBadgeProps) {
  const strings = useInboxStrings();
  // WhatsApp is the only channel today; new channels add their label here.
  const label = strings.channelWhatsApp;
  if (variant === "label") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}
        data-channel={channel}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full border-2 border-background bg-emerald-600 text-white",
        className,
      )}
      data-channel={channel}
      title={label}
    >
      <MessageCircleIcon className="size-2.5" strokeWidth={2.6} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
