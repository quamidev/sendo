import { vi } from "vitest";
import type {
  InboxActionResult,
  InboxActions,
  InboxConversationPatch,
  InboxMessageView,
  InboxTemplateView,
} from "../items/sendo-inbox/components/sendo/types";

export function ok<T>(data: T): InboxActionResult<T> {
  return { ok: true, data };
}

export function makeMessage(overrides: Partial<InboxMessageView> = {}): InboxMessageView {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    direction: "in",
    type: "text",
    text: "Hola",
    content: { body: "Hola" },
    sender: "contact",
    senderRef: null,
    status: "received",
    error: null,
    sentAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    createdAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    replyToMetaId: null,
    metaMessageId: "wamid.1",
    ...overrides,
  };
}

export function makeTemplate(overrides: Partial<InboxTemplateView> = {}): InboxTemplateView {
  return {
    id: "tpl-1",
    name: "recordatorio_cita",
    language: "es",
    category: "UTILITY",
    variableCount: 2,
    body: "Hola {{1}}, tu cita es el {{2}}.",
    ...overrides,
  };
}

export function makePatch(overrides: Partial<InboxConversationPatch> = {}): InboxConversationPatch {
  return {
    id: "conv-1",
    status: "human",
    assignedTo: null,
    handoffReason: null,
    unreadCount: 0,
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Every action resolves with empty data unless overridden. */
export function makeActions(overrides: Partial<InboxActions> = {}): InboxActions {
  const patch = (id: string) => Promise.resolve(ok(makePatch({ id })));
  return {
    list: vi.fn(() => Promise.resolve(ok({ items: [], nextCursor: null }))),
    thread: vi.fn(() => Promise.resolve(ok({ items: [], nextCursor: null }))),
    reply: vi.fn(() => Promise.resolve(ok(makeMessage({ direction: "out", sender: "human" })))),
    markSeen: vi.fn(patch),
    take: vi.fn(patch),
    returnToAgent: vi.fn(patch),
    close: vi.fn(patch),
    listTemplates: vi.fn(() => Promise.resolve(ok([makeTemplate()]))),
    ...overrides,
  };
}

/** `useIsDesktop()` reads `(min-width: 768px)`. */
export function mockViewport(desktop: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: desktop,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
}

/** `matchMedia` answering per query (unknown queries don't match). */
export function mockMediaQueries(matches: Record<string, boolean>): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: matches[query] ?? false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
}
