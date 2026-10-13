import { version as PACKAGE_VERSION } from "../../../package.json";
import type { ConversationListItem, SendoAdapter } from "../../adapters/types";
import { AccountNotFoundError } from "../../errors/errors";
import type { MediaStore } from "../../media/types";
import type {
  Account,
  Contact,
  JsonObject,
  Media,
  MessageWithMedia,
  TenantId,
} from "../../types/entities";
import type {
  ConversationStatus,
  Direction,
  MessageStatus,
  MessageType,
  OnboardedVia,
  Sender,
  TagColor,
} from "../../types/enums";
import type { RedactingLogger } from "../../utils/logger";
import { requireAccount } from "./operations";

/** Conversations read per page while exporting. */
export const EXPORT_CONVERSATION_PAGE = 200;
/** Messages read per page of a conversation while exporting. */
export const EXPORT_MESSAGE_PAGE = 100;
/** Lifetime of the media URLs in an export (7 days, the S3 presign maximum). */
export const EXPORT_MEDIA_URL_TTL_SEC = 7 * 24 * 60 * 60;

/** `account` of a `SendoExportDocumentV1`. */
export interface SendoExportAccount {
  id: string;
  tenantId: TenantId;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhone: string;
  label: string | null;
  active: boolean;
  onboardedVia: OnboardedVia;
  createdAt: string;
}

/** A contact of a `SendoExportDocumentV1` (every contact with a conversation on the number). */
export interface SendoExportContact {
  id: string;
  waId: string | null;
  profileName: string | null;
  appRef: string | null;
  /** Marketing opt-in and when it was decided (`null` = never). */
  optIn: { marketing: boolean; at: string | null };
}

/** A tag of the tenant's catalog in a `SendoExportDocumentV1`. */
export interface SendoExportTag {
  id: string;
  name: string;
  color: TagColor;
}

/**
 * A media reference (never the bytes). `url` is signed for 7 days when the media store can sign,
 * else `null` (use `storageKey`). `missing` is `true` when the file was never stored (download
 * pending or failed) or the store could not sign it.
 */
export interface SendoExportMedia {
  id: string;
  mimeType: string | null;
  storageKey: string | null;
  url: string | null;
  missing: boolean;
}

/** A message, note, draft or system line of a `SendoExportConversation`. */
export interface SendoExportMessage {
  id: string;
  direction: Direction;
  sender: Sender;
  senderRef: string | null;
  type: MessageType;
  text: string | null;
  content: JsonObject;
  /** A team note or a system line (`metadata.event` and its params say what happened). */
  internal: boolean;
  draft: boolean;
  status: MessageStatus;
  metadata: JsonObject;
  sentAt: string | null;
  createdAt: string;
  media: SendoExportMedia[];
}

/** A conversation of a `SendoExportDocumentV1`; `messages` are newest first (the thread order). */
export interface SendoExportConversation {
  id: string;
  contactId: string;
  status: ConversationStatus;
  assignedTo: string | null;
  tagIds: string[];
  createdAt: string;
  /** When the last `closed` system line was written, for a closed conversation; else `null`. */
  closedAt: string | null;
  messages: SendoExportMessage[];
}

/**
 * The JSON document `sendo.accounts.export` and `sendo accounts export` produce: everything of
 * one number with `createdAt <= exportedAt`. Dates are ISO 8601 strings.
 */
export interface SendoExportDocumentV1 {
  format: "sendo-export";
  version: 1;
  exportedAt: string;
  sendoVersion: string;
  account: SendoExportAccount;
  contacts: SendoExportContact[];
  tags: SendoExportTag[];
  conversations: SendoExportConversation[];
}

/** `sendo-export-<display phone digits>-<yyyy-mm-dd>.json` (UTC date), the download's file name. */
export function exportFileName(displayPhone: string, exportedAt: Date): string {
  const digits = displayPhone.replace(/\D/g, "");
  const day = exportedAt.toISOString().slice(0, 10);
  return `sendo-export-${digits === "" ? "number" : digits}-${day}.json`;
}

