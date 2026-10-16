"use client";

import {
  ArchiveIcon,
  BotIcon,
  FileTextIcon,
  InfoIcon,
  MapPinIcon,
  MicOffIcon,
  QrCodeIcon,
  SmartphoneIcon,
  UserIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MediaPreview } from "./media-preview";
import { agentName, personName, useInboxPeople, type InboxPeople } from "./people";
import { describeMessageError, StatusTicks } from "./status-ticks";
import type { InboxStrings } from "./strings";
import { useInboxFormat, useInboxLocale, useInboxStrings } from "./strings-context";
import type { InboxMessageView } from "./types";
import { turnCostClass } from "./transitions";
import { DEFAULT_INBOX_TIME_ZONE, formatClock, formatCostCents, stripSourceCode } from "./utils";

export interface MessageBubbleProps {
  message: InboxMessageView;
  /** Shows the sender line above the bubble (first message of a group). */
  showSender?: boolean;
  /** Admins (`costs.view`): agent replies reveal their cost and tokens on hover. */
  showCost?: boolean;
  timeZone?: string;
}

/** How an outbound message is drawn. */
export type BubbleKind = "contact" | "agent" | "human" | "echo" | "imported" | "system";

export function bubbleKind(
  message: Pick<InboxMessageView, "direction" | "sender" | "origin">,
): BubbleKind {
  if (message.origin === "imported") return "imported";
  if (message.direction === "in") return "contact";
  if (message.origin === "business_app") return "echo";
  if (message.sender === "agent") return "agent";
  if (message.sender === "system") return "system";
  return "human";
}

/** The label above a bubble: agent and approver, operator, "Desde el teléfono"… */
export function senderLabel(
  message: Pick<
    InboxMessageView,
    "direction" | "sender" | "senderRef" | "origin" | "approvedBy" | "edited"
  >,
  strings: InboxStrings,
  people: InboxPeople,
): string | null {
  switch (bubbleKind(message)) {
    case "contact":
      return null;
    case "imported":
      return strings.importedMessage;
    case "echo":
      return strings.fromPhone;
    case "system":
      return strings.senderSystem;
    case "human":
      return personName(message.senderRef, people, strings);
    case "agent": {
      const agent = agentName(message.senderRef, people, strings);
      if (message.approvedBy === null) return agent;
      const approval = strings.approvedBy(personName(message.approvedBy, people, strings));
      return `${agent} · ${approval}${message.edited ? ` (${strings.editedSuffix})` : ""}`;
    }
  }
}

const SENDER_ICON: Record<BubbleKind, ReactNode> = {
  contact: null,
  imported: <ArchiveIcon className="size-3" aria-hidden />,
  echo: <SmartphoneIcon className="size-3" aria-hidden />,
  system: <InfoIcon className="size-3" aria-hidden />,
  human: <UserIcon className="size-3" aria-hidden />,
  agent: <BotIcon className="size-3" aria-hidden />,
};

const BUBBLE_CLASS: Record<BubbleKind, string> = {
  contact: "rounded-bl-md border-border bg-background text-foreground",
  imported: "border-dashed border-border bg-muted/60 text-foreground",
  echo: "rounded-br-md border-dashed border-emerald-300 bg-emerald-50 text-foreground dark:border-emerald-800 dark:bg-emerald-950/40",
  system: "rounded-br-md border-border bg-muted text-foreground",
  human: "rounded-br-md border-transparent bg-zinc-100 text-foreground dark:bg-zinc-800",
  agent: "rounded-br-md border-transparent bg-blue-50 text-foreground dark:bg-blue-950/50",
};

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

