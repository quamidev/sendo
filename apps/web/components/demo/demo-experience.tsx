"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { DemoInboxSnapshot } from "@/lib/demo/protocol";
import { DemoChat } from "./demo-chat";
import { DEMO_FRAME_PATH, isFrameMessage, type HostToFrame } from "./frame-protocol";
import { useDemoConversation } from "./use-demo-conversation";

/**
 * The live demo (AC-ST-2): the visitor's WhatsApp chat next to the real `inbox`, which runs
 * in an iframe (`/demo/inbox`) so its responsive layout follows the space it gets, not the
 * page's width. Used by the landing and by /demo.
 */
export function DemoExperience({
  className,
  chatClassName,
}: {
  className?: string;
  chatClassName?: string;
}) {
  const demo = useDemoConversation();
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

  return (
    <div className={cn("flex flex-col gap-3 md:flex-row", className)}>
      <DemoChat
        className={cn("h-[460px] md:h-auto md:w-[320px] md:shrink-0", chatClassName)}
        transcript={demo.transcript}
        restored={demo.restored}
        pending={demo.pending}
        remaining={demo.remaining}
        fallback={demo.fallback}
        error={demo.error}
        onSend={(text) => {
          void demo.send(text);
        }}
        onReset={() => {
          demo.reset();
          setFrameKey((key) => key + 1);
        }}
      />
      <iframe
        key={frameKey}
        ref={frame}
        src={DEMO_FRAME_PATH}
        title="Bandeja de Sendo (demo)"
        className="h-[620px] min-w-0 flex-1 rounded-xl border bg-background md:h-auto"
      />
    </div>
  );
}
