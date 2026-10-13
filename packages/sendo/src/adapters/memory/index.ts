import type { Channel } from "../../channels/types";
import {
  AccountStateError,
  ConstraintViolationError,
  DuplicateAccountError,
  RecordNotFoundError,
} from "../../errors";
import type {
  Account,
  Broadcast,
  BroadcastRecipient,
  Contact,
  Conversation,
  JsonObject,
  Media,
  Message,
  MessageError,
  MessageWithMedia,
  Page,
  Snippet,
  StoredRule,
  Tag,
  Template,
  TenantId,
  SendoEvent,
} from "../../types/entities";
import type { ConversationStatus, DeliveryStatus, MessageStatus } from "../../types/enums";
import { RULE_ORIGINS, RULE_TYPES, SNIPPET_VISIBILITIES, TAG_COLORS } from "../../types/enums";
import { SENDO_SCHEMA_VERSION } from "../../utils/schema-version";
import { canTransition, nextStatus } from "../../utils/status";
import type {
  AccountInsertInput,
  ContactUpsertInput,
  ConversationFilter,
  ConversationListItem,
  ConversationPatch,
  SnippetUpsertInput,
  StatusUpdateResult,
  SendoTable,
  SendoAdapter,
  TagUpsertInput,
} from "../types";
import { SENDO_TABLES } from "../types";
import type { MediaStore } from "../../media/types";
import { memoryBroadcasts } from "./broadcasts";
import { memoryMetrics } from "./metrics";
import {
  compareRules,
  compareSnippets,
  compareTags,
  searchNeedles,
  sortSourceCounts,
} from "../shared";

export interface MemoryAdapterOptions {
  /** Clock used for every timestamp and lock expiry. Default: `() => new Date()`. */
  now?: () => Date;
  /** Prefix of `storage.signedUrl` results. Default `memory://sendo-media`. */
  signedUrlBase?: string;
  /** Value returned by `schemaVersion()`. `null` simulates missing tables. Default `SENDO_SCHEMA_VERSION`. */
  schemaVersion?: number | null;
  /** Tables `healthCheck` reports as missing (for doctor tests). Default none. */
  missingTables?: readonly SendoTable[];
  /** Value returned by `storage.exists()`. Default `true`. */
  bucketExists?: boolean;
}

/** A status that arrived before its outbound row got the Meta id (adapter-internal). */
export interface MemoryPlaceholder {
  metaMessageId: string;
  status: MessageStatus;
  error: MessageError | null;
  createdAt: Date;
}

export type Sequenced<T> = T & { seq: number };

/** A `sendo_conversation_tags` row. */
export interface MemoryConversationTag {
  conversationId: string;
  tagId: string;
  tenantId: TenantId;
  addedBy: string | null;
  addedAt: Date;
}

export interface MemoryState {
  accounts: Map<string, Sequenced<Account>>;
  contacts: Map<string, Contact>;
  conversations: Map<string, Sequenced<Conversation>>;
  messages: Map<string, Sequenced<Message>>;
  /** Keyed by Meta message id. */
  placeholders: Map<string, MemoryPlaceholder>;
  media: Map<string, Sequenced<Media>>;
  templates: Map<string, Sequenced<Template>>;
  snippets: Map<string, Sequenced<Snippet>>;
  tags: Map<string, Sequenced<Tag>>;
  /** Keyed by `conversationTagKey(conversationId, tagId)`. */
  conversationTags: Map<string, MemoryConversationTag>;
  rules: Map<string, Sequenced<StoredRule>>;
  broadcasts: Map<string, Sequenced<Broadcast>>;
  broadcastRecipients: Map<string, Sequenced<BroadcastRecipient>>;
  events: Map<string, SendoEvent>;
  /** Lock key → expiry (epoch ms). */
  locks: Map<string, number>;
  storage: Map<string, { bytes: Uint8Array; mime: string }>;
}

/**
 * In-memory `SendoAdapter` plus test/fixture helpers.
 * - `__state`: the raw maps (read-only use recommended; returned records are copies).
 * - `reset()`: empties every map, e.g. between fixture loads in the playground.
 *
 * Seed fixtures through the adapter methods; to control timestamps, pass a mutable
 * `now` clock and move it between calls.
 */
