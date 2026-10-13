"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CopyButton, type CopyButtonLabels } from "@/components/docs/copy-button";
import { cn } from "@/lib/utils";

export interface MobileInstallTab {
  /** Stable id for tests (`data-tab`). */
  id: string;
  label: string;
  command: string;
}

/**
 * The home page's install box below `md` (`home-mobile-option-a.html`): two tabs ("1 · Package" /
 * "2 · Your code") over one command row with a copy button. Test id `mobile-install-tabs`.
 */
export function MobileInstallTabs({
  label,
  tabs,
  copyLabels,
  className,
}: {
  label: string;
  tabs: MobileInstallTab[];
  copyLabels: CopyButtonLabels;
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const current = tabs[active] ?? tabs[0];
  if (current === undefined) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (active + step + tabs.length) % tabs.length;
    setActive(next);
    buttons.current[next]?.focus();
  }

  return (
    <div
      data-testid="mobile-install-tabs"
      className={cn("overflow-hidden rounded-[10px] border bg-background", className)}
    >
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex border-b bg-muted"
      >
        {tabs.map((tab, index) => {
          const selected = index === active;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              data-tab={tab.id}
              onClick={() => {
                setActive(index);
              }}
              className={cn(
                "h-10 flex-1 border-b-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                selected
                  ? "border-foreground bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground active:bg-accent",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${current.id}`}
        className="flex items-center gap-2 py-1 pr-1 pl-3"
      >
        <code
          title={current.command}
          className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap [scrollbar-width:none]"
        >
          <span aria-hidden className="text-muted-foreground select-none">
            ${" "}
          </span>
          {current.command}
        </code>
        <CopyButton
          value={current.command}
          labels={copyLabels}
          className="size-10 rounded-lg border-0 bg-muted"
        />
      </div>
    </div>
  );
}
