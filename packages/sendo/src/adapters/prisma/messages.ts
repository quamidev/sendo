import type { MessageError } from "../../types/entities";
import type { MessageStatus } from "../../types/enums";
import { canTransition } from "../../utils/status";
import { decodeCursor, encodeCursor } from "../supabase/query";
import {
  type MediaRow,
  type MessageRow,
  messagePatchToRow,
  toMessage,
  toMessageWithMedia,
} from "../supabase/rows";
import type { SendoAdapter, StatusUpdateResult } from "../types";
import {
  type Db,
  Params,
  PrismaAdapterError,
  columnParam,
  insertClause,
  isUuid,
  setClause,
  writeFailure,
} from "./db";
import { MESSAGE_CONSTRAINTS, notFound } from "./shared";

const DELIVERY_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

type WithMediaRow = { row: MessageRow; media: MediaRow | null };

/** Same key as the SQL functions, so the Prisma adapter and `sendo_*` RPCs serialize together. */
const metaLock = (tx: Db, metaMessageId: string): Promise<number> => {
  const params = new Params();
  return tx.execute(
    "messages.lock",
    `select pg_advisory_xact_lock(hashtextextended(${params.add(`sendo_meta:${metaMessageId}`, "text")}, 0))`,
    params,
  );
};

export function prismaMessages(
  db: Db,
  transaction: <R>(fn: (tx: Db) => Promise<R>) => Promise<R>,
): SendoAdapter["messages"] {
  const messages = db.t("sendo_messages");

  /** Messages (never placeholders) with their newest media row. */
  const withMedia = async (operation: string, where: string, params: Params, tail = "") => {
    const rows = await db.query<WithMediaRow>(
      operation,
      `select to_jsonb(m.*) as row,
         (select to_jsonb(md.*) from ${db.t("sendo_media")} md
          where md.message_id = m.id order by md.created_at desc, md.id desc limit 1) as media
       from ${messages} m
       where m.conversation_id is not null and ${where} ${tail}`,
      params,
    );
    return rows.map((r) => ({ ...r.row, sendo_media: r.media }));
  };

  const updateReturning = async (
    operation: string,
    id: string,
    assignments: string,
    params: Params,
  ): Promise<MessageRow | null> =>
    db.row<MessageRow>(
      operation,
      `update ${messages} m set ${assignments}
       where m.id = ${params.add(id, "uuid")} and m.conversation_id is not null
       returning to_jsonb(m.*) as row`,
      params,
    );

  return {
    async insertInbound(input) {
      const params = new Params();
      const row = await db.row<MessageRow>(
        "messages.insertInbound",
        `insert into ${messages} as m ${insertClause(params, {
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
          sent_at: input.sentAt,
        })}
        on conflict (meta_message_id) do nothing
        returning to_jsonb(m.*) as row`,
        params,
      );
      return row ? toMessage(row) : null;
    },

    async insertOutbound(input) {
      const params = new Params();
      const sent = input.status === "sent";
      const result = await db.attempt<{ row: MessageRow }>(
        `insert into ${messages} as m ${insertClause(params, {
          tenant_id: input.tenantId,
          conversation_id: input.conversationId,
          direction: "out",
          type: input.type,
          content: input.content,
          text: input.text ?? null,
          reply_to_meta_id: input.replyToMetaId ?? null,
          status: input.status ?? "pending",
          sent_at: sent ? new Date() : undefined,
          sender: input.sender,
          sender_ref: input.senderRef ?? null,
          metadata: input.metadata ?? {},
          internal: input.internal ?? false,
          draft: input.draft ?? false,
          tokens_in: input.tokensIn ?? null,
          tokens_out: input.tokensOut ?? null,
          cost_cents: input.costCents ?? null,
        })}
        returning to_jsonb(m.*) as row`,
        params,
      );
      if (result.failed) {
        throw writeFailure("messages.insertOutbound", result.error, MESSAGE_CONSTRAINTS);
      }
      const row = result.rows[0]?.row;
      if (!row) throw new PrismaAdapterError("messages.insertOutbound", { message: "no row" });
      return toMessage(row);
    },

    async markSent(id, metaMessageId) {
      const operation = "messages.markSent";
      if (!isUuid(id)) throw notFound("message", id);
      // Port of `sendo_mark_sent`: lock the Meta id, fold the placeholder that holds it (status
      // and error, forward-only) into the real row and delete it, in one transaction.
      const row = await transaction(async (tx) => {
        await metaLock(tx, metaMessageId);
        const select = new Params();
        const msg = await tx.row<MessageRow>(
          operation,
          `select to_jsonb(m.*) as row from ${messages} m
           where m.id = ${select.add(id, "uuid")} and m.conversation_id is not null for update`,
          select,
        );
        if (!msg) return null;
        const del = new Params();
        const placeholder = await tx.row<{ status: MessageStatus; error: MessageError | null }>(
          operation,
          `delete from ${messages} m
           where m.meta_message_id = ${del.add(metaMessageId, "text")} and m.type = 'status_placeholder'
           returning jsonb_build_object('status', m.status, 'error', m.error) as row`,
          del,
        );
        let status: MessageStatus = canTransition(msg.status, "sent") ? "sent" : msg.status;
        let error = msg.error;
        if (placeholder && canTransition(status, placeholder.status)) {
          status = placeholder.status;
          if (status === "failed") error = placeholder.error;
        }
        const params = new Params();
        return tx.row<MessageRow>(
          operation,
          `update ${messages} m
           set meta_message_id = ${params.add(metaMessageId, "text")},
               status = ${params.add(status)},
               error = ${columnParam(params, "error", error)},
               sent_at = coalesce(m.sent_at, now())
           where m.id = ${params.add(id, "uuid")}
           returning to_jsonb(m.*) as row`,
          params,
        );
      });
      if (!row) throw notFound("message", id);
      return toMessage(row);
    },

    async markFailed(id, error) {
      if (!isUuid(id)) throw notFound("message", id);
      const params = new Params();
      const row = await updateReturning(
        "messages.markFailed",
        id,
        `status = 'failed', error = ${columnParam(params, "error", error)}`,
        params,
      );
      if (!row) throw notFound("message", id);
      return toMessage(row);
    },

    async updateStatus(metaMessageId, status, opts = {}): Promise<StatusUpdateResult> {
      const operation = "messages.updateStatus";
      if (!DELIVERY_STATUSES.has(status)) {
        throw new PrismaAdapterError(operation, { message: `invalid status ${status}` });
      }
      // Port of `sendo_update_message_status`: forward-only under the Meta-id lock; a status
      // for an unknown id is parked in a placeholder row.
      return transaction(async (tx) => {
        await metaLock(tx, metaMessageId);
        for (let attempt = 0; attempt < 3; attempt++) {
          const select = new Params();
          const current = await tx.row<{ id: string; type: string; status: MessageStatus }>(
            operation,
            `select jsonb_build_object('id', m.id, 'type', m.type, 'status', m.status) as row
             from ${messages} m where m.meta_message_id = ${select.add(metaMessageId, "text")}
             for update`,
            select,
          );
          if (current) {
            const isPlaceholder = current.type === "status_placeholder";
            if (!canTransition(current.status, status)) {
              return isPlaceholder ? "placeholder" : "ignored";
            }
            const params = new Params();
            const assignments = [`status = ${params.add(status)}`];
            if (status === "failed") {
              assignments.push(`error = ${columnParam(params, "error", opts.error ?? null)}`);
            }
            if (status === "sent" && !isPlaceholder) {
              const at = opts.at ? params.add(opts.at.toISOString(), "timestamptz") : "now()";
              assignments.push(`sent_at = coalesce(m.sent_at, ${at})`);
            }
            await tx.execute(
              operation,
              `update ${messages} m set ${assignments.join(", ")} where m.id = ${params.add(current.id, "uuid")}`,
              params,
            );
            return isPlaceholder ? "placeholder" : "updated";
          }
          const params = new Params();
          const inserted = await tx.execute(
            operation,
            `insert into ${messages} ${insertClause(params, {
              conversation_id: null,
              direction: "out",
              type: "status_placeholder",
              content: {},
              meta_message_id: metaMessageId,
              status,
              error: status === "failed" ? (opts.error ?? null) : null,
              sender: "system",
            })}
            on conflict (meta_message_id) do nothing`,
            params,
          );
          if (inserted > 0) return "placeholder";
        }
        throw new PrismaAdapterError(operation, {
          message: `could not apply status to ${metaMessageId}`,
        });
      });
    },

    async get(id) {
      if (!isUuid(id)) return null;
      const params = new Params();
      const [row] = await withMedia("messages.get", `m.id = ${params.add(id, "uuid")}`, params);
      return row ? toMessageWithMedia(row) : null;
    },

    async getByMetaId(metaMessageId) {
      const params = new Params();
      const [row] = await withMedia(
        "messages.getByMetaId",
        `m.meta_message_id = ${params.add(metaMessageId, "text")}`,
        params,
      );
      return row ? toMessageWithMedia(row) : null;
    },

    async history(conversationId, limit) {
      if (limit <= 0 || !isUuid(conversationId)) return [];
      const params = new Params();
      const rows = await withMedia(
        "messages.history",
        `m.conversation_id = ${params.add(conversationId, "uuid")}`,
        params,
        `order by m.created_at desc, m.id desc limit ${params.add(limit, "int")}`,
      );
      return rows.reverse().map(toMessageWithMedia);
    },

    async thread(conversationId, query) {
      if (!isUuid(conversationId)) return { items: [], nextCursor: null };
      const params = new Params();
      const where = [`m.conversation_id = ${params.add(conversationId, "uuid")}`];
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        where.push(
          `(m.created_at, m.id) < (${params.add(cursor.t, "timestamptz")}, ${params.add(cursor.id, "uuid")})`,
        );
      }
      const rows = await withMedia(
        "messages.thread",
        where.join(" and "),
        params,
        `order by m.created_at desc, m.id desc limit ${params.add(query.limit + 1, "int")}`,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toMessageWithMedia),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
      };
    },

    async countInboundSince(contactId, since) {
      if (!isUuid(contactId)) return 0;
      const params = new Params();
      const [row] = await db.query<{ n: number }>(
        "messages.countInboundSince",
        `select count(*)::int as n from ${messages} m
         join ${db.t("sendo_conversations")} c on c.id = m.conversation_id
         where c.contact_id = ${params.add(contactId, "uuid")} and m.direction = 'in'
           and m.created_at >= ${params.add(since.toISOString(), "timestamptz")}`,
        params,
      );
      return row?.n ?? 0;
    },

    async updateMetadata(id, patch) {
      if (!isUuid(id)) throw notFound("message", id);
      const params = new Params();
      const row = await updateReturning(
        "messages.updateMetadata",
        id,
        `metadata = m.metadata || ${columnParam(params, "metadata", patch)}`,
        params,
      );
      if (!row) throw notFound("message", id);
      return toMessage(row);
    },

    async update(id, patch) {
      const operation = "messages.update";
      if (!isUuid(id)) throw notFound("message", id);
      const params = new Params();
      // One statement: direct columns plus the shallow metadata merge.
      const assignments = [setClause(params, messagePatchToRow(patch))].filter((s) => s !== "");
      if (patch.metadata !== undefined) {
        assignments.push(
          `metadata = m.metadata || ${columnParam(params, "metadata", patch.metadata)}`,
        );
      }
      if (assignments.length === 0) {
        const select = new Params();
        const row = await db.row<MessageRow>(
          operation,
          `select to_jsonb(m.*) as row from ${messages} m
           where m.id = ${select.add(id, "uuid")} and m.conversation_id is not null`,
          select,
        );
        if (!row) throw notFound("message", id);
        return toMessage(row);
      }
      const result = await db.attempt<{ row: MessageRow }>(
        `update ${messages} m set ${assignments.join(", ")}
         where m.id = ${params.add(id, "uuid")} and m.conversation_id is not null
         returning to_jsonb(m.*) as row`,
        params,
      );
      if (result.failed) throw writeFailure(operation, result.error, MESSAGE_CONSTRAINTS);
      const row = result.rows[0]?.row;
      if (!row) throw notFound("message", id);
      return toMessage(row);
    },

    async deleteDrafts(conversationId) {
      if (!isUuid(conversationId)) return 0;
      const params = new Params();
      return db.execute(
        "messages.deleteDrafts",
        `delete from ${messages} m where m.conversation_id = ${params.add(conversationId, "uuid")} and m.draft`,
        params,
      );
    },

    async pendingDraftConversations(conversationIds) {
      const ids = [...new Set(conversationIds)].filter(isUuid);
      if (ids.length === 0) return [];
      const params = new Params();
      const rows = await db.query<{ conversation_id: string }>(
        "messages.pendingDraftConversations",
        `select distinct m.conversation_id::text as conversation_id from ${messages} m
         where m.draft and m.conversation_id = any(${params.add(ids, "uuid[]")})`,
        params,
      );
      return rows.map((r) => r.conversation_id);
    },
  };
}
