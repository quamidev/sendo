import type { InboxMessageView } from "@/components/sendo/types";
import type { DemoInboxSnapshot } from "@/lib/demo/protocol";

// postMessage protocol between the page with the demo chat (host) and the demo inbox iframe
// (`/demo/inbox`). Both are same-origin; each side also checks `event.source`.

export const DEMO_FRAME_PATH = "/demo/inbox";

export type FrameToHost =
  | { source: "sendo-demo-frame"; type: "ready" }
  /** A person replied to the demo conversation from the inbox. */
  | { source: "sendo-demo-frame"; type: "team-reply"; id: number; text: string };

export type HostToFrame =
  | { source: "sendo-demo-host"; type: "snapshot"; snapshot: DemoInboxSnapshot | null }
  | {
      source: "sendo-demo-host";
      type: "team-reply-result";
      id: number;
      result: { ok: true; message: InboxMessageView } | { ok: false; message: string };
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isFrameMessage(data: unknown): data is FrameToHost {
  return isObject(data) && data.source === "sendo-demo-frame" && typeof data.type === "string";
}

export function isHostMessage(data: unknown): data is HostToFrame {
  return isObject(data) && data.source === "sendo-demo-host" && typeof data.type === "string";
}
