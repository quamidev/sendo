import { vi } from "vitest";
import type {
  InboxActionResult,
  InboxActions,
  InboxConversationView,
  InboxMessageView,
  InboxTemplateView,
} from "../items/inbox/components/sendo/types";

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
    internal: false,
    systemLine: null,
    draft: false,
    handoffAfterDraft: false,
    approvedBy: null,
    edited: false,
    origin: null,
    source: null,
    tokensIn: null,
    tokensOut: null,
    costCents: null,
    transcription: null,
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

export function makeConversation(
  overrides: Partial<InboxConversationView> = {},
): InboxConversationView {
  const now = Date.now();
  return {
    id: "conv-1",
    accountId: "acc-1",
    tenantId: "tenant-1",
    channel: "whatsapp",
    status: "agent",
    source: null,
    queue: null,
    assignedTo: null,
    assignee: null,
    handoffReason: null,
    handoff: null,
    agentPaused: false,
    agentPausedOn: null,
    hasPendingDraft: false,
    accountActive: true,
    tags: [],
    unreadCount: 0,
    lastActivityAt: new Date(now - 5 * 60_000).toISOString(),
    lastInboundAt: new Date(now - 5 * 60_000).toISOString(),
    window: { open: true, expiresAt: new Date(now + 20 * 60 * 60_000).toISOString() },
    contact: {
      id: "contact-1",
      phone: "+50255550001",
      displayName: "Diego Hernández",
      appRef: null,
    },
    lastMessagePreview: null,
    appHref: null,
    ...overrides,
  };
}

/** Every action resolves with empty data unless overridden; conversation actions echo `conversation`. */
export function makeActions(
  overrides: Partial<InboxActions> = {},
  conversation: InboxConversationView = makeConversation(),
): InboxActions {
  const view = () => Promise.resolve(ok(conversation));
  return {
    list: vi.fn(() =>
      Promise.resolve(ok({ items: [conversation], nextCursor: null, counts: null })),
    ),
    thread: vi.fn(() => Promise.resolve(ok({ items: [], nextCursor: null, names: {} }))),
    reply: vi.fn(() => Promise.resolve(ok(makeMessage({ direction: "out", sender: "human" })))),
    markSeen: vi.fn(() => Promise.resolve(ok(null))),
    take: vi.fn(view),
    assign: vi.fn(view),
    returnToAgent: vi.fn(view),
    close: vi.fn(view),
    pauseAgent: vi.fn(view),
    approveDraft: vi.fn(() =>
      Promise.resolve(ok(makeMessage({ id: "sent-1", direction: "out", sender: "agent" }))),
    ),
    discardDraft: vi.fn(() => Promise.resolve(ok(null))),
    addTag: vi.fn(() => Promise.resolve(ok([]))),
    removeTag: vi.fn(() => Promise.resolve(ok([]))),
    listAssignees: vi.fn(() => Promise.resolve(ok([]))),
    listTags: vi.fn(() => Promise.resolve(ok([]))),
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
