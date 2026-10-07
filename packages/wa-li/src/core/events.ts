import type { MetaApiError } from "../errors/meta-api-error";
import type { Account, Contact, Conversation, Message, MessageError } from "../types/entities";
import type { ConversationStatus, DeliveryStatus } from "../types/enums";
import type { RedactingLogger } from "../utils/logger";
import type { Reply } from "./reply";

export interface MessageEvent {
  message: Message;
  contact: Contact;
  conversation: Conversation;
  account: Account;
  /** Sends into this conversation (stored with the reply's sender). */
  reply: Reply;
}

export interface StatusEvent {
  message: Message;
  status: DeliveryStatus;
  error?: MessageError;
}

export interface HandoffEvent {
  conversation: Conversation;
  contact: Contact;
  account: Account;
  reason: string;
  /** User ids returned by `resolveHandoffTargets` (empty when none is configured). */
  assignees: string[];
}

export interface ConversationStatusEvent {
  conversation: Conversation;
  from: ConversationStatus;
  to: ConversationStatus;
  /** `"system"`, an agent name or a user id. */
  by: string;
}

export interface AccountErrorEvent {
  account: Account;
  error: MetaApiError;
}

export interface UnroutedEvent {
  phoneNumberId: string;
  raw: unknown;
}

export interface WhatsAppEventMap {
  message: MessageEvent;
  status: StatusEvent;
  handoff: HandoffEvent;
  "conversation.status": ConversationStatusEvent;
  "account.error": AccountErrorEvent;
  "event.unrouted": UnroutedEvent;
}

export type WhatsAppEventName = keyof WhatsAppEventMap;

export type WhatsAppEventHandler<E extends WhatsAppEventName> = (
  payload: WhatsAppEventMap[E],
) => void | Promise<void>;

export interface WhatsAppEmitter {
  on<E extends WhatsAppEventName>(event: E, handler: WhatsAppEventHandler<E>): () => void;
  /** Runs handlers one after another. A throwing handler is logged and skipped; never rejects. */
  emit<E extends WhatsAppEventName>(event: E, payload: WhatsAppEventMap[E]): Promise<void>;
  listenerCount(event: WhatsAppEventName): number;
}

type AnyHandler = (payload: unknown) => void | Promise<void>;

export function createEmitter(logger: RedactingLogger): WhatsAppEmitter {
  const handlers = new Map<WhatsAppEventName, Set<AnyHandler>>();

  return {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      const typed = handler as AnyHandler;
      // Each registration is its own entry, so registering the same function twice works.
      const entry: AnyHandler = (payload) => typed(payload);
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },
    async emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          await handler(payload);
        } catch (error) {
          logger.error(`[wa-li] "${event}" handler failed`, error);
        }
      }
    },
    listenerCount(event) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}
