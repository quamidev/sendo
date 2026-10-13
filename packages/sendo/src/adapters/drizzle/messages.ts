import { type SQL, sql } from "drizzle-orm";
import { RecordNotFoundError } from "../../errors";
import type { MessageError } from "../../types/entities";
import type { MessageStatus } from "../../types/enums";
import { canTransition } from "../../utils/status";
import type { SendoAdapter, StatusUpdateResult } from "../types";
import { decodeCursor, encodeCursor } from "../supabase/query";
import {
  type MessageRow,
  type MessageWithMediaRow,
  messagePatchToRow,
  toMessage,
  toMessageWithMedia,
} from "../supabase/rows";
import {
  type DrizzleDatabase,
  DrizzleAdapterError,
  assignments,
  execute,
  insertReturning,
  isUuid,
  jsonRow,
  jsonRows,
  jsonb,
  scalar,
  transaction,
  uuidArray,
} from "./db";

export const MESSAGE_CONSTRAINTS = ["sendo_messages_internal_draft_check"] as const;
const DELIVERY_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/** `to_jsonb(m)` plus its newest media row as `sendo_media` (like the Supabase embed). */
const WITH_MEDIA = sql`to_jsonb(m) || jsonb_build_object('sendo_media', (
  select to_jsonb(md) from sendo_media md
  where md.message_id = m.id
  order by md.created_at desc, md.id desc limit 1
))`;

/** Same advisory lock key as the Supabase RPCs (`sendo_meta:<id>`), so both can share a database. */
const metaLock = (metaMessageId: string): SQL =>
  sql`select pg_advisory_xact_lock(hashtextextended(${`sendo_meta:${metaMessageId}`}::text, 0))`;

