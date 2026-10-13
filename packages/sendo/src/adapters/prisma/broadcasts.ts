import { BROADCAST_RECIPIENT_STATUSES, type BroadcastRecipientStatus } from "../../types/enums";
import { decodeCursor, encodeCursor } from "../supabase/query";
import {
  type BroadcastRecipientRow,
  type BroadcastRow,
  toBroadcast,
  toBroadcastRecipient,
} from "../supabase/broadcasts";
import type { BroadcastPatch, BroadcastRecipientPatch, SendoAdapter } from "../types";
import {
  type Db,
  PG_FOREIGN_KEY_VIOLATION,
  Params,
  PrismaAdapterError,
  dbFailure,
  insertClause,
  insertRowsClause,
  isUuid,
  setClause,
  tenantMatch,
  writeFailure,
} from "./db";
import { BROADCAST_CONSTRAINTS, RECIPIENT_CONSTRAINTS, notFound } from "./shared";

/** Recipients per insert statement. */
const RECIPIENT_BATCH = 1000;

const statuses = <S extends string>(status: S | S[]): S[] =>
  Array.isArray(status) ? status : [status];

function broadcastPatchToRow(patch: BroadcastPatch): Record<string, unknown> {
  return {
    status: patch.status,
    pause_reason: patch.pauseReason,
    rate_per_minute: patch.ratePerMinute,
    variables: patch.variables,
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
    error: patch.error,
  };
}

/** A foreign-key violation on `constraint`. */
function brokeForeignKey(error: unknown, constraint: string): boolean {
  const failure = dbFailure(error);
  return failure.code === PG_FOREIGN_KEY_VIOLATION && failure.constraint === constraint;
}

