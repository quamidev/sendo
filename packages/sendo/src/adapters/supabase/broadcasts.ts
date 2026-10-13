import type { SupabaseClient } from "@supabase/supabase-js";
import { RecordNotFoundError } from "../../errors";
import type { RecordEntity } from "../../errors/errors";
import type {
  Broadcast,
  BroadcastRecipient,
  JsonValue,
  MessageError,
  TenantId,
} from "../../types/entities";
import {
  BROADCAST_RECIPIENT_STATUSES,
  type BroadcastRecipientStatus,
  type BroadcastStatus,
  type TemplateCategory,
} from "../../types/enums";
import type { BroadcastPatch, BroadcastRecipientPatch, SendoAdapter } from "../types";
import { type DbError, SupabaseAdapterError, isInvalidId } from "./errors";
import {
  UUID_RE,
  afterCursorFilter,
  decodeCursor,
  encodeCursor,
  execById,
  execCount,
  settle,
  writeFailure,
} from "./query";

type Timestamp = string;

export interface BroadcastRow {
  id: string;
  tenant_id: TenantId;
  account_id: string;
  template_name: string;
  language: string;
  category: TemplateCategory;
  variables: JsonValue | null;
  rate_per_minute: number;
  status: BroadcastStatus;
  pause_reason: string | null;
  created_by: string | null;
  created_at: Timestamp;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
}

export interface BroadcastRecipientRow {
  id: string;
  tenant_id: TenantId;
  broadcast_id: string;
  contact_id: string;
  variables: JsonValue | null;
  message_id: string | null;
  status: BroadcastRecipientStatus;
  skip_reason: string | null;
  error: MessageError | null;
  updated_at: Timestamp;
}

const date = (t: Timestamp | null): Date | null => (t === null ? null : new Date(t));
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export function toBroadcast(row: BroadcastRow): Broadcast {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountId: row.account_id,
    templateName: row.template_name,
    language: row.language,
    category: row.category,
    variables: row.variables,
    ratePerMinute: row.rate_per_minute,
    status: row.status,
    pauseReason: row.pause_reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    startedAt: date(row.started_at),
    finishedAt: date(row.finished_at),
  };
}

export function toBroadcastRecipient(row: BroadcastRecipientRow): BroadcastRecipient {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    broadcastId: row.broadcast_id,
    contactId: row.contact_id,
    variables: row.variables,
    messageId: row.message_id,
    status: row.status,
    skipReason: row.skip_reason,
    error: row.error,
    updatedAt: new Date(row.updated_at),
  };
}

function broadcastPatchToRow(patch: BroadcastPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.pauseReason !== undefined) row.pause_reason = patch.pauseReason;
  if (patch.ratePerMinute !== undefined) row.rate_per_minute = patch.ratePerMinute;
  if (patch.variables !== undefined) row.variables = patch.variables;
  if (patch.startedAt !== undefined) row.started_at = iso(patch.startedAt);
  if (patch.finishedAt !== undefined) row.finished_at = iso(patch.finishedAt);
  return row;
}

function recipientPatchToRow(patch: BroadcastRecipientPatch, at: Date): Record<string, unknown> {
  const row: Record<string, unknown> = { updated_at: at.toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.messageId !== undefined) row.message_id = patch.messageId;
  if (patch.skipReason !== undefined) row.skip_reason = patch.skipReason;
  if (patch.error !== undefined) row.error = patch.error;
  return row;
}

const BROADCAST_CONSTRAINTS = [
  "sendo_broadcasts_status_check",
  "sendo_broadcasts_rate_per_minute_check",
] as const;
const RECIPIENT_CONSTRAINTS = ["sendo_broadcast_recipients_status_check"] as const;
/** Recipients per insert request (each request is one statement). */
const RECIPIENT_BATCH = 1000;
const PG_FOREIGN_KEY_VIOLATION = "23503";
const isUuid = (value: string): boolean => UUID_RE.test(value);