/** What the export reads from: the adapter, the media store (for signed URLs) and a logger. */
export interface AccountExportDeps {
  adapter: SendoAdapter;
  media: MediaStore | null;
  logger: Pick<RedactingLogger, "warn">;
}

export interface AccountExportProgress {
  conversations: number;
  messages: number;
}

export interface AccountExportOptions {
  /** Only an account of this tenant (the actor's); another tenant's is `AccountNotFoundError`. */
  tenantId?: TenantId;
  /** Called after each page of conversations is written. */
  onProgress?: (progress: AccountExportProgress) => void;
  /** Snapshot time. Default: when the account was found. */
  at?: Date;
  /** Page sizes (tests). */
  pageSize?: { conversations?: number; messages?: number };
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());

function exportAccountRow(account: Account): SendoExportAccount {
  return {
    id: account.id,
    tenantId: account.tenantId,
    phoneNumberId: account.phoneNumberId,
    wabaId: account.wabaId,
    displayPhone: account.displayPhone,
    label: account.label,
    active: account.active,
    onboardedVia: account.onboardedVia,
    createdAt: iso(account.createdAt),
  };
}

function exportContact(contact: Contact): SendoExportContact {
  return {
    id: contact.id,
    waId: contact.waId,
    profileName: contact.profileName,
    appRef: contact.appRef,
    optIn: { marketing: contact.marketingOptIn, at: isoOrNull(contact.optInAt) },
  };
}

function isClosedLine(message: MessageWithMedia): boolean {
  return message.internal && message.sender === "system" && message.metadata.event === "closed";
}

/**
 * Streams one number's history as chunks of a single `SendoExportDocumentV1` JSON document,
 * without permission checks (the CLI's trusted path; `sendo.accounts.export` checks the actor).
 *
 * Built from adapter reads only: conversations in pages of 200 (`conversations.list` by account)
 * with each thread paged inside, contacts from those conversations, tags from `tags.list` and
 * `tags.forConversations`. Nothing is buffered beyond one page and the ids already written. Rows
 * created after the snapshot time are left out; conversations whose activity moved them to the
 * top of the list while paging are picked up by a second pass, each one exactly once.
 *
 * The account is looked up before the first chunk: an unknown one (or another tenant's) rejects
 * the first `next()` with `AccountNotFoundError`.
 */
