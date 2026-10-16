"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { InboxMessageView } from "@/components/sendo/types";
import { demo as demoDictionary } from "@/lib/i18n/dictionaries/demo";
import type { Lang } from "@/lib/i18n/langs";
import {
  DEMO_SESSION_LIMIT,
  DEMO_TOKEN_HEADER,
  type DemoErrorResponse,
  type DemoFallbackReason,
  type DemoInboxSnapshot,
  type DemoRequest,
  type DemoResponse,
  type DemoTurn,
} from "@/lib/demo/protocol";

// The browser side of the stateless demo: it owns the transcript (kept in sessionStorage, so the
// landing and /demo share one conversation per tab), the latest inbox snapshot and the signed
// session counter the server hands back (sessionStorage too, sent in a header: no cookie).

const STORAGE_KEY = "sendo-demo:v1";
/** Kept apart from the conversation so "start over" doesn't reset the session limit. */
const TOKEN_KEY = "sendo-demo:token";

interface Stored {
  transcript: DemoTurn[];
  snapshot: DemoInboxSnapshot | null;
  remaining: number;
}

interface StoreState extends Stored {
  /** Turns that were already stored when the page loaded. */
  restored: number;
  /** Server answers received since the page loaded (each one brings a new snapshot). */
  revision: number;
}

/**
 * Where the visitor is in the demo (the home page's step strip reads it):
 * `idle` before the first message, `sent` while a message is on its way (or nobody answered yet),
 * `replied` once the agent, a handoff or the team answered.
 */
export type DemoStage = "idle" | "sent" | "replied";

export interface DemoConversation {
  stage: DemoStage;
  transcript: DemoTurn[];
  /** Turns loaded from sessionStorage on mount. */
  restored: number;
  snapshot: DemoInboxSnapshot | null;
  /**
   * Increments every time a server answer brings a new snapshot (0 after a page load, even with
   * a restored snapshot). Watch it to react to "the inbox just changed" (e.g. an unread badge).
   */
  snapshotRevision: number;
  /** A contact message is on its way (the agent is "typing"). */
  pending: boolean;
  remaining: number;
  /** Why the scripted fallback answered the last message (`null`: the model did). */
  fallback: DemoFallbackReason | null;
  /** Localized error of the last request, shown in the chat (never an error page). */
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
  revision: 0,
};
let state: StoreState | null = null;
const listeners = new Set<() => void>();

function current(): StoreState {
  if (state === null) {
    const stored = load();
    state =
      stored === null ? EMPTY : { ...stored, restored: stored.transcript.length, revision: 0 };
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

function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Without storage the server counts the session from the transcript alone.
  }
}

async function post(
  body: DemoRequest,
  errors: { server: string; offline: string },
): Promise<DemoResponse | string> {
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const token = readToken();
    if (token !== null) headers[DEMO_TOKEN_HEADER] = token;
    const response = await fetch("/api/demo", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as DemoErrorResponse | null;
      if (error !== null) console.warn("[sendo demo]", error.error, error.message);
      return errors.server;
    }
    const result = (await response.json()) as DemoResponse;
    writeToken(result.token);
    return result;
  } catch {
    return errors.offline;
  }
}

function stageOf(transcript: DemoTurn[], pending: boolean): DemoStage {
  if (pending) return "sent";
  if (transcript.length === 0) return "idle";
  return transcript.some((turn) => turn.role !== "contact") ? "replied" : "sent";
}

/** The demo conversation of this tab; `lang` is the page language (server copy and errors). */
export function useDemoConversation(lang: Lang): DemoConversation {
  const t = demoDictionary[lang].chat.errors;
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
        revision: before.revision + 1,
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
      const result = await post({ transcript: current().transcript, text: body, lang }, t);
      busy.current = false;
      setOptimistic(null);
      if (typeof result === "string") {
        setError(result);
        return;
      }
      apply(result);
    },
    [apply, lang, t],
  );

  const teamReply = useCallback<DemoConversation["teamReply"]>(
    async (text) => {
      const result = await post({ transcript: current().transcript, text, from: "team", lang }, t);
      if (typeof result === "string") return { ok: false, message: result };
      apply(result);
      const message = result.inbox.thread.findLast(
        (item) => item.sender === "human" && !item.internal && item.text === result.turn.text,
      );
      return message === undefined ? { ok: false, message: t.notSaved } : { ok: true, message };
    },
    [apply, lang, t],
  );

  const reset = useCallback(() => {
    const before = current();
    update({ ...EMPTY, remaining: before.remaining, revision: before.revision }, false);
    setFallback(null);
    setError(null);
  }, []);

  return {
    stage: stageOf(stored.transcript, optimistic !== null),
    transcript: optimistic === null ? stored.transcript : [...stored.transcript, optimistic],
    restored: stored.restored,
    snapshot: stored.snapshot,
    snapshotRevision: stored.revision,
    pending: optimistic !== null,
    remaining: stored.remaining,
    fallback,
    error,
    send,
    teamReply,
    reset,
  };
}
