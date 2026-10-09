"use client";

import type { MessageType } from "@quami/sendo";
import { DownloadIcon, FileTextIcon, ImageOffIcon, LoaderIcon } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MotionSheet } from "./motion-sheet";
import { useInboxStrings } from "./strings";
import type { InboxMessageView } from "./types";
import { useIsDesktop } from "./utils";

type MediaView = NonNullable<InboxMessageView["media"]>;

export interface MediaPreviewProps {
  type: MessageType;
  media: MediaView;
  caption?: string | null;
  className?: string;
}

function MediaPlaceholder({ pending, className }: { pending?: boolean; className?: string }) {
  const strings = useInboxStrings();
  const Icon = pending === true ? LoaderIcon : ImageOffIcon;
  return (
    <div
      className={cn(
        "flex h-20 w-56 max-w-full items-center gap-2 rounded-md border border-dashed bg-muted/50 px-3 text-sm text-muted-foreground",
        className,
      )}
      role="img"
      aria-label={pending === true ? strings.mediaPending : strings.mediaUnavailable}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">
        {pending === true ? strings.mediaPending : strings.mediaUnavailable}
      </span>
    </div>
  );
}

function ImageLightbox({
  open,
  onOpenChange,
  url,
  caption,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  caption: string | null;
}) {
  const strings = useInboxStrings();
  const isDesktop = useIsDesktop();
  const image = (
    <img
      src={url}
      alt={caption ?? strings.mediaPreviewTitle}
      className="max-h-[70dvh] w-full rounded-md object-contain"
      draggable={false}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="ease-[var(--sendo-ease-out)] motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1] sm:max-w-3xl">
          <DialogTitle className="sr-only">{strings.mediaPreviewTitle}</DialogTitle>
          <DialogDescription className={caption === null ? "sr-only" : undefined}>
            {caption ?? strings.mediaPreviewTitle}
          </DialogDescription>
          {image}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <MotionSheet
      open={open}
      onOpenChange={onOpenChange}
      title={strings.mediaPreviewTitle}
      hideTitle
      description={caption ?? strings.mediaPreviewTitle}
      hideDescription={caption === null}
      dragBody
    >
      {image}
    </MotionSheet>
  );
}

/** Inline preview of a message's media: image thumbnail, audio/video player or document link. */
export function MediaPreview({ type, media, caption = null, className }: MediaPreviewProps) {
  const strings = useInboxStrings();
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);

  if (media.downloadStatus === "pending") return <MediaPlaceholder pending className={className} />;
  if (media.downloadStatus === "failed" || media.url === null || broken) {
    return <MediaPlaceholder className={className} />;
  }
  const url = media.url;

  if (type === "image" || type === "sticker") {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className={cn(
            "block overflow-hidden rounded-md bg-muted outline-none transition-opacity hover:opacity-90 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:opacity-75",
            className,
          )}
          aria-label={strings.mediaOpen}
        >
          <img
            src={url}
            alt={caption ?? ""}
            loading="lazy"
            onError={() => {
              setBroken(true);
            }}
            className={cn(
              "h-48 w-60 max-w-full object-cover",
              type === "sticker" && "size-32 object-contain",
            )}
          />
        </button>
        <ImageLightbox open={open} onOpenChange={setOpen} url={url} caption={caption} />
      </>
    );
  }

  if (type === "audio") {
    return (
      <audio
        controls
        preload="none"
        src={url}
        onError={() => {
          setBroken(true);
        }}
        className={cn("h-10 w-64 max-w-full", className)}
      />
    );
  }

  if (type === "video") {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        onError={() => {
          setBroken(true);
        }}
        className={cn("max-h-64 w-64 max-w-full rounded-md bg-muted", className)}
      />
    );
  }

  const filename = media.filename ?? strings.mediaDocument;
  return (
    <a
      href={url}
      download={media.filename}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex w-64 max-w-full items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/70",
        className,
      )}
    >
      <FileTextIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{filename}</span>
      <DownloadIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{strings.mediaDownload}</span>
    </a>
  );
}