/** The id in a foreign-key violation's `Key (column)=(id) is not present...` detail. */
function missingKey(error: DbError, column: string): string | null {
  if (error.code !== PG_FOREIGN_KEY_VIOLATION) return null;
  const match = new RegExp(`Key \\(${column}\\)=\\(([^)]+)\\)`).exec(
    `${error.details ?? ""} ${error.message}`,
  );
  return match?.[1] ?? null;
}

export function supabaseBroadcasts(db: SupabaseClient): SendoAdapter["broadcasts"] {
  const notFound = (entity: RecordEntity, id: string) => new RecordNotFoundError({ entity, id });

  const getRow = (operation: string, id: string) =>
    execById<BroadcastRow>(
      operation,
      db.from("sendo_broadcasts").select("*").eq("id", id).maybeSingle(),
    );

  return {
    async insert(input) {
      const operation = "broadcasts.insert";
      const { data, error } = await settle(
        db
          .from("sendo_broadcasts")
          .insert({
            tenant_id: input.tenantId,
            account_id: input.accountId,
            template_name: input.templateName,
            language: input.language,
            category: input.category,
            variables: input.variables ?? null,
            rate_per_minute: input.ratePerMinute ?? 60,
            status: input.status ?? "queued",
            created_by: input.createdBy ?? null,
          })
          .select("*")
          .single(),
      );
      if (error) {
        if (isInvalidId(error) || missingKey(error, "account_id") !== null) {
          throw notFound("account", input.accountId);
        }
        throw writeFailure(operation, error, BROADCAST_CONSTRAINTS);
      }
      return toBroadcast(data as BroadcastRow);
    },

    async get(id) {
      const row = await getRow("broadcasts.get", id);
      return row ? toBroadcast(row) : null;
    },

    async list(query) {
      let q = db.from("sendo_broadcasts").select("*");
      q = query.tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", query.tenantId);
      if (query.accountId !== undefined) q = q.eq("account_id", query.accountId);
      if (query.status !== undefined) {
        q = q.in("status", Array.isArray(query.status) ? query.status : [query.status]);
      }
      const cursor = decodeCursor(query.cursor);
      if (cursor) q = q.or(afterCursorFilter("created_at", cursor));
      const rows =
        (await execById<BroadcastRow[]>(
          "broadcasts.list",
          q
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(query.limit + 1),
        )) ?? [];
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
      if (Object.keys(values).length === 0) {
        const row = await getRow(operation, id);
        if (!row) throw notFound("broadcast", id);
        return toBroadcast(row);
      }
      const { data, error } = await settle(
        db.from("sendo_broadcasts").update(values).eq("id", id).select("*").maybeSingle(),
      );
      if (error) {
        if (isInvalidId(error)) throw notFound("broadcast", id);
        throw writeFailure(operation, error, BROADCAST_CONSTRAINTS);
      }
      if (!data) throw notFound("broadcast", id);
      return toBroadcast(data as BroadcastRow);
    },

    async insertRecipients(broadcastId, recipients) {
      const operation = "broadcasts.insertRecipients";
      const broadcast = await getRow(operation, broadcastId);
      if (!broadcast) throw notFound("broadcast", broadcastId);
      const byContact = new Map<string, Record<string, unknown>>();
      // Every recipient write stamps `updated_at` with the same (app) clock: a DB `now()` default
      // here and an app clock in `updateRecipient` would order `nextPending` by two clocks.
      const at = new Date().toISOString();
      for (const r of recipients) {
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
      const rows = [...byContact.values()];
      let inserted = 0;
      for (let i = 0; i < rows.length; i += RECIPIENT_BATCH) {
        const { data, error } = await settle(
          db
            .from("sendo_broadcast_recipients")
            .upsert(rows.slice(i, i + RECIPIENT_BATCH), {
              onConflict: "broadcast_id,contact_id",
              ignoreDuplicates: true,
            })
            .select("id"),
        );
        if (error) {
          const contactId = missingKey(error, "contact_id");
          if (contactId !== null) throw notFound("contact", contactId);
          if (isInvalidId(error)) {
            const bad = [...byContact.keys()].find((id) => !isUuid(id));
            throw notFound("contact", bad ?? "");
          }
          throw writeFailure(operation, error, RECIPIENT_CONSTRAINTS);
        }
        inserted += (data as unknown[] | null)?.length ?? 0;
      }
      return inserted;
    },

    async nextPending(broadcastId, limit) {
      const n = Math.max(0, Math.floor(limit));
      if (n === 0) return [];
      const rows =
        (await execById<BroadcastRecipientRow[]>(
          "broadcasts.nextPending",
          db
            .from("sendo_broadcast_recipients")
            .select("*")
            .eq("broadcast_id", broadcastId)
            .eq("status", "pending")
            .order("updated_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(n),
        )) ?? [];
      return rows.map(toBroadcastRecipient);
    },

    async updateRecipient(id, patch) {
      const operation = "broadcasts.updateRecipient";
      if (!isUuid(id)) throw notFound("broadcast_recipient", id);
      const { data, error } = await settle(
        db
          .from("sendo_broadcast_recipients")
          .update(recipientPatchToRow(patch, new Date()))
          .eq("id", id)
          .select("*")
          .maybeSingle(),
      );
      if (error) {
        if (missingKey(error, "message_id") !== null || isInvalidId(error)) {
          throw notFound("message", patch.messageId ?? "");
        }
        throw writeFailure(operation, error, RECIPIENT_CONSTRAINTS);
      }
      if (!data) throw notFound("broadcast_recipient", id);
      return toBroadcastRecipient(data as BroadcastRecipientRow);
    },

    async recipientByMessageId(messageId) {
      const row = await execById<BroadcastRecipientRow>(
        "broadcasts.recipientByMessageId",
        db
          .from("sendo_broadcast_recipients")
          .select("*")
          .eq("message_id", messageId)
          .limit(1)
          .maybeSingle(),
      );
      return row ? toBroadcastRecipient(row) : null;
    },

    async listRecipients(query) {
      if (!isUuid(query.broadcastId)) return { items: [], nextCursor: null };
      let q = db
        .from("sendo_broadcast_recipients")
        .select("*")
        .eq("broadcast_id", query.broadcastId);
      if (query.status !== undefined) {
        q = q.in("status", Array.isArray(query.status) ? query.status : [query.status]);
      }
      if (query.cursor != null && isUuid(query.cursor)) q = q.gt("id", query.cursor);
      const rows =
        (await execById<BroadcastRecipientRow[]>(
          "broadcasts.listRecipients",
          q.order("id", { ascending: true }).limit(query.limit + 1),
        )) ?? [];
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toBroadcastRecipient),
        nextCursor: rows.length > query.limit && last ? last.id : null,
      };
    },

    async cancelPending(broadcastId) {
      const { error, count } = await settle(
        db
          .from("sendo_broadcast_recipients")
          .update({ status: "cancelled", updated_at: new Date().toISOString() }, { count: "exact" })
          .eq("broadcast_id", broadcastId)
          .eq("status", "pending"),
      );
      if (error) {
        if (isInvalidId(error)) return 0;
        throw new SupabaseAdapterError("broadcasts.cancelPending", error);
      }
      return count ?? 0;
    },

    async counts(broadcastId) {
      const counts = await Promise.all(
        BROADCAST_RECIPIENT_STATUSES.map(async (status) => {
          if (!isUuid(broadcastId)) return 0;
          return execCount(
            "broadcasts.counts",
            db
              .from("sendo_broadcast_recipients")
              .select("id", { count: "exact", head: true })
              .eq("broadcast_id", broadcastId)
              .eq("status", status),
          );
        }),
      );
      return Object.fromEntries(
        BROADCAST_RECIPIENT_STATUSES.map((status, i) => [status, counts[i] ?? 0]),
      ) as Record<BroadcastRecipientStatus, number>;
    },
  };
}
