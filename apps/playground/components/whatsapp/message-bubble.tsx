"use client";

import type { Sender } from "@quami/wa-li";
import { FileTextIcon, MapPinIcon, UserIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MediaPreview } from "./media-preview";
import { describeMessageError, StatusTicks } from "./status-ticks";
import { useInboxStrings, type InboxStrings } from "./strings";
import type { InboxMessageView } from "./types";
import { DEFAULT_INBOX_TIME_ZONE, formatClock } from "./utils";

export interface MessageBubbleProps {
  message: InboxMessageView;
  /** Shows the sender label above the bubble (first message of a group). */
  showSender?: boolean;
  timeZone?: string;
}

export function senderLabel(
  message: Pick<InboxMessageView, "sender" | "senderRef">,
  strings: InboxStrings,
): string {
  const labels: Record<Sender, string> = {
    contact: strings.senderContact,
    agent: strings.senderAgent,
    human: strings.senderHuman,
    system: strings.senderSystem,
  };
  const label = labels[message.sender];
  return message.sender === "agent" && message.senderRef !== null
    ? `${label} · ${message.senderRef}`
    : label;
}

function stringField(content: Record<string, unknown>, key: string): string | null {
  const value = content[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function MetaLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      {icon}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

function MessageBody({ message }: { message: InboxMessageView }) {
  const strings = useInboxStrings();
  const { content, text } = message;
  const body =
    text === null || text === "" ? null : <p className="break-words whitespace-pre-wrap">{text}</p>;

  switch (message.type) {
    case "image":
    case "sticker":
    case "audio":
    case "video":
    case "document":
      return (
        <div className="flex flex-col gap-1.5">
          {message.media === undefined ? (
            <MetaLine icon={<FileTextIcon className="size-4" aria-hidden />}>
              {message.direction === "out"
                ? strings.messageTypeLabel(message.type)
                : strings.mediaUnavailable}
            </MetaLine>
          ) : (
            <MediaPreview type={message.type} media={message.media} caption={text} />
          )}
          {message.type !== "sticker" && body}
        </div>
      );
    case "location": {
      const name = stringField(content, "name") ?? stringField(content, "address");
      return (
        <MetaLine icon={<MapPinIcon className="size-4" aria-hidden />}>
          {name ?? text ?? strings.messageLocation}
        </MetaLine>
      );
    }
    case "contacts":
      return (
        <MetaLine icon={<UserIcon className="size-4" aria-hidden />}>
          {text ?? strings.messageContacts}
        </MetaLine>
      );
    case "reaction": {
      const emoji = stringField(content, "emoji");
      return (
        <p className="text-muted-foreground">
          {emoji === null ? strings.messageReactionRemoved : strings.messageReaction(emoji)}
        </p>
      );
    }
    case "template":
      return (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {strings.messageTemplate}
          </span>
          {body ?? <p>{stringField(content, "name") ?? strings.messageTemplate}</p>}
        </div>
      );
    case "unsupported":
    case "status_placeholder":
      return <p className="text-muted-foreground italic">{strings.messageUnsupported}</p>;
    case "text":
    case "interactive":
    case "button":
      return body ?? <p className="text-muted-foreground italic">{strings.messageUnsupported}</p>;
  }
}

/** One message: inbound on the left, outbound (agent, operator, system) on the right. */
export function MessageBubble({
  message,
  showSender = true,
  timeZone = DEFAULT_INBOX_TIME_ZONE,
}: MessageBubbleProps) {
  const strings = useInboxStrings();
  const outbound = message.direction === "out";
  const failed = message.status === "failed";
  const error = failed ? describeMessageError(message.error, strings) : null;
  const time = message.sentAt ?? message.createdAt;

  return (
    <div
      className={cn("flex flex-col gap-1", outbound ? "items-end" : "items-start")}
      data-direction={message.direction}
      data-status={message.status}
    >
      {showSender && (
        <span className="max-w-full truncate px-1 text-xs font-medium text-muted-foreground">
          {senderLabel(message, strings)}
        </span>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl border px-3 py-2 text-sm md:max-w-[70%]",
          outbound
            ? "rounded-br-md bg-secondary text-secondary-foreground"
            : "rounded-bl-md bg-card text-card-foreground",
          message.sender === "agent" && "border-dashed",
          failed && "border-destructive/50",
        )}
      >
        <MessageBody message={message} />
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] leading-none text-muted-foreground tabular-nums">
          <time dateTime={time} suppressHydrationWarning>
            {formatClock(time, timeZone)}
          </time>
          {outbound && <StatusTicks status={message.status} error={message.error} />}
        </div>
      </div>
      {error !== null && (
        <p className="max-w-[85%] px-1 text-right text-xs text-destructive md:max-w-[70%]">
          {strings.tickFailed} · {error}
        </p>
      )}
    </div>
  );
}