/** An inbound voice note: player, then the transcript or "Sin transcripción" (AC-VN-2). */
function VoiceNote({ message, body }: { message: InboxMessageView; body: string | null }) {
  const strings = useInboxStrings();
  const error = message.transcription?.error ?? null;
  return (
    <div className="flex flex-col gap-1.5">
      {message.media === undefined ? (
        <MetaLine icon={<FileTextIcon className="size-4" aria-hidden />}>
          {strings.mediaUnavailable}
        </MetaLine>
      ) : (
        <MediaPreview type="audio" media={message.media} />
      )}
      {body !== null && body !== "" ? (
        <p className="break-words whitespace-pre-wrap" data-transcript>
          <span className="sr-only">{strings.transcriptLabel} </span>
          {body}
        </p>
      ) : (
        error !== null && (
          <p
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={strings.transcriptMissingReason(error)}
          >
            <MicOffIcon className="size-3.5 shrink-0" aria-hidden />
            <span>{strings.transcriptMissing}</span>
            <span className="sr-only">: {strings.transcriptMissingReason(error)}</span>
          </p>
        )
      )}
    </div>
  );
}

/**
 * Turn cost and tokens of an agent reply for admins (AC-CO-2): fades in while the pointer is
 * over the message (`MOTION.md`, SND-4.10); always shown where there is no hover.
 */
function TurnCost({ message }: { message: InboxMessageView }) {
  const strings = useInboxStrings();
  const format = useInboxFormat();
  const { formatLocale } = useInboxLocale();
  const cost =
    message.costCents === null
      ? strings.costUnknown
      : formatCostCents(message.costCents, formatLocale);
  return (
    <span data-turn-cost className={turnCostClass}>
      <span aria-hidden>{strings.turnCost(cost, message.tokensIn, message.tokensOut, format)}</span>
      <span className="sr-only">
        {strings.turnCostLabel(cost, message.tokensIn, message.tokensOut, format)}
      </span>
    </span>
  );
}

function MessageBody({ message }: { message: InboxMessageView }) {
  const strings = useInboxStrings();
  const { content } = message;
  const text =
    message.direction === "in" && message.source !== null && message.text !== null
      ? stripSourceCode(message.text)
      : message.text;
  const body =
    text === null || text === "" ? null : <p className="break-words whitespace-pre-wrap">{text}</p>;

  if (message.type === "audio" && message.direction === "in") {
    return <VoiceNote message={message} body={text} />;
  }
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

/**
 * One message: inbound on the left; agent, operator, phone-app echo and system on the right.
 * Notes and system lines have their own components (`note-bubble.tsx`, `system-line.tsx`).
 */
export function MessageBubble({
  message,
  showSender = true,
  showCost = false,
  timeZone = DEFAULT_INBOX_TIME_ZONE,
}: MessageBubbleProps) {
  const strings = useInboxStrings();
  const { formatLocale } = useInboxLocale();
  const people = useInboxPeople();
  const kind = bubbleKind(message);
  const outbound = message.direction === "out";
  const failed = message.status === "failed";
  const error = failed ? describeMessageError(message.error, strings) : null;
  const time = message.sentAt ?? message.createdAt;
  const label = showSender ? senderLabel(message, strings, people) : null;
  const costVisible = showCost && kind === "agent" && !message.draft;

  return (
    <div
      className={cn(
        "group/bubble flex max-w-[85%] flex-col md:max-w-[68%]",
        outbound ? "items-end self-end" : "items-start self-start",
      )}
      data-direction={message.direction}
      data-kind={kind}
      data-status={message.status}
    >
      {label !== null && (
        <span className="mx-1 mt-2 mb-1 flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
          {SENDER_ICON[kind]}
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
        </span>
      )}
      <div
        className={cn(
          "max-w-full rounded-2xl border px-3 py-2 text-sm leading-relaxed",
          BUBBLE_CLASS[kind],
          failed && "border-destructive/50",
        )}
      >
        <MessageBody message={message} />
      </div>
      <div className="mx-1 mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-none text-muted-foreground tabular-nums">
        {costVisible && <TurnCost message={message} />}
        <time dateTime={time} suppressHydrationWarning>
          {formatClock(time, formatLocale, timeZone)}
        </time>
        {message.direction === "in" && message.source !== null && (
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            <QrCodeIcon className="size-3" aria-hidden />
            {strings.origin(message.source)}
          </span>
        )}
        {outbound && <StatusTicks status={message.status} error={message.error} />}
      </div>
      {error !== null && (
        <p className="mx-1 mt-1 max-w-full text-right text-xs text-destructive">
          {strings.tickFailed} · {error}
        </p>
      )}
    </div>
  );
}
