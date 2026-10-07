"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const RESET_AFTER_MS = 1600;

type CopyState = "idle" | "copied" | "failed";

const iconBase =
  "absolute inset-0 m-auto size-3.5 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:[transform:none]";
const iconShown = "opacity-100 [transform:none]";
const iconHidden = "opacity-0 [transform:scale(0.9)]";

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), RESET_AFTER_MS);
  }

  const copied = state === "copied";
  const label = copied ? "Copied" : state === "failed" ? "Copy failed" : "Copy code";

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground outline-none",
        "transition-[transform] duration-[120ms] ease-[cubic-bezier(0.23,1,0.32,1)] active:[transform:scale(0.97)] motion-reduce:active:[transform:none]",
        "hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/70",
        className,
      )}
    >
      <CopyIcon aria-hidden className={cn(iconBase, copied ? iconHidden : iconShown)} />
      <CheckIcon aria-hidden className={cn(iconBase, copied ? iconShown : iconHidden)} />
      <span role="status" className="sr-only">
        {state === "idle" ? "" : label}
      </span>
    </button>
  );
}