export async function* exportAccount(
  deps: AccountExportDeps,
  ref: string,
  options: AccountExportOptions = {},
): AsyncGenerator<string, void, undefined> {
  const { adapter, media, logger } = deps;
  const account = await requireAccount(adapter, ref);
  if (options.tenantId !== undefined && account.tenantId !== options.tenantId) {
    throw new AccountNotFoundError({ account: ref, tenantId: options.tenantId });
  }
  const at = options.at ?? new Date();
  const cutoff = at.getTime();
  const conversationPage = options.pageSize?.conversations ?? EXPORT_CONVERSATION_PAGE;
  const messagePage = options.pageSize?.messages ?? EXPORT_MESSAGE_PAGE;

  /** The number's conversations created up to the snapshot, each once, in pages. */
  async function* conversationPages(): AsyncGenerator<ConversationListItem[]> {
    const seen = new Set<string>();
    const take = (items: ConversationListItem[]) => {
      const fresh = items.filter((c) => c.createdAt.getTime() <= cutoff && !seen.has(c.id));
      for (const c of fresh) seen.add(c.id);
      return fresh;
    };
    let cursor: string | null = null;
    do {
      const page = await adapter.conversations.list({
        accountId: account.id,
        cursor,
        limit: conversationPage,
      });
      const items = take(page.items);
      if (items.length > 0) yield items;
      cursor = page.nextCursor;
    } while (cursor !== null);
    // Activity after the snapshot moves a conversation to the top (behind the cursor).
    do {
      const page = await adapter.conversations.list({
        accountId: account.id,
        cursor,
        limit: conversationPage,
      });
      const moved = page.items.filter((c) => c.lastActivityAt.getTime() > cutoff);
      const items = take(moved);
      if (items.length > 0) yield items;
      cursor = moved.length === page.items.length ? page.nextCursor : null;
    } while (cursor !== null);
  }

  async function exportMedia(row: Media): Promise<SendoExportMedia> {
    const storageKey = row.storagePath;
    const stored = row.downloadStatus === "done" && storageKey !== null;
    let url: string | null = null;
    let missing = !stored;
    if (stored && media !== null) {
      try {
        url = await media.signedUrl(storageKey, EXPORT_MEDIA_URL_TTL_SEC);
      } catch (error) {
        missing = true;
        logger.warn(`[sendo] export: could not sign media ${row.id} (${storageKey})`, error);
      }
    }
    return { id: row.id, mimeType: row.mimeType, storageKey, url, missing };
  }

  async function exportMessage(message: MessageWithMedia): Promise<SendoExportMessage> {
    return {
      id: message.id,
      direction: message.direction,
      sender: message.sender,
      senderRef: message.senderRef,
      type: message.type,
      text: message.text,
      content: message.content,
      internal: message.internal,
      draft: message.draft,
      status: message.status,
      metadata: message.metadata,
      sentAt: isoOrNull(message.sentAt),
      createdAt: iso(message.createdAt),
      media: message.media === null ? [] : [await exportMedia(message.media)],
    };
  }

  const header = {
    format: "sendo-export",
    version: 1,
    exportedAt: iso(at),
    sendoVersion: PACKAGE_VERSION,
    account: exportAccountRow(account),
  } satisfies Omit<SendoExportDocumentV1, "contacts" | "tags" | "conversations">;
  yield `${JSON.stringify(header).slice(0, -1)},"contacts":[`;

  const contactIds = new Set<string>();
  for await (const page of conversationPages()) {
    const rows: string[] = [];
    for (const { contact } of page) {
      if (contactIds.has(contact.id)) continue;
      rows.push(JSON.stringify(exportContact(contact)));
      contactIds.add(contact.id);
    }
    if (rows.length === 0) continue;
    yield `${contactIds.size > rows.length ? "," : ""}\n${rows.join(",\n")}`;
  }
  contactIds.clear();

  const tags = (await adapter.tags.list({ tenantId: account.tenantId })).filter(
    (tag) => tag.createdAt.getTime() <= cutoff,
  );
  const tagIds = new Set(tags.map((tag) => tag.id));
  const tagRows = tags.map((tag): SendoExportTag => ({
    id: tag.id,
    name: tag.name,
    color: tag.color,
  }));
  yield `\n],"tags":${JSON.stringify(tagRows)},"conversations":[`;

  const progress: AccountExportProgress = { conversations: 0, messages: 0 };
  for await (const page of conversationPages()) {
    const tagsOf = await adapter.tags.forConversations(page.map((c) => c.id));
    for (const conversation of page) {
      const head = {
        id: conversation.id,
        contactId: conversation.contactId,
        status: conversation.status,
        assignedTo: conversation.assignedTo,
        tagIds: (tagsOf[conversation.id] ?? []).map((t) => t.id).filter((id) => tagIds.has(id)),
        createdAt: iso(conversation.createdAt),
      };
      yield `${progress.conversations === 0 ? "" : ","}\n${JSON.stringify(head).slice(0, -1)},"messages":[`;
      let closedAt: string | null = null;
      let written = 0;
      let cursor: string | null = null;
      do {
        const thread = await adapter.messages.thread(conversation.id, {
          cursor,
          limit: messagePage,
        });
        const rows: string[] = [];
        for (const message of thread.items) {
          if (message.createdAt.getTime() > cutoff || message.type === "status_placeholder") {
            continue;
          }
          if (closedAt === null && conversation.status === "closed" && isClosedLine(message)) {
            closedAt = iso(message.createdAt);
          }
          rows.push(JSON.stringify(await exportMessage(message)));
        }
        if (rows.length > 0) yield `${written === 0 ? "" : ","}\n${rows.join(",\n")}`;
        written += rows.length;
        cursor = thread.nextCursor;
      } while (cursor !== null);
      progress.messages += written;
      progress.conversations += 1;
      yield `],"closedAt":${JSON.stringify(closedAt)}}`;
    }
    options.onProgress?.({ ...progress });
  }
  yield "\n]}\n";
}
