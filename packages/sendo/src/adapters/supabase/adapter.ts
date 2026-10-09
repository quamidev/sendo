import type { SupabaseClient } from "@supabase/supabase-js";
import { DuplicateAccountError, RecordNotFoundError } from "../../errors";
import type { RecordEntity } from "../../errors/errors";
import type { JsonObject, Page } from "../../types/entities";
import type {
  ContactUpsertInput,
  ContactUpsertResult,
  ConversationListItem,
  GetOpenOrCreateInput,
  GetOpenOrCreateResult,
  StatusUpdateResult,
  SendoAdapter,
} from "../types";
import { SENDO_TABLES } from "../types";
import {
  type DbError,
  type StorageErrorLike,
  SupabaseAdapterError,
  isInvalidId,
  isMissingTable,
  isStorageNotFound,
  isUniqueViolation,
} from "./errors";
import {
  type AccountRow,
  type ContactRow,
  type ConversationListRow,
  type ConversationRow,
  type EventRow,
  type MediaRow,
  type MessageRow,
  type MessageWithMediaRow,
  type TemplateRow,
  conversationPatchToRow,
  mediaPatchToRow,
  toAccount,
  toContact,
  toConversation,
  toConversationListItem,
  toEvent,
  toMedia,
  toMessage,
  toMessageWithMedia,
  toTemplate,
} from "./rows";

export interface SupabaseAdapterOptions {
  /** Private Storage bucket for media, e.g. `sendo-media`. */
  storageBucket: string;
  /** TTL used by `storage.signedUrl` when it is called with a non-positive TTL. Default 3600. */
  signedUrlTtlSec?: number;
}

interface DbResult {
  data: unknown;
  error: DbError | null;
  count?: number | null;
}

const DEFAULT_SIGNED_URL_TTL_SEC = 3600;
const OPEN_STATUSES = ["agent", "human"] as const;
const MESSAGE_WITH_MEDIA = "*, sendo_media(*)";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPDATE_RESULTS: readonly StatusUpdateResult[] = ["updated", "ignored", "placeholder"];

/** Awaits a PostgREST builder as an untyped `{ data, error }` result. */
async function settle(query: PromiseLike<DbResult>): Promise<DbResult> {
  return query;
}

async function exec<T>(operation: string, query: PromiseLike<DbResult>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new SupabaseAdapterError(operation, error);
  return data as T;
}

/** Like `exec`, but a malformed id (`22P02`) yields `null` instead of an error. */
async function execById<T>(operation: string, query: PromiseLike<DbResult>): Promise<T | null> {
  const { data, error } = await query;
  if (error) {
    if (isInvalidId(error)) return null;
    throw new SupabaseAdapterError(operation, error);
  }
  return data as T | null;
}

async function execCount(operation: string, query: PromiseLike<DbResult>): Promise<number> {
  const { error, count } = await query;
  if (error) throw new SupabaseAdapterError(operation, error);
  return count ?? 0;
}

function storageFailure(operation: string, error: StorageErrorLike): SupabaseAdapterError {
  return new SupabaseAdapterError(operation, error);
}

function encodeCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify({ t, id }), "utf8").toString("base64url");
}

/** Returns `null` for absent or malformed cursors (treated as "first page"). */
export function decodeCursor(cursor: string | null | undefined): { t: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { t, id } = parsed as { t?: unknown; id?: unknown };
    if (typeof t !== "string" || typeof id !== "string") return null;
    if (Number.isNaN(Date.parse(t)) || !UUID_RE.test(id)) return null;
    return { t, id };
  } catch {
    return null;
  }
}

/** PostgREST `or=` filter selecting rows strictly after `cursor` in `(column desc, id desc)` order. */
function afterCursorFilter(column: string, cursor: { t: string; id: string }): string {
  return `${column}.lt."${cursor.t}",and(${column}.eq."${cursor.t}",id.lt.${cursor.id})`;
}

function templateKey(name: string, language: string): string {
  return JSON.stringify([name, language]);
}

/**
 * Production `SendoAdapter` backed by Postgres (PostgREST) and Supabase Storage.
 * Pass a SERVICE ROLE client: the `sendo_*` tables are RLS-protected and the RPC
 * functions are only granted to `service_role`. Requires the `sendo-schema` migration.
 */