export function drizzleMessages(db: DrizzleDatabase): SendoAdapter["messages"] {
  const notFound = (id: string) => new RecordNotFoundError({ entity: "message", id });

  const withMedia = async (operation: string, where: SQL) => {
    const row = await jsonRow<MessageWithMediaRow>(
      db,
      operation,
      sql`select ${WITH_MEDIA} as r from sendo_messages m
          where m.conversation_id is not null and ${where}`,
    );
    return row ? toMessageWithMedia(row) : null;
  };

  return {
    async insertInbound(input) {
      const row = await jsonRow<MessageRow>(
        db,
        "messages.insertInbound",
        sql`insert into sendo_messages as t
              (tenant_id, conversation_id, direction, type, content, text, meta_message_id,
               reply_to_meta_id, status, sender, metadata, sent_at)
            values (${input.tenantId}::uuid, ${input.conversationId}::uuid, 'in', ${input.type},
              ${jsonb(input.content)}, ${input.text ?? null}, ${input.metaMessageId},
              ${input.replyToMetaId ?? null}, 'received', 'contact', ${jsonb(input.metadata ?? {})},
              ${input.sentAt.toISOString()}::timestamptz)
            on conflict (meta_message_id) do nothing
            returning to_jsonb(t) as r`,
      );
      return row ? toMessage(row) : null;
    },

    async insertOutbound(input) {
      const row = await jsonRow<MessageRow>(
        db,
        "messages.insertOutbound",
        insertReturning("sendo_messages", {
          tenant_id: input.tenantId,
          conversation_id: input.conversationId,
          direction: "out",
          type: input.type,
          content: jsonb(input.content),
          text: input.text ?? null,
          reply_to_meta_id: input.replyToMetaId ?? null,
          status: input.status ?? "pending",
          sent_at: input.status === "sent" ? new Date() : undefined,
          sender: input.sender,
          sender_ref: input.senderRef ?? null,
          metadata: jsonb(input.metadata ?? {}),
          internal: input.internal ?? false,
          draft: input.draft ?? false,
          tokens_in: input.tokensIn ?? null,
          tokens_out: input.tokensOut ?? null,
          cost_cents: input.costCents ?? null,
        }),
        MESSAGE_CONSTRAINTS,
      );
      if (!row) throw new DrizzleAdapterError("messages.insertOutbound", null, "no row returned");
      return toMessage(row);
    },

    async markSent(id, metaMessageId) {
      if (!isUuid(id)) throw notFound(id);
      // One transaction under the Meta id's lock: the placeholder (a status that arrived first)
      // is deleted before the id is written to the real row, then merged forward-only.
      const row = await transaction(db, "messages.markSent", async (tx) => {
        await execute(tx, "messages.markSent", metaLock(metaMessageId));
        const msg = await jsonRow<MessageRow>(
          tx,
          "messages.markSent",
          sql`select to_jsonb(m) as r from sendo_messages m
              where m.id = ${id}::uuid and m.conversation_id is not null for update`,
        );
        if (!msg) return null;
        const placeholder = await jsonRow<Pick<MessageRow, "status" | "error">>(
          tx,
          "messages.markSent",
          sql`delete from sendo_messages m
              where m.meta_message_id = ${metaMessageId} and m.type = 'status_placeholder'
              returning jsonb_build_object('status', m.status, 'error', m.error) as r`,
        );
        let status: MessageStatus = canTransition(msg.status, "sent") ? "sent" : msg.status;
        let error: MessageError | null = msg.error;
        if (placeholder && canTransition(status, placeholder.status)) {
          status = placeholder.status;
          if (placeholder.status === "failed") error = placeholder.error;
        }
        return jsonRow<MessageRow>(
          tx,
          "messages.markSent",
          sql`update sendo_messages as t
              set meta_message_id = ${metaMessageId}, status = ${status}::sendo_message_status,
                  error = ${jsonb(error)}, sent_at = coalesce(t.sent_at, now())
              where t.id = ${id}::uuid
              returning to_jsonb(t) as r`,
        );
      });
      if (!row) throw notFound(id);
      return toMessage(row);
    },

    async markFailed(id, error) {
      if (!isUuid(id)) throw notFound(id);
      const row = await jsonRow<MessageRow>(
        db,
        "messages.markFailed",
        sql`update sendo_messages as t set status = 'failed', error = ${jsonb(error)}
            where t.id = ${id}::uuid and t.conversation_id is not null
            returning to_jsonb(t) as r`,
      );
      if (!row) throw notFound(id);
      return toMessage(row);
    },

    async updateStatus(metaMessageId, status, opts = {}): Promise<StatusUpdateResult> {
      const operation = "messages.updateStatus";
      if (!DELIVERY_STATUSES.has(status)) {
        throw new DrizzleAdapterError(operation, null, `invalid status ${status}`);
      }
      const failedError = status === "failed" ? (opts.error ?? null) : null;
      return transaction(db, operation, async (tx) => {
        await execute(tx, operation, metaLock(metaMessageId));
        for (let attempt = 1; ; attempt++) {
          const current = await jsonRow<Pick<MessageRow, "id" | "type" | "status">>(
            tx,
            operation,
            sql`select jsonb_build_object('id', m.id, 'type', m.type, 'status', m.status) as r
                from sendo_messages m where m.meta_message_id = ${metaMessageId} for update`,
          );
          if (current) {
            const isPlaceholder = current.type === "status_placeholder";
            if (!canTransition(current.status, status)) {
              return isPlaceholder ? "placeholder" : "ignored";
            }
            const sentAt =
              status === "sent" && !isPlaceholder
                ? sql`coalesce(t.sent_at, ${opts.at?.toISOString() ?? null}::timestamptz, now())`
                : sql`t.sent_at`;
            await execute(
              tx,
              operation,
              sql`update sendo_messages as t
                  set status = ${status}::sendo_message_status,
                      error = ${status === "failed" ? jsonb(failedError) : sql`t.error`},
                      sent_at = ${sentAt}
                  where t.id = ${current.id}::uuid`,
            );
            return isPlaceholder ? "placeholder" : "updated";
          }
          const inserted = await execute(
            tx,
            operation,
            sql`insert into sendo_messages
                  (conversation_id, direction, type, content, meta_message_id, status, error, sender)
                values (null, 'out', 'status_placeholder', '{}'::jsonb, ${metaMessageId},
                  ${status}::sendo_message_status, ${jsonb(failedError)}, 'system')
                on conflict (meta_message_id) do nothing
                returning id`,
          );
          if (inserted.length > 0) return "placeholder";
          if (attempt >= 3) {
            throw new DrizzleAdapterError(
              operation,
              null,
              `could not apply status to ${metaMessageId}`,
            );
          }
        }
      });
    },

    get: (id) =>
      isUuid(id) ? withMedia("messages.get", sql`m.id = ${id}::uuid`) : Promise.resolve(null),

    getByMetaId: (metaMessageId) =>
      withMedia("messages.getByMetaId", sql`m.meta_message_id = ${metaMessageId}`),

    async history(conversationId, limit) {
      if (limit <= 0 || !isUuid(conversationId)) return [];
      const rows = await jsonRows<MessageWithMediaRow>(
        db,
        "messages.history",
        sql`select ${WITH_MEDIA} as r from sendo_messages m
            where m.conversation_id = ${conversationId}::uuid
            order by m.created_at desc, m.id desc limit ${limit}`,
      );
      return rows.reverse().map(toMessageWithMedia);
    },

    async thread(conversationId, query) {
      if (!isUuid(conversationId)) return { items: [], nextCursor: null };
      const cursor = decodeCursor(query.cursor);
      const after = cursor
        ? sql` and (m.created_at < ${cursor.t}::timestamptz or (m.created_at = ${cursor.t}::timestamptz and m.id < ${cursor.id}::uuid))`
        : sql``;
      const rows = await jsonRows<MessageWithMediaRow>(
        db,
        "messages.thread",
        sql`select ${WITH_MEDIA} as r from sendo_messages m
            where m.conversation_id = ${conversationId}::uuid${after}
            order by m.created_at desc, m.id desc limit ${query.limit + 1}`,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toMessageWithMedia),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
      };
    },

    countInboundSince: (contactId, since) =>
      isUuid(contactId)
        ? scalar(
            db,
            "messages.countInboundSince",
            sql`select count(*) from sendo_messages m
                join sendo_conversations c on c.id = m.conversation_id
                where c.contact_id = ${contactId}::uuid and m.direction = 'in'
                  and m.created_at >= ${since.toISOString()}::timestamptz`,
          )
        : Promise.resolve(0),

    async updateMetadata(id, patch) {
      if (!isUuid(id)) throw notFound(id);
      const row = await jsonRow<MessageRow>(
        db,
        "messages.updateMetadata",
        sql`update sendo_messages as t set metadata = t.metadata || ${jsonb(patch)}
            where t.id = ${id}::uuid and t.conversation_id is not null
            returning to_jsonb(t) as r`,
      );
      if (!row) throw notFound(id);
      return toMessage(row);
    },

    async update(id, patch) {
      const operation = "messages.update";
      if (!isUuid(id)) throw notFound(id);
      const { content, ...plain } = messagePatchToRow(patch);
      const sets: SQL[] = [];
      if (Object.keys(plain).length > 0) sets.push(assignments(plain));
      if (content !== undefined) sets.push(sql`content = ${jsonb(content)}`);
      if (patch.metadata !== undefined) {
        sets.push(sql`metadata = t.metadata || ${jsonb(patch.metadata)}`);
      }
      const row = await jsonRow<MessageRow>(
        db,
        operation,
        sets.length > 0
          ? sql`update sendo_messages as t set ${sql.join(sets, sql`, `)}
                where t.id = ${id}::uuid and t.conversation_id is not null
                returning to_jsonb(t) as r`
          : sql`select to_jsonb(t) as r from sendo_messages t
                where t.id = ${id}::uuid and t.conversation_id is not null`,
        MESSAGE_CONSTRAINTS,
      );
      if (!row) throw notFound(id);
      return toMessage(row);
    },

    async deleteDrafts(conversationId) {
      if (!isUuid(conversationId)) return 0;
      const rows = await execute(
        db,
        "messages.deleteDrafts",
        sql`delete from sendo_messages m
            where m.conversation_id = ${conversationId}::uuid and m.draft returning m.id`,
      );
      return rows.length;
    },

    async pendingDraftConversations(conversationIds) {
      if (conversationIds.length === 0) return [];
      const rows = await execute(
        db,
        "messages.pendingDraftConversations",
        sql`select distinct m.conversation_id from sendo_messages m
            where m.draft and m.conversation_id = any(${uuidArray(conversationIds)})`,
      );
      return rows.map((r) => String(r.conversation_id));
    },
  };
}
