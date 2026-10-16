"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { StageSteps } from "@/components/site/stage-steps";
import { cn } from "@/lib/utils";
import type { DemoInboxSnapshot } from "@/lib/demo/protocol";
import { demo as demoDictionary } from "@/lib/i18n/dictionaries/demo";
import { home as homeDictionary } from "@/lib/i18n/dictionaries/home";
import type { Lang } from "@/lib/i18n/langs";
import { DemoChat } from "./demo-chat";
import { DEMO_FRAME_PATH, isFrameMessage, type HostToFrame } from "./frame-protocol";
import { HostAppFrame } from "./host-app-frame";
import {
  MobileDemoBar,
  MobileDemoChips,
  MobileInboxHighlight,
  useBelowMd,
  useMobilePane,
  type MobilePaneState,
} from "./mobile-demo";
import { useDemoConversation, type DemoConversation } from "./use-demo-conversation";

/**
 * - `split` (`/[lang]/demo`): the chat next to the bare inbox, filling the page.
 * - `stage` (home, "Your app stage"): the step strip over a phone with the chat and a sample host
 *   app (`HostAppFrame`) wrapping the inbox; the composer pulses until the first message. Below
 *   `md` the same chat and iframe become the "Two-view toggle" (`mobile-demo.tsx`).
 */
export type DemoVariant = "stage" | "split";

/**
 * Keeps the inbox iframe in sync with the conversation: posts every snapshot, answers the frame's
 * "ready", and relays step-in replies typed in the inbox. `remount()` reloads the frame (reset).
 */
function useInboxFrame(demo: DemoConversation): {
  frame: RefObject<HTMLIFrameElement | null>;
  frameKey: number;
  remount(): void;
} {
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameKey, setFrameKey] = useState(0);
  const latest = useRef<DemoInboxSnapshot | null>(null);
  const teamReply = useRef(demo.teamReply);

  useEffect(() => {
    teamReply.current = demo.teamReply;
  }, [demo.teamReply]);

  useEffect(() => {
    latest.current = demo.snapshot;
    const target = frame.current?.contentWindow;
    if (target == null) return;
    const message: HostToFrame = {
      source: "sendo-demo-host",
      type: "snapshot",
      snapshot: demo.snapshot,
    };
    target.postMessage(message, window.location.origin);
  }, [demo.snapshot]);

  useEffect(() => {
    function receive(event: MessageEvent) {
      const target = frame.current?.contentWindow;
      if (target == null || event.source !== target || event.origin !== window.location.origin)
        return;
      const data: unknown = event.data;
      if (!isFrameMessage(data)) return;
      if (data.type === "ready") {
        const message: HostToFrame = {
          source: "sendo-demo-host",
          type: "snapshot",
          snapshot: latest.current,
        };
        target.postMessage(message, window.location.origin);
        return;
      }
      const { id } = data;
      void teamReply.current(data.text).then((result) => {
        const message: HostToFrame = {
          source: "sendo-demo-host",
          type: "team-reply-result",
          id,
          result,
        };
        frame.current?.contentWindow?.postMessage(message, window.location.origin);
      });
    }
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
    };
  }, []);

  return {
    frame,
    frameKey,
    remount: () => {
      setFrameKey((key) => key + 1);
    },
  };
}

/**
 * The live demo (AC-ST-2): the visitor's WhatsApp chat next to the real `inbox`, which runs
 * in an iframe (`/demo/inbox`) so its responsive layout follows the space it gets, not the
 * page's width. Everything follows `lang`, the page language: the chat, the inbox
 * (`/demo/inbox?lang=…`) and the agent's greeting. The chat and the iframe are rendered once per
 * variant; layouts only place them.
 */
