"use client";

import { useState, useSyncExternalStore } from "react";
import { home } from "@/lib/i18n/dictionaries/home";
import type { Lang } from "@/lib/i18n/langs";
import { interpolate } from "@/lib/i18n/rich";
import { cn } from "@/lib/utils";

// The home demo below `md` ("Two-view toggle", `home-mobile-option-a.html`): one fixed-height frame
// whose two panes (the resident's phone, the team inbox) slide sideways, a segmented control to
// switch them, suggestion chips over the composer and an unread badge on "Team inbox". The panes
// themselves are the desktop stage's phone and inbox iframe, laid out differently by CSS
// (`StageLayout` in `demo-experience.tsx`): the page keeps one iframe at every width.

export type MobilePane = "phone" | "inbox";

/** Matches below the `md` breakpoint (Tailwind's `max-md:`), where one pane shows at a time. */
const BELOW_MD = "(width < 48rem)";

function subscribeBelowMd(onChange: () => void): () => void {
  const query = window.matchMedia(BELOW_MD);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

/** `true` below `md` (client only; the server renders the desktop answer, `false`). */
export function useBelowMd(): boolean {
  return useSyncExternalStore(
    subscribeBelowMd,
    () => window.matchMedia(BELOW_MD).matches,
    () => false,
  );
}

export interface MobilePaneState {
  pane: MobilePane;
  /** Snapshots that arrived while the phone pane was showing (the Team inbox badge). */
  unread: number;
  /** Bumped when the inbox is shown with unread activity: keys the pane's highlight. */
  highlight: number;
  show(pane: MobilePane): void;
}

/**
 * The active pane and the unread count, derived from `snapshotRevision` (it increments on every
 * server answer): what arrived since the visitor last switched panes counts as unread while the
 * phone shows, and showing the inbox clears it.
 */
export function useMobilePane(snapshotRevision: number): MobilePaneState {
  const [pane, setPane] = useState<MobilePane>("phone");
  const [seenRevision, setSeenRevision] = useState(snapshotRevision);
  const [highlight, setHighlight] = useState(0);
  const unread = pane === "phone" ? Math.max(0, snapshotRevision - seenRevision) : 0;
  return {
    pane,
    unread,
    highlight,
    show(next) {
      if (next === pane) return;
      if (next === "inbox" && unread > 0) setHighlight((count) => count + 1);
      setSeenRevision(snapshotRevision);
      setPane(next);
    },
  };
}

const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";

/** MOTION.md SNL-4.5: press feedback on the toggle segments and chips. */
const PRESS = `transition-[transform] duration-[120ms] ${EASE} active:[transform:scale(0.97)] motion-reduce:active:[transform:none]`;

/**
 * "Try it: write as a resident" and the segmented control **Resident's phone | Team inbox**
 * (test ids `mobile-demo-toggle`, buttons `data-pane`, badge `mobile-demo-badge`). Below `md`
 * only.
 */
export function MobileDemoBar({
  lang,
  state,
  className,
}: {
  lang: Lang;
  state: MobilePaneState;
  className?: string;
}) {
  const t = home[lang].mobile;
  const panes: { pane: MobilePane; label: string }[] = [
    { pane: "phone", label: t.toggle.phone },
    { pane: "inbox", label: t.toggle.inbox },
  ];
  return (
    <div className={cn("flex flex-col gap-2 md:hidden", className)}>
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <i aria-hidden className="size-[7px] rounded-full bg-wa-strong" />
        {t.tryIt}
      </p>
      <div
        role="group"
        aria-label={t.toggle.label}
        data-testid="mobile-demo-toggle"
        data-pane={state.pane}
        className="relative grid grid-cols-2 rounded-[10px] bg-muted p-[3px]"
      >
        {/* The thumb under the active segment (MOTION.md SNL-4.5 #2). */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-lg bg-background shadow-[0_1px_3px_oklch(0_0_0/0.1)] dark:bg-accent",
            `transition-[transform] duration-[260ms] ${EASE} motion-reduce:transition-none`,
            state.pane === "inbox" && "[transform:translateX(100%)]",
          )}
        />
        {panes.map(({ pane, label }) => {
          const active = state.pane === pane;
          return (
            <button
              key={pane}
              type="button"
              data-pane={pane}
              aria-pressed={active}
              onClick={() => {
                state.show(pane);
              }}
              className={cn(
                PRESS,
                "relative z-[1] inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground active:text-foreground/80",
              )}
            >
              <span className="truncate">{label}</span>
              {pane === "inbox" && state.unread > 0 && (
                <span
                  data-testid="mobile-demo-badge"
                  className={cn(
                    "grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-wa-strong px-1 text-[10px] leading-none font-semibold text-white tabular-nums dark:text-neutral-950",
                    `transition-[opacity,transform] duration-200 ${EASE} starting:opacity-0 starting:[transform:scale(0.8)] motion-reduce:starting:[transform:none]`,
                  )}
                >
                  <span aria-hidden>{state.unread > 9 ? "9+" : state.unread}</span>
                  <span className="sr-only">{interpolate(t.unread, { count: state.unread })}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Suggestion chips over the composer until the first message (AC-ST-8 mobile); tapping one sends
 * it. Below `md` only (the desktop chat keeps its own empty-state suggestions).
 */
export function MobileDemoChips({
  lang,
  disabled,
  onSend,
}: {
  lang: Lang;
  disabled: boolean;
  onSend(text: string): void;
}) {
  return (
    <div
      data-testid="mobile-demo-chips"
      className="flex gap-1.5 overflow-x-auto bg-[#efeae2] px-2.5 pt-1 pb-2 [scrollbar-width:none] md:hidden dark:bg-[#0b141a]"
    >
      {home[lang].mobile.chips.map((chip) => (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          onClick={() => {
            onSend(chip);
          }}
          className={cn(
            PRESS,
            // 32 px chip, 40 px hit area (the `::after` reaches into the row's padding).
            "relative h-8 shrink-0 rounded-full border border-black/10 bg-white px-3 text-[12.5px] whitespace-nowrap text-[#111b21] outline-none after:absolute after:inset-x-0 after:-inset-y-1 hover:border-[#1fa855]/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-[#d9fdd3] disabled:opacity-50 dark:border-white/10 dark:bg-[#202c33] dark:text-[#e9edef] dark:active:bg-[#005c4b]",
          )}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

/**
 * A brief WhatsApp-green wash over the inbox pane when it is shown with unread activity
 * (MOTION.md SNL-4.5 #3): keyed by `highlight`, it starts visible (`@starting-style`) and fades
 * out once the slide is nearly done. Opacity only, so it stays under reduced motion.
 */
export function MobileInboxHighlight({ highlight }: { highlight: number }) {
  if (highlight === 0) return null;
  return (
    <span
      key={highlight}
      aria-hidden
      data-testid="mobile-demo-highlight"
      className={cn(
        "pointer-events-none absolute inset-0 bg-wa/45 opacity-0 md:hidden",
        `transition-opacity delay-[220ms] duration-[900ms] ${EASE} starting:opacity-100`,
      )}
    />
  );
}
