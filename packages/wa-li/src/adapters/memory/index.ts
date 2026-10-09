import { DuplicateAccountError, RecordNotFoundError } from "../../errors";
import type {
  Account,
  Contact,
  Conversation,
  JsonObject,
  Media,
  Message,
  MessageError,
  MessageWithMedia,
  Page,
  Template,
  WaEvent,
} from "../../types/entities";
import type { DeliveryStatus, MessageStatus } from "../../types/enums";
import { WA_SCHEMA_VERSION } from "../../utils/schema-version";
import { canTransition, nextStatus } from "../../utils/status";
import type {
  ConversationListItem,
  ConversationPatch,
  StatusUpdateResult,
  WaTable,
  WhatsAppAdapter,
} from "../types";
import { WA_TABLES } from "../types";

export interface MemoryAdapterOptions {
  /** Clock used for every timestamp and lock expiry. Default: `() => new Date()`. */
  now?: () => Date;
  /** Prefix of `storage.signedUrl` results. Default `memory://wa-li-media`. */
  signedUrlBase?: string;
  /** Value returned by `schemaVersion()`. `null` simulates missing tables. Default `WA_SCHEMA_VERSION`. */
  schemaVersion?: number | null;
  /** Tables `healthCheck` reports as missing (for doctor tests). Default none. */
  missingTables?: readonly WaTable[];
  /** Value returned by `storage.bucketExists()`. Default `true`. */
  bucketExists?: boolean;
}

/** A status that arrived before its outbound row got the Meta id (adapter-internal). */
export interface MemoryPlaceholder {
  metaMessageId: string;
  status: MessageStatus;
  error: MessageError | null;
  createdAt: Date;
}

type Sequenced<T> = T & { seq: number };

export interface MemoryState {
  accounts: Map<string, Sequenced<Account>>;
  contacts: Map<string, Contact>;
  conversations: Map<string, Sequenced<Conversation>>;
  messages: Map<string, Sequenced<Message>>;
  /** Keyed by Meta message id. */
  placeholders: Map<string, MemoryPlaceholder>;
  media: Map<string, Sequenced<Media>>;
  templates: Map<string, Sequenced<Template>>;
  events: Map<string, WaEvent>;
  /** Lock key → expiry (epoch ms). */
  locks: Map<string, number>;
  storage: Map<string, { bytes: Uint8Array; mime: string }>;
}

/**
 * In-memory `WhatsAppAdapter` plus test/fixture helpers.
 * - `__state`: the raw maps (read-only use recommended; returned records are copies).
 * - `reset()`: empties every map, e.g. between fixture loads in the playground.
 *
 * Seed fixtures through the adapter methods; to control timestamps, pass a mutable
 * `now` clock and move it between calls.
 */
export type MemoryAdapter = WhatsAppAdapter & {
  readonly __state: MemoryState;
  reset(): void;
};

const DEFAULT_TIMEZONE = "America/Guatemala";

function createState(): MemoryState {
  return {
    accounts: new Map(),
    contacts: new Map(),
    conversations: new Map(),
    messages: new Map(),
    placeholders: new Map(),
    media: new Map(),
    templates: new Map(),
    events: new Map(),
    locks: new Map(),
    storage: new Map(),
  };
}

function run<T>(fn: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(fn());
  });
}

function strip<T extends { seq: number }>(record: T): Omit<T, "seq"> {
  const { seq: _seq, ...rest } = record;
  return structuredClone(rest);
}

function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function assignDefined<T extends object>(target: T, patch: Partial<T>): void {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value !== undefined) target[key] = value;
  }
}

function templateKey(accountId: string, name: string, language: string): string {
  return JSON.stringify([accountId, name, language]);
}

