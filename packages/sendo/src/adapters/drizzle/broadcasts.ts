import { type SQL, sql } from "drizzle-orm";
import { RecordNotFoundError } from "../../errors";
import type { RecordEntity } from "../../errors/errors";
import { BROADCAST_RECIPIENT_STATUSES, type BroadcastRecipientStatus } from "../../types/enums";
import type { BroadcastPatch, BroadcastRecipientPatch, SendoAdapter } from "../types";
import { decodeCursor, encodeCursor } from "../supabase/query";
import {
  type BroadcastRecipientRow,
  type BroadcastRow,
  toBroadcast,
  toBroadcastRecipient,
} from "../supabase/broadcasts";
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
  missingForeignKey,
  param,
  textArray,
  writeFailure,
  tenantEq,
} from "./db";

const BROADCAST_CONSTRAINTS = [
  "sendo_broadcasts_status_check",
  "sendo_broadcasts_rate_per_minute_check",
] as const;
const RECIPIENT_CONSTRAINTS = ["sendo_broadcast_recipients_status_check"] as const;
/** Recipients per insert statement (7 parameters each, far below Postgres' 65535). */
const RECIPIENT_BATCH = 1000;

function broadcastPatchToRow(patch: BroadcastPatch): Record<string, unknown> {
  return {
    status: patch.status,
    pause_reason: patch.pauseReason,
    rate_per_minute: patch.ratePerMinute,
    variables: patch.variables === undefined ? undefined : jsonb(patch.variables),
    started_at: patch.startedAt,
    finished_at: patch.finishedAt,
  };
}

function recipientPatchToRow(patch: BroadcastRecipientPatch, at: Date): Record<string, unknown> {
  return {
    updated_at: at,
    status: patch.status,
    message_id: patch.messageId,
    skip_reason: patch.skipReason,
    error: patch.error === undefined ? undefined : jsonb(patch.error),
  };
}

const defined = (values: Record<string, unknown>): boolean =>
  Object.values(values).some((v) => v !== undefined);

const statusList = <S extends string>(status: S | S[]): S[] =>
  Array.isArray(status) ? status : [status];

