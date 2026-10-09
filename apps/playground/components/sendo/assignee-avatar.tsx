"use client";

import type { Channel } from "@quami/sendo";
import { UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "./channel-badge";
import { avatarTone, initials } from "./utils";

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-14 text-lg",
} as const;

export type AvatarSize = keyof typeof SIZES;

export interface PersonAvatarProps {
  /** Seeds the colour, so the same person keeps it everywhere. */
  id: string;
  name: string | null;
  avatarUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}

/** A team member: their picture, else coloured initials, else a person icon. */
export function AssigneeAvatar({
  id,
  name,
  avatarUrl = null,
  size = "xs",
  className,
}: PersonAvatarProps) {
  const letters = name === null ? null : initials(name);
  return (
    <Avatar className={cn("shrink-0", SIZES[size], className)} title={name ?? undefined}>
      {avatarUrl !== null && <AvatarImage src={avatarUrl} alt="" className="object-cover" />}
      <AvatarFallback className={cn("font-semibold text-white", avatarTone(id))}>
        {letters ?? <UserIcon className="size-3/5" aria-hidden />}
      </AvatarFallback>
    </Avatar>
  );
}

export interface ContactAvatarProps {
  id: string;
  name: string;
  channel: Channel;
  size?: AvatarSize;
  className?: string;
}

/** A contact with the channel badge on the corner. Phone-only contacts get an icon. */
export function ContactAvatar({ id, name, channel, size = "md", className }: ContactAvatarProps) {
  const letters = initials(name);
  return (
    <span className={cn("relative inline-flex h-fit shrink-0", className)}>
      <Avatar className={SIZES[size]}>
        <AvatarFallback className={cn("font-semibold text-white", avatarTone(id))}>
          {letters ?? <UserIcon className="size-1/2" aria-hidden />}
        </AvatarFallback>
      </Avatar>
      {size !== "xs" && size !== "sm" && <ChannelBadge channel={channel} />}
    </span>
  );
}
