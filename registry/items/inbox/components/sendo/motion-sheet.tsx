"use client";

import { XIcon } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useInboxStrings } from "./strings";

/** apple-design default: critically damped (no overshoot), response ≈ 0.35 s. */
export const SHEET_SPRING = { type: "spring", bounce: 0, visualDuration: 0.35 } as const;
/** Reduced motion: opacity only, `--sendo-dur-menu` with `--sendo-ease-out`. */
const REDUCED_FADE = { duration: 0.2, ease: [0.16, 1, 0.3, 1] } as const;
/** Apple's scroll deceleration rate, used to project where a flick would come to rest. */
const DECELERATION_RATE = 0.998;
/** Upward over-drag resistance (UIScrollView's rubber-band constant). */
const RUBBER_BAND = 0.55;

function project(velocity: number): number {
  return ((velocity / 1000) * DECELERATION_RATE) / (1 - DECELERATION_RATE);
}

function rubberBand(overshoot: number, dimension: number): number {
  if (dimension <= 0) return 0;
  return (1 - 1 / ((overshoot * RUBBER_BAND) / dimension + 1)) * dimension;
}

export interface MotionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Keeps the title for screen readers only. */
  hideTitle?: boolean;
  hideDescription?: boolean;
  /** The body can also be dragged (media preview); otherwise only the handle and header drag, and the body scrolls. */
  dragBody?: boolean;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/**
 * Bottom sheet for mobile: springs in from the bottom edge and back out the same way, follows the
 * finger 1:1 when dragged down, and on release hands the finger's velocity to the spring (a flick
 * dismisses it). Every animation starts from the current value, so it can be grabbed or reversed
 * mid-flight. Under `prefers-reduced-motion` it only fades.
 */
export function MotionSheet({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  hideDescription = false,
  dragBody = false,
  children,
  className,
  bodyClassName,
}: MotionSheetProps) {
  const strings = useInboxStrings();
  const reduce = useReducedMotion() === true;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  // State, not a ref: Radix's portal mounts its content one commit later, and the open/close
  // effect has to run once the panel exists.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const height = useRef(1);
  const wasMounted = useRef(false);
  const run = useRef(0);
  const dragging = useRef(false);
  const dragStart = useRef(0);
  const releaseVelocity = useRef(0);

  const y = useMotionValue(0);
  const fade = useMotionValue(1);
  const overlay = useMotionValue(0);

  // The backdrop follows the sheet synchronously (also while dragging), never a frame behind.
  useLayoutEffect(() => {
    const update = () => {
      const progress = 1 - Math.min(1, Math.max(0, y.get() / height.current));
      overlay.set(fade.get() * progress);
    };
    const offY = y.on("change", update);
    const offFade = fade.on("change", update);
    return () => {
      offY();
      offFade();
    };
  }, [y, fade, overlay]);

  useLayoutEffect(() => {
    const element = panel;
    if (!mounted || element === null) {
      wasMounted.current = false;
      return;
    }
    height.current = Math.max(1, element.offsetHeight);
    const velocity = releaseVelocity.current;
    releaseVelocity.current = 0;
    const current = ++run.current;

    if (open) {
      if (!wasMounted.current) {
        // First frame of a fresh open: start fully below the edge (or transparent).
        overlay.set(0);
        if (reduce) fade.set(0);
        else y.set(height.current);
      }
      wasMounted.current = true;
      if (reduce) {
        y.set(0);
        void animate(fade, 1, REDUCED_FADE);
      } else {
        fade.set(1);
        void animate(y, 0, { ...SHEET_SPRING, velocity });
      }
      return;
    }

    // Exit along the entry path, then unmount unless it was reopened meanwhile.
    const exit = reduce
      ? animate(fade, 0, REDUCED_FADE)
      : animate(y, height.current, { ...SHEET_SPRING, velocity });
    void exit.then(() => {
      if (run.current === current) setMounted(false);
    });
  }, [open, mounted, panel, reduce, y, fade, overlay]);

  useEffect(
    () => () => {
      y.stop();
      fade.stop();
    },
    [y, fade],
  );

  function settle(target: "open" | "closed", velocity: number) {
    if (target === "closed") {
      releaseVelocity.current = velocity;
      onOpenChange(false);
      return;
    }
    void animate(y, 0, { ...SHEET_SPRING, velocity });
  }

  // Catch the sheet mid-flight the moment the finger lands (response starts on pointer-down).
  function onPointerDown() {
    y.stop();
    dragging.current = false;
  }

  function onPointerUp() {
    if (!dragging.current && open) settle("open", 0);
  }

  function onPanStart() {
    dragging.current = true;
    dragStart.current = y.get();
    if (panel !== null) height.current = Math.max(1, panel.offsetHeight);
  }

  function onPan(_event: PointerEvent, info: PanInfo) {
    const next = dragStart.current + info.offset.y;
    y.set(next >= 0 ? next : -rubberBand(-next, height.current));
  }

  function onPanEnd(_event: PointerEvent, info: PanInfo) {
    dragging.current = false;
    const velocity = info.velocity.y;
    const restingPoint = y.get() + project(velocity);
    settle(restingPoint > height.current / 2 ? "closed" : "open", velocity);
  }

  const dragHandlers = reduce
    ? {}
    : { onPointerDown, onPointerUp, onPointerCancel: onPointerUp, onPanStart, onPan, onPanEnd };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {mounted && (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay forceMount asChild>
            <motion.div className="fixed inset-0 z-50 bg-black/50" style={{ opacity: overlay }} />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content forceMount asChild>
            <motion.div
              ref={setPanel}
              className={cn(
                "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-xl border-t bg-background shadow-lg outline-none",
                // Fills the gap below the sheet while it is over-dragged upwards.
                "after:absolute after:inset-x-0 after:top-full after:h-[50vh] after:bg-background",
                className,
              )}
              style={{ y, opacity: fade }}
              data-slot="motion-sheet"
              data-motion={reduce ? "fade" : "spring"}
            >
              <motion.div
                className={cn(
                  "flex shrink-0 flex-col gap-1.5 px-4 pt-2 pb-3",
                  !reduce && "cursor-grab touch-none select-none active:cursor-grabbing",
                )}
                {...dragHandlers}
              >
                {!reduce && (
                  <span
                    className="mx-auto mb-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
                    data-slot="sheet-handle"
                    aria-hidden
                  />
                )}
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <DialogPrimitive.Title
                      className={cn("font-semibold text-foreground", hideTitle && "sr-only")}
                    >
                      {title}
                    </DialogPrimitive.Title>
                    {description === undefined ? (
                      <DialogPrimitive.Description className="sr-only">
                        {title}
                      </DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description
                        className={cn(
                          "text-sm text-pretty text-muted-foreground",
                          hideDescription && "sr-only",
                        )}
                      >
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  <DialogPrimitive.Close
                    className="-mt-1 -mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent/70"
                    aria-label={strings.sheetClose}
                  >
                    <XIcon className="size-4" aria-hidden />
                  </DialogPrimitive.Close>
                </div>
              </motion.div>
              <motion.div
                className={cn(
                  "relative z-10 min-h-0 flex-1 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
                  dragBody && !reduce
                    ? "touch-none select-none"
                    : "overflow-y-auto overscroll-contain",
                  bodyClassName,
                )}
                {...(dragBody ? dragHandlers : {})}
              >
                {children}
              </motion.div>
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  );
}