export function drizzleBroadcasts(db: DrizzleDatabase): SendoAdapter["broadcasts"] {
  const notFound = (entity: RecordEntity, id: string) => new RecordNotFoundError({ entity, id });

  const getRow = (operation: string, id: string) =>
    isUuid(id)
      ? jsonRow<BroadcastRow>(
          db,
          operation,
          sql`select to_jsonb(t) as r from sendo_broadcasts t where t.id = ${id}::uuid`,
        )
      : Promise.resolve(null);

  return {
    async insert(input) {
      const operation = "broadcasts.insert";
      if (!isUuid(input.accountId)) throw notFound("account", input.accountId);
      try {
        const row = await jsonRow<BroadcastRow>(
          db,
          operation,
          insertReturning("sendo_broadcasts", {
            tenant_id: input.tenantId,
            account_id: input.accountId,
            template_name: input.templateName,
            language: input.language,
            category: input.category,
            variables: jsonb(input.variables ?? null),
            rate_per_minute: input.ratePerMinute ?? 60,
            status: input.status ?? "queued",
            created_by: input.createdBy ?? null,
          }),
          BROADCAST_CONSTRAINTS,
        );
        if (!row) throw new DrizzleAdapterError(operation, null, "no row returned");
        return toBroadcast(row);
      } catch (error) {
        if (missingForeignKey(error, "account_id") !== null) {
          throw notFound("account", input.accountId);
        }
        throw error;
      }
    },

    async get(id) {
      const row = await getRow("broadcasts.get", id);
      return row ? toBroadcast(row) : null;
    },

    async list(query) {
      const parts: SQL[] = [tenantEq(sql`t.tenant_id`, query.tenantId)];
      if (query.accountId !== undefined) {
        parts.push(
          isUuid(query.accountId) ? sql`t.account_id = ${query.accountId}::uuid` : sql`false`,
        );
      }
      if (query.status !== undefined) {
        parts.push(sql`t.status = any(${textArray(statusList(query.status))})`);
      }
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        parts.push(
          sql`(t.created_at < ${cursor.t}::timestamptz or (t.created_at = ${cursor.t}::timestamptz and t.id < ${cursor.id}::uuid))`,
        );
      }
      const rows = await jsonRows<BroadcastRow>(
        db,
        "broadcasts.list",
        sql`select to_jsonb(t) as r from sendo_broadcasts t where ${sql.join(parts, sql` and `)}
            order by t.created_at desc, t.id desc limit ${query.limit + 1}`,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toBroadcast),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
      };
    },

    async update(id, patch) {
      const operation = "broadcasts.update";
      const values = broadcastPatchToRow(patch);
      if (!defined(values)) {
        const row = await getRow(operation, id);
        if (!row) throw notFound("broadcast", id);
        return toBroadcast(row);
      }
      const row = isUuid(id)
        ? await jsonRow<BroadcastRow>(
            db,
            operation,
            sql`update sendo_broadcasts as t set ${assignments(values)}
                where t.id = ${id}::uuid returning to_jsonb(t) as r`,
            BROADCAST_CONSTRAINTS,
          )
        : null;
      if (!row) throw notFound("broadcast", id);
      return toBroadcast(row);
    },

    async insertRecipients(broadcastId, recipients) {
      const operation = "broadcasts.insertRecipients";
      const broadcast = await getRow(operation, broadcastId);
      if (!broadcast) throw notFound("broadcast", broadcastId);
      const byContact = new Map<string, (typeof recipients)[number]>();
      for (const r of recipients) if (!byContact.has(r.contactId)) byContact.set(r.contactId, r);
      const bad = [...byContact.keys()].find((id) => !isUuid(id));
      if (bad !== undefined) throw notFound("contact", bad);
      // Every recipient write stamps `updated_at` with the app clock (see `updateRecipient`), so
      // `nextPending` never orders by two clocks.
      const at = new Date();
      const rows = [...byContact.values()];
      let inserted = 0;
      for (let i = 0; i < rows.length; i += RECIPIENT_BATCH) {
        const values = rows.slice(i, i + RECIPIENT_BATCH).map(
          (r) =>
            sql`(${broadcast.tenant_id}::uuid, ${broadcastId}::uuid, ${r.contactId}::uuid,
                 ${jsonb(r.variables ?? null)}, ${r.status ?? "pending"}, ${r.skipReason ?? null},
                 ${param(at)}::timestamptz)`,
        );
        try {
          const result = await execute(
            db,
            operation,
            sql`insert into sendo_broadcast_recipients
                  (tenant_id, broadcast_id, contact_id, variables, status, skip_reason, updated_at)
                values ${sql.join(values, sql`, `)}
                on conflict (broadcast_id, contact_id) do nothing
                returning id`,
            RECIPIENT_CONSTRAINTS,
          );
          inserted += result.length;
        } catch (error) {
          const contactId = missingForeignKey(error, "contact_id");
          if (contactId !== null) throw notFound("contact", contactId);
          throw error;
        }
      }
      return inserted;
    },

    async nextPending(broadcastId, limit) {
      const n = Math.max(0, Math.floor(limit));
      if (n === 0 || !isUuid(broadcastId)) return [];
      const rows = await jsonRows<BroadcastRecipientRow>(
        db,
        "broadcasts.nextPending",
        sql`select to_jsonb(t) as r from sendo_broadcast_recipients t
            where t.broadcast_id = ${broadcastId}::uuid and t.status = 'pending'
            order by t.updated_at asc, t.id asc limit ${n}`,
      );
      return rows.map(toBroadcastRecipient);
    },

    async updateRecipient(id, patch) {
      const operation = "broadcasts.updateRecipient";
      if (!isUuid(id)) throw notFound("broadcast_recipient", id);
      if (patch.messageId != null && !isUuid(patch.messageId)) {
        throw notFound("message", patch.messageId);
      }
      try {
        const row = await jsonRow<BroadcastRecipientRow>(
          db,
          operation,
          sql`update sendo_broadcast_recipients as t
              set ${assignments(recipientPatchToRow(patch, new Date()))}
              where t.id = ${id}::uuid returning to_jsonb(t) as r`,
          RECIPIENT_CONSTRAINTS,
        );
        if (!row) throw notFound("broadcast_recipient", id);
        return toBroadcastRecipient(row);
      } catch (error) {
        if (missingForeignKey(error, "message_id") !== null) {
          throw notFound("message", patch.messageId ?? "");
        }
        throw writeFailure(operation, error, RECIPIENT_CONSTRAINTS);
      }
    },

    async recipientByMessageId(messageId) {
      if (!isUuid(messageId)) return null;
      const row = await jsonRow<BroadcastRecipientRow>(
        db,
        "broadcasts.recipientByMessageId",
        sql`select to_jsonb(t) as r from sendo_broadcast_recipients t
            where t.message_id = ${messageId}::uuid limit 1`,
      );
      return row ? toBroadcastRecipient(row) : null;
    },

    async listRecipients(query) {
      if (!isUuid(query.broadcastId)) return { items: [], nextCursor: null };
      const parts: SQL[] = [sql`t.broadcast_id = ${query.broadcastId}::uuid`];
      if (query.status !== undefined) {
        parts.push(sql`t.status = any(${textArray(statusList(query.status))})`);
      }
      if (query.cursor != null && isUuid(query.cursor)) {
        parts.push(sql`t.id > ${query.cursor}::uuid`);
      }
      const rows = await jsonRows<BroadcastRecipientRow>(
        db,
        "broadcasts.listRecipients",
        sql`select to_jsonb(t) as r from sendo_broadcast_recipients t
            where ${sql.join(parts, sql` and `)}
            order by t.id asc limit ${query.limit + 1}`,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toBroadcastRecipient),
        nextCursor: rows.length > query.limit && last ? last.id : null,
      };
    },

    async cancelPending(broadcastId) {
      if (!isUuid(broadcastId)) return 0;
      const rows = await execute(
        db,
        "broadcasts.cancelPending",
        sql`update sendo_broadcast_recipients as t
            set status = 'cancelled', updated_at = ${new Date().toISOString()}::timestamptz
            where t.broadcast_id = ${broadcastId}::uuid and t.status = 'pending'
            returning t.id`,
      );
      return rows.length;
    },

    async counts(broadcastId) {
      const counts = Object.fromEntries(BROADCAST_RECIPIENT_STATUSES.map((s) => [s, 0])) as Record<
        BroadcastRecipientStatus,
        number
      >;
      if (!isUuid(broadcastId)) return counts;
      const rows = await execute(
        db,
        "broadcasts.counts",
        sql`select t.status, count(*)::int as n from sendo_broadcast_recipients t
            where t.broadcast_id = ${broadcastId}::uuid group by t.status`,
      );
      for (const row of rows) {
        const status = BROADCAST_RECIPIENT_STATUSES.find((s) => s === row.status);
        if (status) counts[status] = Number(row.n);
      }
      return counts;
    },
  };
}