export function prismaBroadcasts(db: Db): SendoAdapter["broadcasts"] {
  const broadcasts = db.t("sendo_broadcasts");
  const recipients = db.t("sendo_broadcast_recipients");

  const getRow = async (operation: string, id: string): Promise<BroadcastRow | null> => {
    if (!isUuid(id)) return null;
    const params = new Params();
    return db.row<BroadcastRow>(
      operation,
      `select to_jsonb(b.*) as row from ${broadcasts} b where b.id = ${params.add(id, "uuid")}`,
      params,
    );
  };

  /** The first of `contactIds` with no contact row (for a foreign-key failure). */
  const firstMissingContact = async (contactIds: string[]): Promise<string | undefined> => {
    const bad = contactIds.find((id) => !isUuid(id));
    if (bad !== undefined) return bad;
    const params = new Params();
    const found = await db.query<{ id: string }>(
      "broadcasts.insertRecipients",
      `select k.id::text as id from ${db.t("sendo_contacts")} k where k.id = any(${params.add(contactIds, "uuid[]")})`,
      params,
    );
    const known = new Set(found.map((r) => r.id));
    return contactIds.find((id) => !known.has(id.toLowerCase()));
  };

  return {
    async insert(input) {
      if (!isUuid(input.accountId)) throw notFound("account", input.accountId);
      const params = new Params();
      const result = await db.attempt<{ row: BroadcastRow }>(
        `insert into ${broadcasts} as b ${insertClause(params, {
          tenant_id: input.tenantId,
          account_id: input.accountId,
          template_name: input.templateName,
          language: input.language,
          category: input.category,
          variables: input.variables ?? null,
          rate_per_minute: input.ratePerMinute ?? 60,
          status: input.status ?? "queued",
          created_by: input.createdBy ?? null,
        })} returning to_jsonb(b.*) as row`,
        params,
      );
      if (result.failed) {
        if (brokeForeignKey(result.error, "sendo_broadcasts_account_id_fkey")) {
          throw notFound("account", input.accountId);
        }
        throw writeFailure("broadcasts.insert", result.error, BROADCAST_CONSTRAINTS);
      }
      const row = result.rows[0]?.row;
      if (!row) throw new PrismaAdapterError("broadcasts.insert", { message: "no row returned" });
      return toBroadcast(row);
    },

    async get(id) {
      const row = await getRow("broadcasts.get", id);
      return row ? toBroadcast(row) : null;
    },

    async list(query) {
      const params = new Params();
      const where = [tenantMatch(params, "b.tenant_id", query.tenantId)];
      if (query.accountId !== undefined) {
        where.push(
          isUuid(query.accountId)
            ? `b.account_id = ${params.add(query.accountId, "uuid")}`
            : "false",
        );
      }
      if (query.status !== undefined) {
        where.push(`b.status = any(${params.add(statuses(query.status), "text[]")})`);
      }
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        where.push(
          `(b.created_at, b.id) < (${params.add(cursor.t, "timestamptz")}, ${params.add(cursor.id, "uuid")})`,
        );
      }
      const rows = await db.rows<BroadcastRow>(
        "broadcasts.list",
        `select to_jsonb(b.*) as row from ${broadcasts} b where ${where.join(" and ")}
         order by b.created_at desc, b.id desc limit ${params.add(query.limit + 1, "int")}`,
        params,
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
      if (!isUuid(id)) throw notFound("broadcast", id);
      const params = new Params();
      const assignments = setClause(params, broadcastPatchToRow(patch));
      if (assignments === "") {
        const row = await getRow(operation, id);
        if (!row) throw notFound("broadcast", id);
        return toBroadcast(row);
      }
      const result = await db.attempt<{ row: BroadcastRow }>(
        `update ${broadcasts} b set ${assignments} where b.id = ${params.add(id, "uuid")}
         returning to_jsonb(b.*) as row`,
        params,
      );
      if (result.failed) throw writeFailure(operation, result.error, BROADCAST_CONSTRAINTS);
      const row = result.rows[0]?.row;
      if (!row) throw notFound("broadcast", id);
      return toBroadcast(row);
    },

    async insertRecipients(broadcastId, list) {
      const operation = "broadcasts.insertRecipients";
      const broadcast = await getRow(operation, broadcastId);
      if (!broadcast) throw notFound("broadcast", broadcastId);
      const byContact = new Map<string, Record<string, unknown>>();
      // Every recipient write stamps `updated_at` with the app clock (see `updateRecipient`),
      // so `nextPending` orders by one clock.
      const at = new Date();
      for (const r of list) {
        if (byContact.has(r.contactId)) continue;
        byContact.set(r.contactId, {
          tenant_id: broadcast.tenant_id,
          broadcast_id: broadcastId,
          contact_id: r.contactId,
          variables: r.variables ?? null,
          status: r.status ?? "pending",
          skip_reason: r.skipReason ?? null,
          updated_at: at,
        });
      }
      const contactIds = [...byContact.keys()];
      const bad = contactIds.find((id) => !isUuid(id));
      if (bad !== undefined) throw notFound("contact", bad);
      const rows = [...byContact.values()];
      let inserted = 0;
      for (let i = 0; i < rows.length; i += RECIPIENT_BATCH) {
        const batch = rows.slice(i, i + RECIPIENT_BATCH);
        const params = new Params();
        const result = await db.attempt<{ id: string }>(
          `insert into ${recipients} ${insertRowsClause(params, batch)}
           on conflict (broadcast_id, contact_id) do nothing returning id`,
          params,
        );
        if (result.failed) {
          if (brokeForeignKey(result.error, "sendo_broadcast_recipients_contact_id_fkey")) {
            throw notFound("contact", (await firstMissingContact(contactIds)) ?? "");
          }
          throw writeFailure(operation, result.error, RECIPIENT_CONSTRAINTS);
        }
        inserted += result.rows.length;
      }
      return inserted;
    },

    async nextPending(broadcastId, limit) {
      const n = Math.max(0, Math.floor(limit));
      if (n === 0 || !isUuid(broadcastId)) return [];
      const params = new Params();
      const rows = await db.rows<BroadcastRecipientRow>(
        "broadcasts.nextPending",
        `select to_jsonb(r.*) as row from ${recipients} r
         where r.broadcast_id = ${params.add(broadcastId, "uuid")} and r.status = 'pending'
         order by r.updated_at asc, r.id asc limit ${params.add(n, "int")}`,
        params,
      );
      return rows.map(toBroadcastRecipient);
    },

    async updateRecipient(id, patch) {
      const operation = "broadcasts.updateRecipient";
      if (!isUuid(id)) throw notFound("broadcast_recipient", id);
      if (patch.messageId != null && !isUuid(patch.messageId)) {
        throw notFound("message", patch.messageId);
      }
      const params = new Params();
      const result = await db.attempt<{ row: BroadcastRecipientRow }>(
        `update ${recipients} r set ${setClause(params, recipientPatchToRow(patch, new Date()))}
         where r.id = ${params.add(id, "uuid")} returning to_jsonb(r.*) as row`,
        params,
      );
      if (result.failed) {
        if (brokeForeignKey(result.error, "sendo_broadcast_recipients_message_id_fkey")) {
          throw notFound("message", patch.messageId ?? "");
        }
        throw writeFailure(operation, result.error, RECIPIENT_CONSTRAINTS);
      }
      const row = result.rows[0]?.row;
      if (!row) throw notFound("broadcast_recipient", id);
      return toBroadcastRecipient(row);
    },

    async recipientByMessageId(messageId) {
      if (!isUuid(messageId)) return null;
      const params = new Params();
      const row = await db.row<BroadcastRecipientRow>(
        "broadcasts.recipientByMessageId",
        `select to_jsonb(r.*) as row from ${recipients} r
         where r.message_id = ${params.add(messageId, "uuid")} limit 1`,
        params,
      );
      return row ? toBroadcastRecipient(row) : null;
    },

    async listRecipients(query) {
      if (!isUuid(query.broadcastId)) return { items: [], nextCursor: null };
      const params = new Params();
      const where = [`r.broadcast_id = ${params.add(query.broadcastId, "uuid")}`];
      if (query.status !== undefined) {
        where.push(`r.status = any(${params.add(statuses(query.status), "text[]")})`);
      }
      if (query.cursor != null && isUuid(query.cursor)) {
        where.push(`r.id > ${params.add(query.cursor, "uuid")}`);
      }
      const rows = await db.rows<BroadcastRecipientRow>(
        "broadcasts.listRecipients",
        `select to_jsonb(r.*) as row from ${recipients} r where ${where.join(" and ")}
         order by r.id asc limit ${params.add(query.limit + 1, "int")}`,
        params,
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
      const params = new Params();
      return db.execute(
        "broadcasts.cancelPending",
        `update ${recipients} r
         set status = 'cancelled', updated_at = ${params.add(new Date().toISOString(), "timestamptz")}
         where r.broadcast_id = ${params.add(broadcastId, "uuid")} and r.status = 'pending'`,
        params,
      );
    },

    async counts(broadcastId) {
      const counts = Object.fromEntries(BROADCAST_RECIPIENT_STATUSES.map((s) => [s, 0])) as Record<
        BroadcastRecipientStatus,
        number
      >;
      if (!isUuid(broadcastId)) return counts;
      const params = new Params();
      const rows = await db.query<{ status: BroadcastRecipientStatus; n: number }>(
        "broadcasts.counts",
        `select r.status, count(*)::int as n from ${recipients} r
         where r.broadcast_id = ${params.add(broadcastId, "uuid")} group by r.status`,
        params,
      );
      for (const row of rows) if (row.status in counts) counts[row.status] = row.n;
      return counts;
    },
  };
}