export function DemoExperience({
  lang,
  variant = "split",
  className,
  chatClassName,
}: {
  lang: Lang;
  variant?: DemoVariant;
  className?: string;
  chatClassName?: string;
}) {
  const demo = useDemoConversation(lang);
  const { frame, frameKey, remount } = useInboxFrame(demo);
  const mobile = useMobilePane(demo.snapshotRevision);
  const stage = variant === "stage";
  const showChips = stage && demo.transcript.length === 0;

  const chat = (chatLayout: string) => (
    <DemoChat
      lang={lang}
      className={cn(chatLayout, chatClassName)}
      transcript={demo.transcript}
      restored={demo.restored}
      pending={demo.pending}
      remaining={demo.remaining}
      fallback={demo.fallback}
      error={demo.error}
      placeholder={stage ? homeDictionary[lang].stage.composerPrompt : undefined}
      invite={stage}
      suggestionsClassName={stage ? "max-md:hidden" : undefined}
      aboveComposer={
        showChips ? (
          <MobileDemoChips
            lang={lang}
            disabled={demo.pending}
            onSend={(text) => {
              void demo.send(text);
            }}
          />
        ) : undefined
      }
      onSend={(text) => {
        void demo.send(text);
      }}
      onReset={() => {
        demo.reset();
        remount();
      }}
    />
  );
  const inbox = (frameClassName: string) => (
    <iframe
      key={frameKey}
      ref={frame}
      src={`${DEMO_FRAME_PATH}?lang=${lang}`}
      title={demoDictionary[lang].inbox.frameTitle}
      data-testid="demo-inbox-frame"
      className={frameClassName}
    />
  );

  if (stage) {
    return (
      <StageLayout
        lang={lang}
        className={className}
        mobile={mobile}
        steps={<StageSteps lang={lang} stage={demo.stage} className="max-md:hidden" />}
        phone={chat(
          "min-h-0 flex-1 rounded-none border-0 md:rounded-[22px] md:border-[6px] md:border-neutral-900 md:shadow-sm md:dark:border-neutral-700",
        )}
        app={
          <HostAppFrame lang={lang} className="min-h-0 flex-1">
            {inbox("block h-full w-full min-w-0 bg-background")}
          </HostAppFrame>
        }
      />
    );
  }

  return (
    <div className={cn("flex flex-col gap-3 md:flex-row", className)}>
      {chat("h-[460px] md:h-auto md:w-[320px] md:shrink-0")}
      {inbox("h-[620px] min-w-0 flex-1 rounded-xl border bg-background md:h-auto")}
    </div>
  );
}

const SLIDE =
  "max-md:transition-[transform] max-md:duration-[320ms] max-md:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none";

/**
 * The home stage. From `md` (`home-option-b.html`): the step strip on top, the phone on the left
 * and the host app on the right, filling the height the page gives it (the page sizes the stage
 * to the viewport). Below `md` (`home-mobile-option-a.html`): the segmented control over one
 * 470 px frame whose track holds the same two panes side by side (each as wide as the frame) and
 * slides with `transform: translateX` (MOTION.md SNL-4.5 #1). It is one tree at every width, only
 * the classes change, so the inbox iframe is never duplicated or remounted on resize. Below `md`
 * the hidden pane is `inert`, so focus can't land off-screen.
 */
function StageLayout({
  lang,
  steps,
  phone,
  app,
  mobile,
  className,
}: {
  lang: Lang;
  steps: ReactNode;
  phone: ReactNode;
  app: ReactNode;
  mobile: MobilePaneState;
  className?: string;
}) {
  const belowMd = useBelowMd();
  const inboxShown = mobile.pane === "inbox";
  return (
    <section
      aria-label={homeDictionary[lang].stage.label}
      data-testid="demo-stage"
      className={cn(
        "flex min-h-0 flex-col max-md:gap-2",
        "md:overflow-hidden md:rounded-2xl md:border md:bg-background",
        "md:shadow-[0_30px_60px_-30px_oklch(0_0_0/0.25),0_0_0_6px_color-mix(in_oklch,var(--muted)_70%,transparent)]",
        className,
      )}
    >
      {steps}
      <MobileDemoBar lang={lang} state={mobile} />
      <div
        data-testid="mobile-demo"
        data-pane={mobile.pane}
        className="flex min-h-0 flex-col max-md:h-[470px] max-md:overflow-hidden max-md:rounded-[14px] max-md:border max-md:bg-background md:flex-1"
      >
        <div
          className={cn(
            "flex min-h-0 flex-1 max-md:w-[200%]",
            SLIDE,
            inboxShown && "max-md:[transform:translateX(-50%)]",
            "md:grid md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]",
          )}
        >
          <div
            inert={belowMd && inboxShown}
            className="flex min-h-0 max-md:w-1/2 md:border-r md:bg-[repeating-linear-gradient(45deg,transparent_0_10px,color-mix(in_oklch,var(--muted)_60%,transparent)_10px_11px)] md:p-3"
          >
            {phone}
          </div>
          <div
            inert={belowMd && !inboxShown}
            className="relative flex min-h-0 min-w-0 max-md:w-1/2"
          >
            {app}
            <MobileInboxHighlight highlight={mobile.highlight} />
          </div>
        </div>
      </div>
    </section>
  );
}
