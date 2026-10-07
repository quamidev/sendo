import { vi } from "vitest";
import type {
  InboxActionResult,
  InboxActions,
  InboxConversationPatch,
  InboxConversationView,
  InboxMessageView,
  InboxTemplateView,
} from "../items/wa-li-inbox/components/whatsapp/types";

const HOUR = 60 * 60_000;

export function ok<T>(data: T): InboxActionResult<T> {
  return { ok: true, data };
}

export function makeConversation(
  overrides: Partial<InboxConversationView> = {},
): InboxConversationView {
  const now = Date.now();
  return {
    id: "conv-1",
    accountId: "acc-1",
    tenantId: "tenant-1",
    status: "human",
    assignedTo: null,
    handoffReason: null,
    unreadCount: 0,
    lastActivityAt: new Date(now - 5 * 60_000).toISOString(),
    lastInboundAt: new Date(now - HOUR).toISOString(),
    window: { open: true, expiresAt: new Date(now + 23 * HOUR).toISOString() },
    contact: { id: "contact-1", phone: "+50255550001", displayName: "Ana Pérez", appRef: null },
    lastMessagePreview: null,
    ...overrides,
  };
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
