"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { InboxMessageView } from "@/components/sendo/types";
import {
  DEMO_SESSION_LIMIT,
  type DemoErrorResponse,
  type DemoFallbackReason,
  type DemoInboxSnapshot,
  type DemoRequest,
  type DemoResponse,
  type DemoTurn,
} from "@/lib/demo/protocol";

// The browser side of the stateless demo: it owns the transcript (kept in sessionStorage, so the
// landing and /demo share one conversation per tab) and the latest inbox snapshot.

const STORAGE_KEY = "sendo-demo:v1";

interface Stored {
  transcript: DemoTurn[];
  snapshot: DemoInboxSnapshot | null;
  remaining: number;
}

interface StoreState extends Stored {
  /** Turns that were already stored when the page loaded. */
  restored: number;
}

export interface DemoConversation {
  transcript: DemoTurn[];
  /** Turns loaded from sessionStorage on mount. */
  restored: number;
  snapshot: DemoInboxSnapshot | null;
  /** A contact message is on its way (the agent is "typing"). */
  pending: boolean;
  remaining: number;
  fallback: DemoFallbackReason | null;
  error: string | null;
  send(text: string): Promise<void>;
  /** A step-in reply typed in the demo inbox. */
  teamReply(
    text: string,
  ): Promise<{ ok: true; message: InboxMessageView } | { ok: false; message: string }>;
  reset(): void;
}

function load(): Stored | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(parsed.transcript)) return null;
    return {
      transcript: parsed.transcript,
      snapshot: parsed.snapshot ?? null,
      remaining: typeof parsed.remaining === "number" ? parsed.remaining : DEMO_SESSION_LIMIT,
    };
  } catch {
    return null;
  }
}

// One conversation per tab, shared by every demo on the page and restored from sessionStorage.
const EMPTY: StoreState = {
  transcript: [],
  snapshot: null,
  remaining: DEMO_SESSION_LIMIT,
  restored: 0,
};
let state: StoreState | null = null;
const listeners = new Set<() => void>();

function current(): StoreState {
  if (state === null) {
    const stored = load();
    state = stored === null ? EMPTY : { ...stored, restored: stored.transcript.length };
  }
  return state;
}

function update(next: StoreState, persist: boolean): void {
  state = next;
  try {
    if (!persist) window.sessionStorage.removeItem(STORAGE_KEY);
    else {
      const stored: Stored = {
        transcript: next.transcript,
        snapshot: next.snapshot,
        remaining: next.remaining,
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
  } catch {
    // Private mode or a full quota: the demo still works for this page.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function post(body: DemoRequest): Promise<DemoResponse | string> {
  try {
    const response = await fetch("/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as DemoErrorResponse | null;
      return error?.message ?? "La demo no respondió. Intenta de nuevo.";
    }
    return (await response.json()) as DemoResponse;
  } catch {
    return "Sin conexión con la demo. Intenta de nuevo.";
  }
}

export function useDemoConversation(): DemoConversation {
  const stored = useSyncExternalStore(subscribe, current, () => EMPTY);
  /** The contact message on its way, shown before the server answers. */
  const [optimistic, setOptimistic] = useState<DemoTurn | null>(null);
  const [fallback, setFallback] = useState<DemoFallbackReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const apply = useCallback((response: DemoResponse) => {
    const before = current();
    update(
      {
        transcript: [...before.transcript, response.turn, ...response.messages],
        snapshot: response.inbox,
        remaining: response.remaining,
        restored: before.restored,
      },
      true,
    );
    setFallback(response.fallback);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (body === "" || busy.current) return;
      busy.current = true;
      setError(null);
      setOptimistic({ role: "contact", text: body, at: new Date().toISOString() });
      const result = await post({ transcript: current().transcript, text: body });
      busy.current = false;
      setOptimistic(null);
      if (typeof result === "string") {
        setError(result);
        return;
      }
      apply(result);
    },
    [apply],
  );

  const teamReply = useCallback<DemoConversation["teamReply"]>(
    async (text) => {
      const result = await post({ transcript: current().transcript, text, from: "team" });
      if (typeof result === "string") return { ok: false, message: result };
      apply(result);
      const message = result.inbox.thread.findLast(
        (item) => item.sender === "human" && !item.internal && item.text === result.turn.text,
      );
      return message === undefined
        ? { ok: false, message: "La respuesta no quedó guardada." }
        : { ok: true, message };
    },
    [apply],
  );

  const reset = useCallback(() => {
    update({ ...EMPTY, remaining: current().remaining }, false);
    setFallback(null);
    setError(null);
  }, []);

  return {
    transcript: optimistic === null ? stored.transcript : [...stored.transcript, optimistic],
    restored: stored.restored,
    snapshot: stored.snapshot,
    pending: optimistic !== null,
    remaining: stored.remaining,
    fallback,
    error,
    send,
    teamReply,
    reset,
  };
}
