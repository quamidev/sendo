"use client";

import type { MessageError, MessageStatus } from "@quami/sendo";
import { CheckCheckIcon, CheckIcon, CircleIcon, TriangleAlertIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useInboxStrings, type InboxStrings } from "./strings";
import { CrossFade } from "./transitions";

export interface StatusTicksProps {
  status: MessageStatus;
  error?: MessageError | null;
  className?: string;
}

/** One line describing a Meta error: `Código 131047 · message`. */
export function describeMessageError(
  error: MessageError | null | undefined,
  strings: InboxStrings,
): string | null {
  if (error === null || error === undefined) return null;
  const parts = [error.code === undefined ? null : strings.errorCode(error.code), error.message];
  return parts.filter((part) => part !== null && part !== "").join(" · ");
}

/** Delivery state of an outbound message: ○ pending, ✓ sent, ✓✓ delivered, ✓✓ read, ⚠ failed. */
export function StatusTicks({ status, error, className }: StatusTicksProps) {
  if (status === "received") return null;
  return (
    <CrossFade
      value={status}
      render={(shown) => <TickIcon status={shown} error={error} />}
      className={cn("size-4", className)}
    />
  );
}

function TickIcon({
  status,
  error,
}: {
  status: Exclude<MessageStatus, "received">;
  error?: MessageError | null;
}) {
  const strings = useInboxStrings();
  const base = "inline-flex size-4 shrink-0 items-center justify-center";

  switch (status) {
    case "pending":
      return (
        <span
          className={cn(base, "text-muted-foreground")}
          role="img"
          aria-label={strings.tickPending}
        >
          <CircleIcon className="size-2.5" aria-hidden />
        </span>
      );
    case "sent":
      return (
        <span
          className={cn(base, "text-muted-foreground")}
          role="img"
          aria-label={strings.tickSent}
        >
          <CheckIcon className="size-3.5" aria-hidden />
        </span>
      );
    case "delivered":
      return (
        <span
          className={cn(base, "text-muted-foreground")}
          role="img"
          aria-label={strings.tickDelivered}
        >
          <CheckCheckIcon className="size-3.5" aria-hidden />
        </span>
      );
    case "read":
      return (
        <span className={cn(base, "text-primary")} role="img" aria-label={strings.tickRead}>
          <CheckCheckIcon className="size-3.5" strokeWidth={2.5} aria-hidden />
        </span>
      );
    case "failed": {
      const detail = describeMessageError(error, strings);
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                base,
                "rounded-sm text-destructive transition-colors outline-none hover:bg-destructive/10 focus-visible:ring-[3px] focus-visible:ring-destructive/30 active:bg-destructive/20",
              )}
              aria-label={detail === null ? strings.tickFailed : `${strings.tickFailed}: ${detail}`}
            >
              <TriangleAlertIcon className="size-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            <p className="font-medium">{strings.tickFailed}</p>
            {detail !== null && <p className="opacity-80">{detail}</p>}
          </TooltipContent>
        </Tooltip>
      );
    }
  }
}