export function supabaseAdapter(
  serviceRoleClient: SupabaseClient,
  options: SupabaseAdapterOptions,
): SendoAdapter {
  const db = serviceRoleClient;
  const bucket = options.storageBucket;
  const defaultTtl = options.signedUrlTtlSec ?? DEFAULT_SIGNED_URL_TTL_SEC;

  const notFound = (entity: RecordEntity, id: string): RecordNotFoundError =>
    new RecordNotFoundError({ entity, id });

  const messageWithMediaQuery = () =>
    db
      .from("sendo_messages")
      .select(MESSAGE_WITH_MEDIA)
      .not("conversation_id", "is", null)
      .order("created_at", { referencedTable: "sendo_media", ascending: false })
      .limit(1, { referencedTable: "sendo_media" });

  const getConversationRow = (operation: string, id: string) =>
    execById<ConversationRow>(
      operation,
      db.from("sendo_conversations").select("*").eq("id", id).maybeSingle(),
    );

  const findOpenConversation = async (
    input: GetOpenOrCreateInput,
  ): Promise<ConversationRow | null> =>
    exec<ConversationRow | null>(
      "conversations.getOpenOrCreate",
      db
        .from("sendo_conversations")
        .select("*")
        .eq("contact_id", input.contactId)
        .eq("account_id", input.accountId)
        .in("status", [...OPEN_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );

  const updateExistingContact = async (
    existing: ContactRow,
    input: ContactUpsertInput,
  ): Promise<ContactUpsertResult> => {
    const profileChanged = input.profileName != null && input.profileName !== existing.profile_name;
    const patch: Partial<ContactRow> = {};
    if (input.waId != null && input.waId !== existing.wa_id) patch.wa_id = input.waId;
    if (profileChanged) patch.profile_name = input.profileName ?? null;
    if (Object.keys(patch).length === 0) {
      return { contact: toContact(existing), created: false, profileChanged: false };
    }
    const row = await exec<ContactRow>(
      "contacts.upsert",
      db.from("sendo_contacts").update(patch).eq("id", existing.id).select("*").single(),
    );
    return { contact: toContact(row), created: false, profileChanged };
  };

  const findContact = (input: ContactUpsertInput) =>
    exec<ContactRow | null>(
      "contacts.upsert",
      db
        .from("sendo_contacts")
        .select("*")
        .eq("account_id", input.accountId)
        .eq("phone", input.phone)
        .maybeSingle(),
    );

  return {
    accounts: {
      async getByPhoneNumberId(phoneNumberId) {
        const row = await exec<AccountRow | null>(
          "accounts.getByPhoneNumberId",
          db.from("sendo_accounts").select("*").eq("phone_number_id", phoneNumberId).maybeSingle(),
        );
        return row ? toAccount(row) : null;
      },
      async getById(id) {
        const row = await execById<AccountRow>(
          "accounts.getById",
          db.from("sendo_accounts").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toAccount(row) : null;
      },
      async list(filter = {}) {
        let query = db.from("sendo_accounts").select("*");
        if (filter.tenantId === null) query = query.is("tenant_id", null);
        else if (filter.tenantId !== undefined) query = query.eq("tenant_id", filter.tenantId);
        if (filter.active !== undefined) query = query.eq("active", filter.active);
        const rows = await exec<AccountRow[]>(
          "accounts.list",
          query.order("created_at", { ascending: true }).order("id", { ascending: true }),
        );
        return rows.map(toAccount);
      },
      async insert(input) {
        const { data, error } = await settle(
          db
            .from("sendo_accounts")
            .insert({
              tenant_id: input.tenantId ?? null,
              phone_number_id: input.phoneNumberId,
              waba_id: input.wabaId,
              display_phone: input.displayPhone,
              token_ref: input.tokenRef,
              ...(input.timezone !== undefined && { timezone: input.timezone }),
              ...(input.active !== undefined && { active: input.active }),
            })
            .select("*")
            .single(),
        );
        if (error) {
          if (isUniqueViolation(error, "sendo_accounts_phone_number_id_key")) {
            throw new DuplicateAccountError(
              { phoneNumberId: input.phoneNumberId },
              { cause: error },
            );
          }
          throw new SupabaseAdapterError("accounts.insert", error);
        }
        return toAccount(data as AccountRow);
      },
    },

    contacts: {
      async upsert(input) {
        const existing = await findContact(input);
        if (existing) return updateExistingContact(existing, input);

        const { data, error } = await settle(
          db
            .from("sendo_contacts")
            .insert({
              tenant_id: input.tenantId,
              account_id: input.accountId,
              phone: input.phone,
              wa_id: input.waId ?? null,
              profile_name: input.profileName ?? null,
            })
            .select("*")
            .single(),
        );
        if (error) {
          if (isUniqueViolation(error, "sendo_contacts_account_id_phone_key")) {
            const raced = await findContact(input);
            if (raced) return updateExistingContact(raced, input);
          }
          throw new SupabaseAdapterError("contacts.upsert", error);
        }
        return { contact: toContact(data as ContactRow), created: true, profileChanged: false };
      },
      async get(id) {
        const row = await execById<ContactRow>(
          "contacts.get",
          db.from("sendo_contacts").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toContact(row) : null;
      },
      async setAppRef(id, appRef) {
        const row = await execById<ContactRow>(
          "contacts.setAppRef",
          db
            .from("sendo_contacts")
            .update({ app_ref: appRef })
            .eq("id", id)
            .select("*")
            .maybeSingle(),
        );
        if (!row) throw notFound("contact", id);
        return toContact(row);
      },
    },

    conversations: {
      async getOpenOrCreate(input): Promise<GetOpenOrCreateResult> {
        const operation = "conversations.getOpenOrCreate";
        // Concurrent callers race on the partial unique index (one open conversation per
        // contact); the loser re-reads the winner's row.
        for (let attempt = 0; attempt < 3; attempt++) {
          const open = await findOpenConversation(input);
          if (open) return { conversation: toConversation(open), created: false, reopened: false };

          const closed = await exec<ConversationRow | null>(
            operation,
            db
              .from("sendo_conversations")
              .select("*")
              .eq("contact_id", input.contactId)
              .eq("account_id", input.accountId)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .limit(1)
              .maybeSingle(),
          );

          const { data, error } = closed
            ? await settle(
                db
                  .from("sendo_conversations")
                  .update({ status: "agent", assigned_to: null, handoff_reason: null })
                  .eq("id", closed.id)
                  .eq("status", "closed")
                  .select("*")
                  .maybeSingle(),
              )
            : await settle(
                db
                  .from("sendo_conversations")
                  .insert({
                    tenant_id: input.tenantId,
                    account_id: input.accountId,
                    contact_id: input.contactId,
                    status: "agent",
                  })
                  .select("*")
                  .single(),
              );
          if (error) {
            if (isUniqueViolation(error, "sendo_conversations_open_contact_key")) continue;
            throw new SupabaseAdapterError(operation, error);
          }
          if (!data) continue;
          return {
            conversation: toConversation(data as ConversationRow),
            created: !closed,
            reopened: Boolean(closed),
          };
        }
        const open = await findOpenConversation(input);
        if (open) return { conversation: toConversation(open), created: false, reopened: false };
        throw new SupabaseAdapterError(operation, {
          message: `could not open a conversation for contact ${input.contactId}`,
        });
      },
      async get(id) {
        const row = await getConversationRow("conversations.get", id);
        return row ? toConversation(row) : null;
      },
      async update(id, patch) {
        const operation = "conversations.update";
        const { incrementUnread, ...fields } = patch;
        const values = conversationPatchToRow(fields);
        let row =
          Object.keys(values).length > 0
            ? await execById<ConversationRow>(
                operation,
                db
                  .from("sendo_conversations")
                  .update(values)
                  .eq("id", id)
                  .select("*")
                  .maybeSingle(),
              )
            : await getConversationRow(operation, id);
        if (!row) throw notFound("conversation", id);
        if (incrementUnread) {
          const count = await exec<number | null>(
            operation,
            db.rpc("sendo_increment_unread", { conversation_id: id, amount: incrementUnread }),
          );
          if (count === null) throw notFound("conversation", id);
          row = { ...row, unread_count: count };
        }
        return toConversation(row);
      },
      async list(query): Promise<Page<ConversationListItem>> {
        let q = db
          .from("sendo_conversations")
          .select("*, sendo_contacts(*), sendo_messages(*)")
          .order("last_activity_at", { ascending: false })
          .order("id", { ascending: false })
          .order("created_at", { referencedTable: "sendo_messages", ascending: false })
          .order("id", { referencedTable: "sendo_messages", ascending: false })
          .limit(1, { referencedTable: "sendo_messages" })
          .limit(query.limit + 1);
        if (query.tenantId === null) q = q.is("tenant_id", null);
        else if (query.tenantId !== undefined) q = q.eq("tenant_id", query.tenantId);
        if (query.accountId !== undefined) q = q.eq("account_id", query.accountId);
        if (query.status !== undefined) {
          q = q.in("status", Array.isArray(query.status) ? query.status : [query.status]);
        }
        if (query.assignedTo === null) q = q.is("assigned_to", null);
        else if (query.assignedTo !== undefined) q = q.eq("assigned_to", query.assignedTo);
        const cursor = decodeCursor(query.cursor);
        if (cursor) q = q.or(afterCursorFilter("last_activity_at", cursor));

        const rows = await exec<ConversationListRow[]>("conversations.list", q);
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map(toConversationListItem),
          nextCursor:
            rows.length > query.limit && last ? encodeCursor(last.last_activity_at, last.id) : null,
        };
      },
    },

    messages: {
      async insertInbound(input) {
        const rows = await exec<MessageRow[]>(
          "messages.insertInbound",
          db
            .from("sendo_messages")
            .upsert(
              {
                tenant_id: input.tenantId,
                conversation_id: input.conversationId,
                direction: "in",
                type: input.type,
                content: input.content,
                text: input.text ?? null,
                meta_message_id: input.metaMessageId,
                reply_to_meta_id: input.replyToMetaId ?? null,
                status: "received",
                sender: "contact",
                metadata: input.metadata ?? {},
                sent_at: input.sentAt.toISOString(),
              },
              { onConflict: "meta_message_id", ignoreDuplicates: true },
            )
            .select("*"),
        );
        const row = rows[0];
        return row ? toMessage(row) : null;
      },
      async insertOutbound(input) {
        const row = await exec<MessageRow>(
          "messages.insertOutbound",
          db
            .from("sendo_messages")
            .insert({
              tenant_id: input.tenantId,
              conversation_id: input.conversationId,
              direction: "out",
              type: input.type,
              content: input.content,
              text: input.text ?? null,
              reply_to_meta_id: input.replyToMetaId ?? null,
              status: "pending",
              sender: input.sender,
              sender_ref: input.senderRef ?? null,
              metadata: input.metadata ?? {},
            })
            .select("*")
            .single(),
        );
        return toMessage(row);
      },
      async markSent(id, metaMessageId) {
        const rows = await execById<MessageRow[]>(
          "messages.markSent",
          db.rpc("sendo_mark_sent", { message_id: id, meta_message_id: metaMessageId }),
        );
        const row = rows?.[0];
        if (!row) throw notFound("message", id);
        return toMessage(row);
      },
      async markFailed(id, error) {
        const row = await execById<MessageRow>(
          "messages.markFailed",
          db
            .from("sendo_messages")
            .update({ status: "failed", error })
            .eq("id", id)
            .not("conversation_id", "is", null)
            .select("*")
            .maybeSingle(),
        );
        if (!row) throw notFound("message", id);
        return toMessage(row);
      },
      async updateStatus(metaMessageId, status, opts = {}) {
        const result = await exec<string>(
          "messages.updateStatus",
          db.rpc("sendo_update_message_status", {
            meta_message_id: metaMessageId,
            status,
            error: opts.error ?? null,
            at: opts.at ? opts.at.toISOString() : null,
          }),
        );
        const known = UPDATE_RESULTS.find((r) => r === result);
        if (!known) {
          throw new SupabaseAdapterError("messages.updateStatus", {
            message: `unexpected result ${JSON.stringify(result)}`,
          });
        }
        return known;
      },
      async get(id) {
        const row = await execById<MessageWithMediaRow>(
          "messages.get",
          messageWithMediaQuery().eq("id", id).maybeSingle(),
        );
        return row ? toMessageWithMedia(row) : null;
      },
      async getByMetaId(metaMessageId) {
        const row = await exec<MessageWithMediaRow | null>(
          "messages.getByMetaId",
          messageWithMediaQuery().eq("meta_message_id", metaMessageId).maybeSingle(),
        );
        return row ? toMessageWithMedia(row) : null;
      },
      async history(conversationId, limit) {
        if (limit <= 0) return [];
        const rows = await execById<MessageWithMediaRow[]>(
          "messages.history",
          messageWithMediaQuery()
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(limit),
        );
        return (rows ?? []).reverse().map(toMessageWithMedia);
      },
      async thread(conversationId, query) {
        let q = messageWithMediaQuery()
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(query.limit + 1);
        const cursor = decodeCursor(query.cursor);
        if (cursor) q = q.or(afterCursorFilter("created_at", cursor));
        const rows = (await execById<MessageWithMediaRow[]>("messages.thread", q)) ?? [];
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map(toMessageWithMedia),
          nextCursor:
            rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
        };
      },
      async countInboundSince(contactId, since) {
        const operation = "messages.countInboundSince";
        const conversations =
          (await execById<{ id: string }[]>(
            operation,
            db.from("sendo_conversations").select("id").eq("contact_id", contactId),
          )) ?? [];
        if (conversations.length === 0) return 0;
        return execCount(
          operation,
          db
            .from("sendo_messages")
            .select("id", { count: "exact", head: true })
            .eq("direction", "in")
            .in(
              "conversation_id",
              conversations.map((c) => c.id),
            )
            .gte("created_at", since.toISOString()),
        );
      },
      async updateMetadata(id, patch: JsonObject) {
        const rows = await execById<MessageRow[]>(
          "messages.updateMetadata",
          db.rpc("sendo_merge_message_metadata", { message_id: id, patch }),
        );
        const row = rows?.[0];
        if (!row) throw notFound("message", id);
        return toMessage(row);
      },
    },

    media: {
      async insert(input) {
        const row = await exec<MediaRow>(
          "media.insert",
          db
            .from("sendo_media")
            .insert({
              tenant_id: input.tenantId,
              message_id: input.messageId,
              meta_media_id: input.metaMediaId ?? null,
              mime_type: input.mimeType ?? null,
              size_bytes: input.sizeBytes ?? null,
              sha256: input.sha256 ?? null,
              storage_path: input.storagePath ?? null,
              download_status: input.downloadStatus ?? "pending",
            })
            .select("*")
            .single(),
        );
        return toMedia(row);
      },
      async update(id, patch) {
        const values = mediaPatchToRow(patch);
        const query =
          Object.keys(values).length > 0
            ? db.from("sendo_media").update(values).eq("id", id).select("*").maybeSingle()
            : db.from("sendo_media").select("*").eq("id", id).maybeSingle();
        const row = await execById<MediaRow>("media.update", query);
        if (!row) throw notFound("media", id);
        return toMedia(row);
      },
    },

    templates: {
      async upsertMany(accountId, templates) {
        const operation = "templates.upsertMany";
        if (templates.length === 0) return [];
        const account = await execById<Pick<AccountRow, "tenant_id">>(
          operation,
          db.from("sendo_accounts").select("tenant_id").eq("id", accountId).maybeSingle(),
        );
        if (!account) throw notFound("account", accountId);

        const byKey = new Map<string, Record<string, unknown>>();
        for (const t of templates) {
          byKey.set(templateKey(t.name, t.language), {
            tenant_id: account.tenant_id,
            account_id: accountId,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            components: t.components,
            variable_count: t.variableCount,
            active: true,
            synced_at: (t.syncedAt ?? new Date()).toISOString(),
          });
        }
        const rows = await exec<TemplateRow[]>(
          operation,
          db
            .from("sendo_templates")
            .upsert([...byKey.values()], { onConflict: "account_id,name,language" })
            .select("*"),
        );
        const saved = new Map(rows.map((r) => [templateKey(r.name, r.language), toTemplate(r)]));
        return templates.map((t) => {
          const template = saved.get(templateKey(t.name, t.language));
          if (!template) {
            throw new SupabaseAdapterError(operation, {
              message: `template ${t.name} (${t.language}) was not returned`,
            });
          }
          return template;
        });
      },
      async markInactiveExcept(accountId, keep) {
        const operation = "templates.markInactiveExcept";
        const active =
          (await execById<Pick<TemplateRow, "id" | "name" | "language">[]>(
            operation,
            db
              .from("sendo_templates")
              .select("id, name, language")
              .eq("account_id", accountId)
              .eq("active", true),
          )) ?? [];
        const kept = new Set(keep.map((k) => templateKey(k.name, k.language)));
        const ids = active
          .filter((t) => !kept.has(templateKey(t.name, t.language)))
          .map((t) => t.id);
        if (ids.length === 0) return 0;
        return execCount(
          operation,
          db
            .from("sendo_templates")
            .update({ active: false }, { count: "exact" })
            .in("id", ids)
            .eq("active", true),
        );
      },
      async list(query = {}) {
        let q = db.from("sendo_templates").select("*");
        if (query.accountId !== undefined) q = q.eq("account_id", query.accountId);
        if (query.status !== undefined) q = q.eq("status", query.status);
        if (query.active !== undefined) q = q.eq("active", query.active);
        const rows =
          (await execById<TemplateRow[]>(
            "templates.list",
            q.order("name", { ascending: true }).order("language", { ascending: true }),
          )) ?? [];
        return rows.map(toTemplate);
      },
      async get(accountId, name, language) {
        const row = await execById<TemplateRow>(
          "templates.get",
          db
            .from("sendo_templates")
            .select("*")
            .eq("account_id", accountId)
            .eq("name", name)
            .eq("language", language)
            .maybeSingle(),
        );
        return row ? toTemplate(row) : null;
      },
    },

    events: {
      async insert(input) {
        const row = await exec<EventRow>(
          "events.insert",
          db
            .from("sendo_events")
            .insert({ payload: input.payload ?? null })
            .select("*")
            .single(),
        );
        return toEvent(row);
      },
      async setStatus(id, status, error) {
        const values: Record<string, unknown> = { status, error: error ?? null };
        if (status !== "received") values.processed_at = new Date().toISOString();
        const row = await execById<EventRow>(
          "events.setStatus",
          db.from("sendo_events").update(values).eq("id", id).select("*").maybeSingle(),
        );
        if (!row) throw notFound("event", id);
        return toEvent(row);
      },
      async get(id) {
        const row = await execById<EventRow>(
          "events.get",
          db.from("sendo_events").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toEvent(row) : null;
      },
      async prune(olderThan) {
        return execCount(
          "events.prune",
          db
            .from("sendo_events")
            .delete({ count: "exact" })
            .lt("received_at", olderThan.toISOString()),
        );
      },
    },

    locks: {
      async acquire(key, ttlMs) {
        const acquired = await exec<boolean | null>(
          "locks.acquire",
          db.rpc("sendo_acquire_lock", { key, ttl_ms: Math.max(1, Math.ceil(ttlMs)) }),
        );
        return acquired === true;
      },
      async release(key) {
        await exec<null>("locks.release", db.rpc("sendo_release_lock", { key }));
      },
    },

    storage: {
      async put(path, bytes, mime) {
        const { error } = await db.storage
          .from(bucket)
          .upload(path, bytes, { contentType: mime, upsert: true });
        if (error) throw storageFailure("storage.put", error);
      },
      async get(path) {
        const { data, error } = await db.storage.from(bucket).download(path);
        if (error) {
          if (isStorageNotFound(error)) return null;
          throw storageFailure("storage.get", error);
        }
        return new Uint8Array(await data.arrayBuffer());
      },
      async signedUrl(path, ttlSec) {
        const ttl = ttlSec > 0 ? Math.ceil(ttlSec) : defaultTtl;
        const { data, error } = await db.storage.from(bucket).createSignedUrl(path, ttl);
        if (error) throw storageFailure("storage.signedUrl", error);
        return data.signedUrl;
      },
      async bucketExists() {
        const { data, error } = await db.storage.getBucket(bucket);
        if (error) {
          if (isStorageNotFound(error)) return false;
          throw storageFailure("storage.bucketExists", error);
        }
        return data.id === bucket || data.name === bucket;
      },
    },

    async schemaVersion() {
      const { data, error } = await settle(
        db
          .from("sendo_schema_meta")
          .select("version")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      if (error) {
        if (isMissingTable(error)) return null;
        throw new SupabaseAdapterError("schemaVersion", error);
      }
      const row = data as { version: number | string } | null;
      return row ? Number(row.version) : null;
    },

    async healthCheck() {
      const results = await Promise.all(
        SENDO_TABLES.map(async (table) => {
          const { error } = await db.from(table).select("*").limit(0);
          if (!error) return null;
          if (isMissingTable(error)) return table;
          throw new SupabaseAdapterError("healthCheck", error);
        }),
      );
      const missing = results.filter((t): t is (typeof SENDO_TABLES)[number] => t !== null);
      return { tablesOk: missing.length === 0, missing };
    },
  };
}
