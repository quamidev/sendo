import { NotImplementedError } from "../errors/errors";

export interface HandleWebhookOptions {
  /** Keeps background work alive after the Response (`after()` / `ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** Owned by WAL-2.7 (`src/core/pipeline/`). */
export type HandleWebhookSlot = (
  request: Request,
  opts?: HandleWebhookOptions,
) => Promise<Response>;

/** Owned by WAL-2.7. */
export interface EventsSlot {
  reprocess(eventId: string): Promise<unknown>;
}

/** Owned by WAL-2.7. */
export interface MaintenanceSlot {
  /** Deletes events older than `eventRetentionDays`; returns the count. */
  prune(): Promise<number>;
}

/** Owned by WAL-3.2 (`src/inbox/`); replace with the C7 types. */
export interface InboxSlot {
  list(...args: unknown[]): Promise<unknown>;
  thread(...args: unknown[]): Promise<unknown>;
  reply(...args: unknown[]): Promise<unknown>;
  markSeen(...args: unknown[]): Promise<unknown>;
}

/** Owned by WAL-3.1 (`src/agents/`); replace with the real `wa.agent(config)` type. */
export type AgentSlot = (...args: unknown[]) => unknown;

/**
 * Namespaces contributed by later modules. `createWhatsApp` reads them lazily
 * (getters), so a module installed by `WHATSAPP_MODULES` only has to assign
 * `ctx.slots.<name>`.
 */
export interface WhatsAppSlots {
  handleWebhook: HandleWebhookSlot;
  events: EventsSlot;
  maintenance: MaintenanceSlot;
  inbox: InboxSlot;
  agent: AgentSlot;
}

function rejectWith(feature: string): () => Promise<never> {
  return () => Promise.reject(new NotImplementedError(feature));
}

export function createStubSlots(): WhatsAppSlots {
  return {
    handleWebhook: rejectWith("wa.handleWebhook"),
    events: { reprocess: rejectWith("wa.events.reprocess") },
    maintenance: { prune: rejectWith("wa.maintenance.prune") },
    inbox: {
      list: rejectWith("wa.inbox.list"),
      thread: rejectWith("wa.inbox.thread"),
      reply: rejectWith("wa.inbox.reply"),
      markSeen: rejectWith("wa.inbox.markSeen"),
    },
    agent: () => {
      throw new NotImplementedError("wa.agent");
    },
  };
}