export type MemoryAdapter = SendoAdapter & {
  /** In-memory `MediaStore` over `__state.storage`. */
  storage: MediaStore;
  readonly __state: MemoryState;
  reset(): void;
};

const DEFAULT_TIMEZONE = "America/Guatemala";
/** Channels whose accounts need `phoneNumberId` and `wabaId` (`sendo_accounts_whatsapp_ids`). */
const META_ID_CHANNELS: readonly Channel[] = ["whatsapp"];

function createState(): MemoryState {
  return {
    accounts: new Map(),
    contacts: new Map(),
    conversations: new Map(),
    messages: new Map(),
    placeholders: new Map(),
    media: new Map(),
    templates: new Map(),
    snippets: new Map(),
    tags: new Map(),
    conversationTags: new Map(),
    rules: new Map(),
    broadcasts: new Map(),
    broadcastRecipients: new Map(),
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

function conversationTagKey(conversationId: string, tagId: string): string {
  return JSON.stringify([conversationId, tagId]);
}

const OPEN_STATUSES: readonly ConversationStatus[] = ["agent", "human"];
const SHORTCUT_RE = /^[a-z0-9_-]{1,32}$/;
const TAG_NAME_MAX = 64;

function statusList(
  status: ConversationStatus | ConversationStatus[] | undefined,
): readonly ConversationStatus[] | null {
  if (status === undefined) return null;
  return Array.isArray(status) ? status : [status];
}

function includes(value: string | null, needle: string): boolean {
  return needle !== "" && value !== null && value.toLowerCase().includes(needle);
}

export function memoryAdapter(opts: MemoryAdapterOptions = {}): MemoryAdapter {
  const now = opts.now ?? (() => new Date());
  const signedUrlBase = (opts.signedUrlBase ?? "memory://sendo-media").replace(/\/+$/, "");
  const missingTables = SENDO_TABLES.filter((t) => opts.missingTables?.includes(t) ?? false);
  const version = opts.schemaVersion === undefined ? SENDO_SCHEMA_VERSION : opts.schemaVersion;

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

  /** Keyed on the phone when given, else on the channel user id (the DB identity rule). */
  const findContact = (
    accountId: string,
    phone: string | null,
    channelUserId: string | null,
  ): Contact | undefined => {
    for (const c of state.contacts.values()) {
      if (c.accountId !== accountId) continue;
      if (phone !== null ? c.phone === phone : c.channelUserId === channelUserId) return c;
    }
    return undefined;
  };
  const assertChannelUserIdFree = (input: ContactUpsertInput, ownerId: string | null): void => {
    if (input.channelUserId == null) return;
    for (const c of state.contacts.values()) {
      if (
        c.accountId === input.accountId &&
        c.channelUserId === input.channelUserId &&
        c.id !== ownerId
      ) {
        throw new ConstraintViolationError({
          constraint: "sendo_contacts_account_id_channel_user_id_key",
        });
      }
    }
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

  const requireAccount = (id: string): Sequenced<Account> => {
    const a = state.accounts.get(id);
    if (!a) throw new RecordNotFoundError({ entity: "account", id });
    return a;
  };
  const assertMetaIds = (a: Pick<Account, "channel" | "phoneNumberId" | "wabaId">): void => {
    if (META_ID_CHANNELS.includes(a.channel) && (a.phoneNumberId === null || a.wabaId === null)) {
      throw new ConstraintViolationError({ constraint: "sendo_accounts_whatsapp_ids" });
    }
  };
  /** The insert-input fields `reactivate` applies (`undefined` ones are skipped by `assignDefined`). */
  const reactivationFields = (input: AccountInsertInput): Partial<Account> => {
    const fields: Partial<Account> = {
      label: input.label,
      wabaId: input.wabaId,
      displayPhone: input.displayPhone,
      tokenRef: input.tokenRef,
      timezone: input.timezone,
      coexistence: input.coexistence,
      onboardedVia: input.onboardedVia,
      agentPaused: input.agentPaused,
      agentMode: input.agentMode,
      billingReady: input.billingReady,
      billingCheckedAt: input.billingCheckedAt,
    };
    return fields;
  };

  const conversationTagIds = (conversationId: string): Set<string> => {
    const ids = new Set<string>();
    for (const row of state.conversationTags.values()) {
      if (row.conversationId === conversationId) ids.add(row.tagId);
    }
    return ids;
  };

  const matchesFilter = (c: Conversation, filter: ConversationFilter): boolean => {
    const statuses = statusList(filter.status);
    if (filter.tenantId !== undefined && c.tenantId !== filter.tenantId) return false;
    if (filter.accountId !== undefined && c.accountId !== filter.accountId) return false;
    if (statuses !== null && !statuses.includes(c.status)) return false;
    if (filter.assignedTo !== undefined && c.assignedTo !== filter.assignedTo) return false;
    if (filter.queue !== undefined && c.queue !== filter.queue) return false;
    if (filter.visibleTo) {
      const { userId, queues } = filter.visibleTo;
      const visible =
        c.assignedTo === userId ||
        (c.assignedTo === null && (c.queue === null || queues.includes(c.queue)));
      if (!visible) return false;
    }
    if (filter.tagIds && filter.tagIds.length > 0) {
      const tags = conversationTagIds(c.id);
      if (!filter.tagIds.some((id) => tags.has(id))) return false;
    }
    const needles = searchNeedles(filter.search);
    if (needles) {
      const contact = state.contacts.get(c.contactId);
      if (!contact) return false;
      const found =
        includes(contact.profileName, needles.text) ||
        includes(contact.appRef, needles.text) ||
        includes(contact.phone, needles.phone);
      if (!found) return false;
    }
    return true;
  };

  const requireSnippet = (id: string): Sequenced<Snippet> => {
    const snippet = state.snippets.get(id);
    if (!snippet) throw new RecordNotFoundError({ entity: "snippet", id });
    return snippet;
  };
  const assertSnippet = (snippet: Snippet): void => {
    if (!SHORTCUT_RE.test(snippet.shortcut)) {
      throw new ConstraintViolationError({ constraint: "sendo_snippets_shortcut_check" });
    }
    if (!SNIPPET_VISIBILITIES.includes(snippet.visibility)) {
      throw new ConstraintViolationError({ constraint: "sendo_snippets_visibility_check" });
    }
    if ((snippet.visibility === "personal") !== (snippet.ownerUserId !== null)) {
      throw new ConstraintViolationError({ constraint: "sendo_snippets_owner_check" });
    }
    for (const other of state.snippets.values()) {
      if (
        other.id !== snippet.id &&
        other.tenantId === snippet.tenantId &&
        (other.ownerUserId ?? "") === (snippet.ownerUserId ?? "") &&
        other.shortcut === snippet.shortcut
      ) {
        throw new ConstraintViolationError({ constraint: "sendo_snippets_shortcut_key" });
      }
    }
  };
  const writeSnippet = (input: SnippetUpsertInput): Snippet => {
    const at = now();
    const existing = input.id === undefined ? undefined : state.snippets.get(input.id);
    if (input.id !== undefined && (!existing || existing.tenantId !== input.tenantId)) {
      throw new RecordNotFoundError({ entity: "snippet", id: input.id });
    }
    const next: Sequenced<Snippet> = existing
      ? {
          ...existing,
          accountId: input.accountId === undefined ? existing.accountId : input.accountId,
          shortcut: input.shortcut,
          body: input.body,
          visibility: input.visibility ?? existing.visibility,
          ownerUserId: input.ownerUserId === undefined ? existing.ownerUserId : input.ownerUserId,
          updatedBy: input.by ?? null,
          updatedAt: at,
        }
      : {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          accountId: input.accountId ?? null,
          shortcut: input.shortcut,
          body: input.body,
          visibility: input.visibility ?? "tenant",
          ownerUserId: input.ownerUserId ?? null,
          createdBy: input.by ?? null,
          updatedBy: input.by ?? null,
          createdAt: at,
          updatedAt: at,
          seq: nextSeq(),
        };
    assertSnippet(next);
    state.snippets.set(next.id, next);
    return strip(next);
  };

  const requireTag = (id: string): Sequenced<Tag> => {
    const tag = state.tags.get(id);
    if (!tag) throw new RecordNotFoundError({ entity: "tag", id });
    return tag;
  };
  const writeTag = (input: TagUpsertInput): Tag => {
    const existing = input.id === undefined ? undefined : state.tags.get(input.id);
    if (input.id !== undefined && (!existing || existing.tenantId !== input.tenantId)) {
      throw new RecordNotFoundError({ entity: "tag", id: input.id });
    }
    const trimmed = input.name.trim();
    if (trimmed.length < 1 || trimmed.length > TAG_NAME_MAX) {
      throw new ConstraintViolationError({ constraint: "sendo_tags_name_check" });
    }
    if (!TAG_COLORS.includes(input.color)) {
      throw new ConstraintViolationError({ constraint: "sendo_tags_color_check" });
    }
    const lower = input.name.toLowerCase();
    for (const other of state.tags.values()) {
      if (
        other.id !== existing?.id &&
        other.tenantId === input.tenantId &&
        other.name.toLowerCase() === lower
      ) {
        throw new ConstraintViolationError({ constraint: "sendo_tags_name_key" });
      }
    }
    const tag: Sequenced<Tag> = existing
      ? { ...existing, name: input.name, color: input.color }
      : {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          name: input.name,
          color: input.color,
          createdAt: now(),
          seq: nextSeq(),
        };
    state.tags.set(tag.id, tag);
    return strip(tag);
  };

  const requireRule = (id: string): Sequenced<StoredRule> => {
    const rule = state.rules.get(id);
    if (!rule) throw new RecordNotFoundError({ entity: "rule", id });
    return rule;
  };
  const assertRule = (rule: StoredRule): void => {
    if (!(RULE_TYPES as readonly string[]).includes(rule.type)) {
      throw new ConstraintViolationError({ constraint: "sendo_rules_type_check" });
    }
    if (!RULE_ORIGINS.includes(rule.origin)) {
      throw new ConstraintViolationError({ constraint: "sendo_rules_origin_check" });
    }
  };

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
          const channel = input.channel ?? "whatsapp";
          const phoneNumberId = input.phoneNumberId ?? null;
          const wabaId = input.wabaId ?? null;
          const tenantId = input.tenantId ?? null;
          const isDefault = input.isDefault ?? false;
          assertMetaIds({ channel, phoneNumberId, wabaId });
          for (const a of state.accounts.values()) {
            if (phoneNumberId !== null && a.phoneNumberId === phoneNumberId) {
              throw new DuplicateAccountError({ phoneNumberId });
            }
            if (isDefault && a.isDefault && a.tenantId === tenantId) {
              throw new ConstraintViolationError({
                constraint: "sendo_accounts_default_per_tenant",
              });
            }
          }
          const account: Sequenced<Account> = {
            id: crypto.randomUUID(),
            tenantId,
            channel,
            label: input.label ?? null,
            phoneNumberId,
            wabaId,
            displayPhone: input.displayPhone,
            tokenRef: input.tokenRef,
            timezone: input.timezone ?? DEFAULT_TIMEZONE,
            active: input.active ?? true,
            isDefault,
            coexistence: input.coexistence ?? false,
            onboardedVia: input.onboardedVia ?? "manual",
            agentPaused: input.agentPaused ?? false,
            agentMode: input.agentMode ?? null,
            billingReady: input.billingReady ?? null,
            billingCheckedAt: input.billingCheckedAt ?? null,
            createdAt: now(),
            seq: nextSeq(),
          };
          state.accounts.set(account.id, account);
          return strip(account);
        }),
      setDefault: (id) =>
        run(() => {
          const target = requireAccount(id);
          for (const a of state.accounts.values()) {
            if (a.id !== id && a.isDefault && a.tenantId === target.tenantId) a.isDefault = false;
          }
          target.isDefault = true;
          return strip(target);
        }),
      update: (id, patch) =>
        run(() => {
          const account = requireAccount(id);
          assignDefined<Account>(account, patch);
          return strip(account);
        }),
      reactivate: (phoneNumberId, input) =>
        run(() => {
          let found: Sequenced<Account> | undefined;
          for (const a of state.accounts.values()) {
            if (a.phoneNumberId === phoneNumberId) found = a;
          }
          if (!found) throw new RecordNotFoundError({ entity: "account", id: phoneNumberId });
          if (found.active || found.tenantId !== (input.tenantId ?? null)) {
            throw new DuplicateAccountError({ phoneNumberId });
          }
          const next: Account = { ...found, active: true };
          assignDefined<Account>(next, reactivationFields(input));
          assertMetaIds(next);
          Object.assign(found, next);
          return strip(found);
        }),
      purge: (id) =>
        run(() => {
          const account = requireAccount(id);
          if (account.active) throw new AccountStateError({ accountId: id, state: "active" });
          const conversationIds = new Set<string>();
          for (const [cid, c] of state.conversations) {
            if (c.accountId !== id) continue;
            conversationIds.add(cid);
            state.conversations.delete(cid);
          }
          const messageIds = new Set<string>();
          for (const [mid, m] of state.messages) {
            if (!conversationIds.has(m.conversationId)) continue;
            messageIds.add(mid);
            state.messages.delete(mid);
          }
          const storagePaths: string[] = [];
          for (const [key, m] of state.media) {
            if (!messageIds.has(m.messageId)) continue;
            if (m.storagePath !== null) storagePaths.push(m.storagePath);
            state.media.delete(key);
          }
          for (const [cid, c] of state.contacts) {
            if (c.accountId === id) state.contacts.delete(cid);
          }
          for (const [key, t] of state.templates) {
            if (t.accountId === id) state.templates.delete(key);
          }
          for (const [key, row] of state.conversationTags) {
            if (conversationIds.has(row.conversationId)) state.conversationTags.delete(key);
          }
          for (const [key, snippet] of state.snippets) {
            if (snippet.accountId === id) state.snippets.delete(key);
          }
          for (const [key, rule] of state.rules) {
            if (rule.accountId === id) state.rules.delete(key);
          }
          const broadcastIds = new Set<string>();
          for (const [key, broadcast] of state.broadcasts) {
            if (broadcast.accountId !== id) continue;
            broadcastIds.add(key);
            state.broadcasts.delete(key);
          }
          for (const [key, row] of state.broadcastRecipients) {
            if (broadcastIds.has(row.broadcastId) || !state.contacts.has(row.contactId)) {
              state.broadcastRecipients.delete(key);
            } else if (row.messageId !== null && messageIds.has(row.messageId)) {
              row.messageId = null;
            }
          }
          state.accounts.delete(id);
          return { storagePaths };
        }),
    },

    contacts: {
      upsert: (input) =>
        run(() => {
          const phone = input.phone ?? null;
          const channelUserId = input.channelUserId ?? null;
          if (phone === null && channelUserId === null) {
            throw new ConstraintViolationError({ constraint: "sendo_contacts_identity" });
          }
          const existing = findContact(input.accountId, phone, channelUserId);
          if (existing) {
            if (channelUserId !== null && channelUserId !== existing.channelUserId) {
              assertChannelUserIdFree(input, existing.id);
              existing.channelUserId = channelUserId;
            }
            const profileChanged =
              input.profileName != null && input.profileName !== existing.profileName;
            if (input.waId != null) existing.waId = input.waId;
            if (input.profileName != null) existing.profileName = input.profileName;
            return { contact: structuredClone(existing), created: false, profileChanged };
          }
          assertChannelUserIdFree(input, null);
          const contact: Contact = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            accountId: input.accountId,
            channel: input.channel ?? "whatsapp",
            phone,
            channelUserId,
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
      getByPhone: (accountId, phone) =>
        run(() => {
          const c = findContact(accountId, phone, null);
          return c ? structuredClone(c) : null;
        }),
      setAppRef: (id, appRef) =>
        run(() => {
          const c = requireContact(id);
          c.appRef = appRef;
          return structuredClone(c);
        }),
      setOptIn: (id, input) =>
        run(() => {
          const c = requireContact(id);
          c.marketingOptIn = input.marketingOptIn;
          c.optInAt = input.optInAt === null ? null : new Date(input.optInAt);
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
            closed.assignedAt = null;
            closed.handoffReason = null;
            return { conversation: strip(closed), created: false, reopened: true };
          }
          const at = now();
          const conversation: Sequenced<Conversation> = {
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            accountId: input.accountId,
            contactId: input.contactId,
            channel: input.channel ?? "whatsapp",
            status: "agent",
            source: null,
            assignedTo: null,
            assignedAt: null,
            handoffReason: null,
            agentPaused: false,
            queue: null,
            everHuman: false,
            lastInboundAt: null,
            lastActivityAt: at,
            windowExpiresAt: null,
            awaitingReplySince: null,
            escalatedAt: null,
            afterHoursNotifiedAt: null,
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
          const cursor = decodeCursor(query.cursor);
          const afterCursor = (c: Conversation): boolean => {
            if (!cursor || typeof cursor.t !== "number" || typeof cursor.id !== "string") {
              return true;
            }
            const t = c.lastActivityAt.getTime();
            return t < cursor.t || (t === cursor.t && c.id < cursor.id);
          };
          const matches = [...state.conversations.values()]
            .filter((c) => matchesFilter(c, query))
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
      count: (filter) =>
        run(() => [...state.conversations.values()].filter((c) => matchesFilter(c, filter)).length),
      countBySource: (query) =>
        run(() => {
          const counts = new Map<string | null, number>();
          for (const c of state.conversations.values()) {
            if (c.tenantId !== query.tenantId) continue;
            if (query.accountId !== undefined && c.accountId !== query.accountId) continue;
            const t = c.createdAt.getTime();
            if (query.from && t < query.from.getTime()) continue;
            if (query.to && t >= query.to.getTime()) continue;
            counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
          }
          return sortSourceCounts(
            [...counts].map(([source, conversations]) => ({ source, conversations })),
          );
        }),
      countByAssignee: (query) =>
        run(() => {
          const statuses = statusList(query.status) ?? OPEN_STATUSES;
          const counts: Record<string, number> = {};
          for (const id of query.assignees) counts[id] = 0;
          for (const c of state.conversations.values()) {
            if (c.tenantId !== query.tenantId || !statuses.includes(c.status)) continue;
            if (c.assignedTo !== null && c.assignedTo in counts) {
              counts[c.assignedTo] = (counts[c.assignedTo] ?? 0) + 1;
            }
          }
          return counts;
        }),
      findForTick: (query) =>
        run(() => {
          const scoped = [...state.conversations.values()].filter(
            (c) =>
              c.tenantId === query.tenantId &&
              (query.accountId === undefined || c.accountId === query.accountId),
          );
          const byTime =
            (key: "awaitingReplySince" | "lastActivityAt") =>
            (a: Sequenced<Conversation>, b: Sequenced<Conversation>): number =>
              (a[key]?.getTime() ?? 0) - (b[key]?.getTime() ?? 0) ||
              (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          if (query.type === "escalate") {
            return scoped
              .filter((c) => {
                const waiting = c.awaitingReplySince;
                if (c.status !== "human" || waiting === null) return false;
                if (waiting.getTime() >= query.waitingSince.getTime()) return false;
                if (c.escalatedAt !== null && c.escalatedAt.getTime() >= waiting.getTime()) {
                  return false;
                }
                return query.queue === undefined || c.queue === query.queue;
              })
              .sort(byTime("awaitingReplySince"))
              .slice(0, Math.max(0, query.limit))
              .map(strip);
          }
          return scoped
            .filter(
              (c) =>
                c.status !== "closed" && c.lastActivityAt.getTime() < query.inactiveSince.getTime(),
            )
            .sort(byTime("lastActivityAt"))
            .slice(0, Math.max(0, query.limit))
            .map(strip);
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
            internal: false,
            draft: false,
            tokensIn: null,
            tokensOut: null,
            costCents: null,
            sentAt: input.sentAt,
            createdAt: now(),
            seq: nextSeq(),
          };
          state.messages.set(message.id, message);
          return strip(message);
        }),
      insertOutbound: (input) =>
        run(() => {
          const internal = input.internal ?? false;
          const draft = input.draft ?? false;
          if (internal && draft) {
            throw new ConstraintViolationError({
              constraint: "sendo_messages_internal_draft_check",
            });
          }
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
            status: input.status ?? "pending",
            error: null,
            sender: input.sender,
            senderRef: input.senderRef ?? null,
            metadata: structuredClone(input.metadata ?? {}),
            internal,
            draft,
            tokensIn: input.tokensIn ?? null,
            tokensOut: input.tokensOut ?? null,
            costCents: input.costCents ?? null,
            sentAt: input.status === "sent" ? now() : null,
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
      update: (id, patch) =>
        run(() => {
          const m = requireMessage(id);
          const draft = patch.draft ?? m.draft;
          if (draft && m.internal) {
            throw new ConstraintViolationError({
              constraint: "sendo_messages_internal_draft_check",
            });
          }
          m.draft = draft;
          if (patch.text !== undefined) m.text = patch.text;
          if (patch.content !== undefined) m.content = structuredClone(patch.content);
          if (patch.metadata !== undefined) {
            m.metadata = { ...m.metadata, ...structuredClone(patch.metadata) };
          }
          return strip(m);
        }),
      deleteDrafts: (conversationId) =>
        run(() => {
          let count = 0;
          for (const [id, m] of state.messages) {
            if (m.conversationId === conversationId && m.draft) {
              state.messages.delete(id);
              for (const [key, media] of state.media) {
                if (media.messageId === id) state.media.delete(key);
              }
              count++;
            }
          }
          return count;
        }),
      pendingDraftConversations: (conversationIds) =>
        run(() => {
          const wanted = new Set(conversationIds);
          const found = new Set<string>();
          for (const m of state.messages.values()) {
            if (m.draft && wanted.has(m.conversationId)) found.add(m.conversationId);
          }
          return [...found];
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

    snippets: {
      list: (query) =>
        run(() =>
          [...state.snippets.values()]
            .filter((s) => s.tenantId === query.tenantId)
            .filter(
              (s) =>
                s.visibility === "tenant" ||
                (query.userId !== undefined && s.ownerUserId === query.userId),
            )
            .filter(
              (s) =>
                query.accountId === undefined ||
                s.accountId === null ||
                s.accountId === query.accountId,
            )
            .sort(compareSnippets)
            .map(strip),
        ),
      get: (id) =>
        run(() => {
          const snippet = state.snippets.get(id);
          return snippet ? strip(snippet) : null;
        }),
      upsert: (input) => run(() => writeSnippet(input)),
      delete: (id) =>
        run(() => {
          requireSnippet(id);
          state.snippets.delete(id);
        }),
    },

    tags: {
      list: (query) =>
        run(() =>
          [...state.tags.values()]
            .filter((t) => t.tenantId === query.tenantId)
            .sort(compareTags)
            .map(strip),
        ),
      get: (id) =>
        run(() => {
          const tag = state.tags.get(id);
          return tag ? strip(tag) : null;
        }),
      upsert: (input) => run(() => writeTag(input)),
      delete: (id) =>
        run(() => {
          requireTag(id);
          state.tags.delete(id);
          for (const [key, row] of state.conversationTags) {
            if (row.tagId === id) state.conversationTags.delete(key);
          }
        }),
      usage: (id) =>
        run(() => [...state.conversationTags.values()].filter((row) => row.tagId === id).length),
      addToConversation: (conversationId, tagId, opts = {}) =>
        run(() => {
          const conversation = requireConversation(conversationId);
          const tag = state.tags.get(tagId);
          if (!tag || tag.tenantId !== conversation.tenantId) {
            throw new RecordNotFoundError({ entity: "tag", id: tagId });
          }
          const key = conversationTagKey(conversationId, tagId);
          if (state.conversationTags.has(key)) return false;
          state.conversationTags.set(key, {
            conversationId,
            tagId,
            tenantId: conversation.tenantId,
            addedBy: opts.by ?? null,
            addedAt: now(),
          });
          return true;
        }),
      removeFromConversation: (conversationId, tagId) =>
        run(() => state.conversationTags.delete(conversationTagKey(conversationId, tagId))),
      forConversations: (conversationIds) =>
        run(() => {
          const result: Record<string, Tag[]> = {};
          for (const id of conversationIds) {
            result[id] = [...conversationTagIds(id)]
              .map((tagId) => state.tags.get(tagId))
              .filter((t): t is Sequenced<Tag> => t !== undefined)
              .sort(compareTags)
              .map(strip);
          }
          return result;
        }),
    },

    rules: {
      list: (query = {}) =>
        run(() =>
          [...state.rules.values()]
            .filter((r) => query.tenantId === undefined || r.tenantId === query.tenantId)
            .filter(
              (r) =>
                query.accountId === undefined ||
                r.accountId === null ||
                r.accountId === query.accountId,
            )
            .filter((r) => query.active === undefined || r.active === query.active)
            .sort(compareRules)
            .map(strip),
        ),
      get: (id) =>
        run(() => {
          const rule = state.rules.get(id);
          return rule ? strip(rule) : null;
        }),
      upsert: (input, opts = {}) =>
        run(() => {
          let existing: Sequenced<StoredRule> | undefined;
          let last = -1;
          for (const r of state.rules.values()) {
            if (r.tenantId !== input.tenantId) continue;
            if (r.key === input.key) existing = r;
            last = Math.max(last, r.position);
          }
          if (existing && opts.ifMissing) return { rule: strip(existing), created: false };
          const at = now();
          const next: Sequenced<StoredRule> = existing
            ? {
                ...existing,
                accountId: input.accountId === undefined ? existing.accountId : input.accountId,
                type: input.type,
                params: structuredClone(input.params),
                position: input.position ?? existing.position,
                active: input.active ?? existing.active,
                origin: input.origin ?? existing.origin,
                state: input.type === existing.type ? existing.state : {},
                updatedBy: input.updatedBy ?? null,
                updatedAt: at,
              }
            : {
                id: crypto.randomUUID(),
                tenantId: input.tenantId,
                accountId: input.accountId ?? null,
                key: input.key,
                type: input.type,
                params: structuredClone(input.params),
                position: input.position ?? last + 1,
                active: input.active ?? true,
                origin: input.origin ?? "screen",
                state: {},
                updatedBy: input.updatedBy ?? null,
                updatedAt: at,
                seq: nextSeq(),
              };
          assertRule(next);
          state.rules.set(next.id, next);
          return { rule: strip(next), created: !existing };
        }),
      update: (id, patch) =>
        run(() => {
          const rule = requireRule(id);
          assignDefined<StoredRule>(rule, {
            ...patch,
            params: patch.params === undefined ? undefined : structuredClone(patch.params),
          });
          rule.updatedAt = now();
          return strip(rule);
        }),
      delete: (id) =>
        run(() => {
          requireRule(id);
          state.rules.delete(id);
        }),
      reorder: (tenantId, ids) =>
        run(() => {
          const rules = ids.map((id) => {
            const rule = state.rules.get(id);
            if (!rule || rule.tenantId !== tenantId) {
              throw new RecordNotFoundError({ entity: "rule", id });
            }
            return rule;
          });
          rules.forEach((rule, index) => {
            rule.position = index;
          });
        }),
      patchState: (id, patch) =>
        run(() => {
          const rule = requireRule(id);
          rule.state = { ...rule.state, ...structuredClone(patch) };
          return strip(rule);
        }),
    },

    broadcasts: memoryBroadcasts({ state: () => state, now, nextSeq }),

    metrics: memoryMetrics(() => state),

    events: {
      insert: (input) =>
        run(() => {
          const event: SendoEvent = {
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
      delete: (paths) =>
        run(() => {
          for (const path of paths) state.storage.delete(path);
        }),
      exists: () => run(() => opts.bucketExists ?? true),
    },

    schemaVersion: () => run(() => (missingTables.includes("sendo_schema_meta") ? null : version)),
    healthCheck: () =>
      run(() => ({ tablesOk: missingTables.length === 0, missing: [...missingTables] })),
  };

  return adapter;
}
