"use client";

import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { cn } from "@/lib/utils";

/** Where the answer points: the docs page on setting up the official Cloud API. */
export const UNOFFICIAL_API_DOCS_HREF = "/docs/meta-setup";

/**
 * "Why not an unofficial API?" under the home stage: the short answer in a popover (no docs
 * section covers it yet), ending in a link to the official Cloud API setup.
 */
export function UnofficialApiNote({
  question,
  answer,
  link,
  className,
}: {
  question: string;
  answer: string;
  link: string;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          "rounded-sm underline decoration-border underline-offset-[3px] outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:text-foreground/80 data-[state=open]:text-foreground data-[state=open]:decoration-foreground",
          className,
        )}
      >
        {question}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[22rem] max-w-[calc(100vw-2rem)] origin-(--radix-popover-content-transform-origin) rounded-lg border bg-popover p-3.5 text-[13px] leading-relaxed text-pretty text-popover-foreground shadow-lg outline-none data-[state=closed]:animate-menu-out data-[state=open]:motion-safe:animate-menu-in data-[state=open]:motion-reduce:animate-fade-in"
        >
          <p className="font-medium">{question}</p>
          <p className="mt-1.5 text-muted-foreground">{answer}</p>
          <Link
            href={UNOFFICIAL_API_DOCS_HREF}
            className="mt-2.5 inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:text-muted-foreground/80"
          >
            {link}
            <ArrowRightIcon aria-hidden className="size-3.5" />
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
