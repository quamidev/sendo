import type { MetaApiError } from "../errors/meta-api-error";
import type { TeamEventMap } from "../team/events";
import type {
  Account,
  Contact,
  Conversation,
  Message,
  MessageError,
  MessageWithMedia,
} from "../types/entities";
import type { ConversationStatus, DeliveryStatus } from "../types/enums";
import type { RedactingLogger } from "../utils/logger";
import type { Reply } from "./reply";

export interface MessageEvent {
  /** The stored inbound message, with its media row (`null` for non-media). */
  message: MessageWithMedia;
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
  /** `unknown_object`: no channel handles the body's `object`; `unknown_account`: no active account for the number. */
  reason: "unknown_object" | "unknown_account";
  /** The body's `object`, or null when missing. */
  object: string | null;
  /** Null when `reason` is `unknown_object`. */
  phoneNumberId: string | null;
  raw: unknown;
}

export interface SendoEventMap extends TeamEventMap {
  message: MessageEvent;
  status: StatusEvent;
  handoff: HandoffEvent;
  "conversation.status": ConversationStatusEvent;
  "account.error": AccountErrorEvent;
  "event.unrouted": UnroutedEvent;
}

export type SendoEventName = keyof SendoEventMap;

export type SendoEventHandler<E extends SendoEventName> = (
  payload: SendoEventMap[E],
) => void | Promise<void>;

export interface SendoEmitter {
  on<E extends SendoEventName>(event: E, handler: SendoEventHandler<E>): () => void;
  /** Runs handlers one after another. A throwing handler is logged and skipped; never rejects. */
  emit<E extends SendoEventName>(event: E, payload: SendoEventMap[E]): Promise<void>;
  listenerCount(event: SendoEventName): number;
}

type AnyHandler = (payload: unknown) => void | Promise<void>;

export function createEmitter(logger: RedactingLogger): SendoEmitter {
  const handlers = new Map<SendoEventName, Set<AnyHandler>>();

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
          logger.error(`[sendo] "${event}" handler failed`, error);
        }
      }
    },
    listenerCount(event) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}