export function memoryAdapter(opts: MemoryAdapterOptions = {}): MemoryAdapter {
  const now = opts.now ?? (() => new Date());
  const signedUrlBase = (opts.signedUrlBase ?? "memory://wa-li-media").replace(/\/+$/, "");
  const missingTables = WA_TABLES.filter((t) => opts.missingTables?.includes(t) ?? false);
  const version = opts.schemaVersion === undefined ? WA_SCHEMA_VERSION : opts.schemaVersion;

  let state = createState();
  let seq = 0;
  const nextSeq = (): number => ++seq;

  const requireConversation = (id: string): Sequenced<Conversation> => {
    const c = state.conversations.get(id);
    if (!c) throw new RecordNotFoundError({ entity: "conversation", id });
    return c;
  };
  const requireMessage = (id: string): Sequenced<Message> => {
    const m = state.messages.get(id);
    if (!m) throw new RecordNotFoundError({ entity: "message", id });
    return m;
  };
  const requireContact = (id: string): Contact => {
    const c = state.contacts.get(id);
    if (!c) throw new RecordNotFoundError({ entity: "contact", id });
    return c;
  };

  const mediaFor = (messageId: string): Media | null => {
    let found: Sequenced<Media> | null = null;
    for (const m of state.media.values()) {
      if (m.messageId === messageId && (!found || m.seq > found.seq)) found = m;
    }
    return found ? strip(found) : null;
  };
  const withMedia = (m: Sequenced<Message>): MessageWithMedia => ({
    ...strip(m),
    media: mediaFor(m.id),
  });
  const findByMetaId = (metaMessageId: string): Sequenced<Message> | undefined => {
    for (const m of state.messages.values()) {
      if (m.metaMessageId === metaMessageId) return m;
    }
    return undefined;
  };

  const compareMessagesDesc = (a: Sequenced<Message>, b: Sequenced<Message>): number =>
    b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq;
  const conversationMessagesDesc = (conversationId: string): Sequenced<Message>[] =>
    [...state.messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort(compareMessagesDesc);

  const compareConversationsDesc = (a: Conversation, b: Conversation): number =>
    b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  const adapter: MemoryAdapter = {
    get __state() {
      return state;
    },
    reset() {
      state = createState();
      seq = 0;
    },

    accounts: {
      getByPhoneNumberId: (phoneNumberId) =>
        run(() => {
          for (const a of state.accounts.values()) {
            if (a.phoneNumberId === phoneNumberId) return strip(a);
          }
          return null;
        }),
      getById: (id) =>
        run(() => {
          const a = state.accounts.get(id);
          return a ? strip(a) : null;
        }),
      list: (filter = {}) =>
        run(() =>
          [...state.accounts.values()]
            .filter((a) => filter.tenantId === undefined || a.tenantId === filter.tenantId)
            .filter((a) => filter.active === undefined || a.active === filter.active)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.seq - b.seq)
            .map(strip),
        ),
      insert: (input) =>
        run(() => {
          for (const a of state.accounts.values()) {
            if (a.phoneNumberId === input.phoneNumberId) {
              throw new DuplicateAccountError({ phoneNumberId: input.phoneNumberId });
            }
          }
          const account: Sequenced<Account> = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId ?? null,
            phoneNumberId: input.phoneNumberId,
            wabaId: input.wabaId,
            displayPhone: input.displayPhone,
            tokenRef: input.tokenRef,
            timezone: input.timezone ?? DEFAULT_TIMEZONE,
            active: input.active ?? true,
            createdAt: now(),
            seq: nextSeq(),
          };
          state.accounts.set(account.id, account);
          return strip(account);
        }),
    },

    contacts: {
      upsert: (input) =>
        run(() => {
          for (const c of state.contacts.values()) {
            if (c.accountId !== input.accountId || c.phone !== input.phone) continue;
            const profileChanged = input.profileName != null && input.profileName !== c.profileName;
            if (input.waId != null) c.waId = input.waId;
            if (input.profileName != null) c.profileName = input.profileName;
            return { contact: structuredClone(c), created: false, profileChanged };
          }
          const contact: Contact = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            accountId: input.accountId,
            phone: input.phone,
            waId: input.waId ?? null,
            profileName: input.profileName ?? null,
            appRef: null,
            marketingOptIn: false,
            optInAt: null,
          };
          state.contacts.set(contact.id, contact);
          return { contact: structuredClone(contact), created: true, profileChanged: false };
        }),
      get: (id) =>
        run(() => {
          const c = state.contacts.get(id);
          return c ? structuredClone(c) : null;
        }),
      setAppRef: (id, appRef) =>
        run(() => {
          const c = requireContact(id);
          c.appRef = appRef;
          return structuredClone(c);
        }),
    },

    conversations: {
      getOpenOrCreate: (input) =>
        run(() => {
          const mine = [...state.conversations.values()]
            .filter((c) => c.contactId === input.contactId && c.accountId === input.accountId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.seq - a.seq);
          const open = mine.find((c) => c.status !== "closed");
          if (open) return { conversation: strip(open), created: false, reopened: false };
          const closed = mine[0];
          if (closed) {
            closed.status = "agent";
            closed.assignedTo = null;
            closed.handoffReason = null;
            return { conversation: strip(closed), created: false, reopened: true };
          }
          const at = now();
          const conversation: Sequenced<Conversation> = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            accountId: input.accountId,
            contactId: input.contactId,
            status: "agent",
            assignedTo: null,
            handoffReason: null,
            lastInboundAt: null,
            lastActivityAt: at,
            windowExpiresAt: null,
            unreadCount: 0,
            createdAt: at,
            seq: nextSeq(),
          };
          state.conversations.set(conversation.id, conversation);
          return { conversation: strip(conversation), created: true, reopened: false };
        }),
      get: (id) =>
        run(() => {
          const c = state.conversations.get(id);
          return c ? strip(c) : null;
        }),
      update: (id, patch: ConversationPatch) =>
        run(() => {
          const c = requireConversation(id);
          const { incrementUnread, ...fields } = patch;
          assignDefined<Conversation>(c, fields);
          if (incrementUnread) c.unreadCount += incrementUnread;
          return strip(c);
        }),
      list: (query) =>
        run((): Page<ConversationListItem> => {
          const statuses =
            query.status === undefined
              ? null
              : Array.isArray(query.status)
                ? query.status
                : [query.status];
          const cursor = decodeCursor(query.cursor);
          const afterCursor = (c: Conversation): boolean => {
            if (!cursor || typeof cursor.t !== "number" || typeof cursor.id !== "string") {
              return true;
            }
            const t = c.lastActivityAt.getTime();
            return t < cursor.t || (t === cursor.t && c.id < cursor.id);
          };
          const matches = [...state.conversations.values()]
            .filter((c) => query.tenantId === undefined || c.tenantId === query.tenantId)
            .filter((c) => query.accountId === undefined || c.accountId === query.accountId)
            .filter((c) => statuses === null || statuses.includes(c.status))
            .filter((c) => query.assignedTo === undefined || c.assignedTo === query.assignedTo)
            .sort(compareConversationsDesc)
            .filter(afterCursor);
          const page = matches.slice(0, query.limit);
          const last = page.at(-1);
          const items = page.map((c): ConversationListItem => {
            const contact = state.contacts.get(c.contactId);
            if (!contact) throw new RecordNotFoundError({ entity: "contact", id: c.contactId });
            const lastMessage = conversationMessagesDesc(c.id)[0];
            return {
              ...strip(c),
              contact: structuredClone(contact),
              lastMessage: lastMessage ? strip(lastMessage) : null,
            };
          });
          return {
            items,
            nextCursor:
              matches.length > query.limit && last
                ? encodeCursor({ t: last.lastActivityAt.getTime(), id: last.id })
                : null,
          };
        }),
    },

    messages: {
      insertInbound: (input) =>
        run(() => {
          if (findByMetaId(input.metaMessageId)) return null;
          const message: Sequenced<Message> = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            direction: "in",
            type: input.type,
            content: structuredClone(input.content),
            text: input.text ?? null,
            metaMessageId: input.metaMessageId,
            replyToMetaId: input.replyToMetaId ?? null,
            status: "received",
            error: null,
            sender: "contact",
            senderRef: null,
            metadata: structuredClone(input.metadata ?? {}),
            sentAt: input.sentAt,
            createdAt: now(),
            seq: nextSeq(),
          };
          state.messages.set(message.id, message);
          return strip(message);
        }),
      insertOutbound: (input) =>
        run(() => {
          const message: Sequenced<Message> = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            direction: "out",
            type: input.type,
            content: structuredClone(input.content),
            text: input.text ?? null,
            metaMessageId: null,
            replyToMetaId: input.replyToMetaId ?? null,
            status: "pending",
            error: null,
            sender: input.sender,
            senderRef: input.senderRef ?? null,
            metadata: structuredClone(input.metadata ?? {}),
            sentAt: null,
            createdAt: now(),
            seq: nextSeq(),
          };
          state.messages.set(message.id, message);
          return strip(message);
        }),
      markSent: (id, metaMessageId) =>
        run(() => {
          const m = requireMessage(id);
          m.metaMessageId = metaMessageId;
          m.status = nextStatus(m.status, "sent");
          m.sentAt ??= now();
          const placeholder = state.placeholders.get(metaMessageId);
          if (placeholder) {
            if (canTransition(m.status, placeholder.status)) {
              m.status = placeholder.status;
              if (placeholder.status === "failed") m.error = placeholder.error;
            }
            state.placeholders.delete(metaMessageId);
          }
          return strip(m);
        }),
      markFailed: (id, error) =>
        run(() => {
          const m = requireMessage(id);
          m.status = "failed";
          m.error = structuredClone(error);
          return strip(m);
        }),
      updateStatus: (metaMessageId, status: DeliveryStatus, options = {}) =>
        run((): StatusUpdateResult => {
          const m = findByMetaId(metaMessageId);
          if (m) {
            if (!canTransition(m.status, status)) return "ignored";
            m.status = status;
            if (status === "failed") m.error = structuredClone(options.error ?? null);
            if (status === "sent") m.sentAt ??= options.at ?? now();
            return "updated";
          }
          const existing = state.placeholders.get(metaMessageId);
          if (existing) {
            if (canTransition(existing.status, status)) {
              existing.status = status;
              if (status === "failed") existing.error = structuredClone(options.error ?? null);
            }
          } else {
            state.placeholders.set(metaMessageId, {
              metaMessageId,
              status,
              error: status === "failed" ? structuredClone(options.error ?? null) : null,
              createdAt: now(),
            });
          }
          return "placeholder";
        }),
      get: (id) =>
        run(() => {
          const m = state.messages.get(id);
          return m ? withMedia(m) : null;
        }),
      getByMetaId: (metaMessageId) =>
        run(() => {
          const m = findByMetaId(metaMessageId);
          return m ? withMedia(m) : null;
        }),
      history: (conversationId, limit) =>
        run(() =>
          conversationMessagesDesc(conversationId).slice(0, limit).reverse().map(withMedia),
        ),
      thread: (conversationId, query) =>
        run((): Page<MessageWithMedia> => {
          const cursor = decodeCursor(query.cursor);
          const all = conversationMessagesDesc(conversationId);
          const older =
            cursor && typeof cursor.t === "number" && typeof cursor.s === "number"
              ? all.filter((m) => {
                  const t = m.createdAt.getTime();
                  return (
                    t < (cursor.t as number) || (t === cursor.t && m.seq < (cursor.s as number))
                  );
                })
              : all;
          const page = older.slice(0, query.limit);
          const last = page.at(-1);
          return {
            items: page.map(withMedia),
            nextCursor:
              older.length > query.limit && last
                ? encodeCursor({ t: last.createdAt.getTime(), s: last.seq })
                : null,
          };
        }),
      countInboundSince: (contactId, since) =>
        run(() => {
          const conversationIds = new Set(
            [...state.conversations.values()]
              .filter((c) => c.contactId === contactId)
              .map((c) => c.id),
          );
          return [...state.messages.values()].filter(
            (m) =>
              m.direction === "in" &&
              conversationIds.has(m.conversationId) &&
              m.createdAt.getTime() >= since.getTime(),
          ).length;
        }),
      updateMetadata: (id, patch: JsonObject) =>
        run(() => {
          const m = requireMessage(id);
          m.metadata = { ...m.metadata, ...structuredClone(patch) };
          return strip(m);
        }),
    },

    media: {
      insert: (input) =>
        run(() => {
          const media: Sequenced<Media> = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            messageId: input.messageId,
            metaMediaId: input.metaMediaId ?? null,
            mimeType: input.mimeType ?? null,
            sizeBytes: input.sizeBytes ?? null,
            sha256: input.sha256 ?? null,
            storagePath: input.storagePath ?? null,
            downloadStatus: input.downloadStatus ?? "pending",
            seq: nextSeq(),
          };
          state.media.set(media.id, media);
          return strip(media);
        }),
      update: (id, patch) =>
        run(() => {
          const media = state.media.get(id);
          if (!media) throw new RecordNotFoundError({ entity: "media", id });
          assignDefined<Media>(media, patch);
          return strip(media);
        }),
    },

    templates: {
      upsertMany: (accountId, templates) =>
        run(() =>
          templates.map((input) => {
            const key = templateKey(accountId, input.name, input.language);
            const existing = state.templates.get(key);
            const template: Sequenced<Template> = {
              id: existing?.id ?? crypto.randomUUID(),
              accountId,
              name: input.name,
              language: input.language,
              category: input.category,
              status: input.status,
              components: structuredClone(input.components),
              variableCount: input.variableCount,
              active: true,
              syncedAt: input.syncedAt ?? now(),
              seq: existing?.seq ?? nextSeq(),
            };
            state.templates.set(key, template);
            return strip(template);
          }),
        ),
      markInactiveExcept: (accountId, keep) =>
        run(() => {
          const kept = new Set(keep.map((k) => templateKey(accountId, k.name, k.language)));
          let changed = 0;
          for (const [key, t] of state.templates) {
            if (t.accountId === accountId && t.active && !kept.has(key)) {
              t.active = false;
              changed++;
            }
          }
          return changed;
        }),
      list: (query = {}) =>
        run(() =>
          [...state.templates.values()]
            .filter((t) => query.accountId === undefined || t.accountId === query.accountId)
            .filter((t) => query.status === undefined || t.status === query.status)
            .filter((t) => query.active === undefined || t.active === query.active)
            .sort((a, b) => a.seq - b.seq)
            .map(strip),
        ),
      get: (accountId, name, language) =>
        run(() => {
          const t = state.templates.get(templateKey(accountId, name, language));
          return t ? strip(t) : null;
        }),
    },

    events: {
      insert: (input) =>
        run(() => {
          const event: WaEvent = {
            id: crypto.randomUUID(),
            receivedAt: now(),
            payload: structuredClone(input.payload),
            status: "received",
            error: null,
            processedAt: null,
          };
          state.events.set(event.id, event);
          return structuredClone(event);
        }),
      setStatus: (id, status, error) =>
        run(() => {
          const event = state.events.get(id);
          if (!event) throw new RecordNotFoundError({ entity: "event", id });
          event.status = status;
          event.error = error ?? null;
          if (status !== "received") event.processedAt = now();
          return structuredClone(event);
        }),
      get: (id) =>
        run(() => {
          const event = state.events.get(id);
          return event ? structuredClone(event) : null;
        }),
      prune: (olderThan) =>
        run(() => {
          let count = 0;
          for (const [id, event] of state.events) {
            if (event.receivedAt.getTime() < olderThan.getTime()) {
              state.events.delete(id);
              count++;
            }
          }
          return count;
        }),
    },

    locks: {
      acquire: (key, ttlMs) =>
        run(() => {
          const t = now().getTime();
          const expiresAt = state.locks.get(key);
          if (expiresAt !== undefined && expiresAt > t) return false;
          state.locks.set(key, t + ttlMs);
          return true;
        }),
      release: (key) =>
        run(() => {
          state.locks.delete(key);
        }),
    },

    storage: {
      put: (path, bytes, mime) =>
        run(() => {
          state.storage.set(path, { bytes: bytes.slice(), mime });
        }),
      get: (path) => run(() => state.storage.get(path)?.bytes.slice() ?? null),
      signedUrl: (path, ttlSec) =>
        run(() => {
          const expires = Math.floor(now().getTime() / 1000) + ttlSec;
          const encodedPath = path.split("/").map(encodeURIComponent).join("/");
          return `${signedUrlBase}/${encodedPath}?expires=${expires}&token=${crypto.randomUUID()}`;
        }),
      bucketExists: () => run(() => opts.bucketExists ?? true),
    },

    schemaVersion: () => run(() => (missingTables.includes("wa_schema_meta") ? null : version)),
    healthCheck: () =>
      run(() => ({ tablesOk: missingTables.length === 0, missing: [...missingTables] })),
  };

  return adapter;
}
