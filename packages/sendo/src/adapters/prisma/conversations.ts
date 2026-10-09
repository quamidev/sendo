import type { Page } from "../../types/entities";
import type { ConversationStatus } from "../../types/enums";
import { searchNeedles, sortSourceCounts } from "../shared";
import { decodeCursor, encodeCursor } from "../supabase/query";
import {
  type ContactRow,
  type ConversationRow,
  type MessageRow,
  conversationPatchToRow,
  toConversation,
  toConversationListItem,
} from "../supabase/rows";
import type {
  ConversationFilter,
  ConversationListItem,
  GetOpenOrCreateInput,
  GetOpenOrCreateResult,
  SendoAdapter,
} from "../types";
import {
  type Db,
  Params,
  PrismaAdapterError,
  isUniqueViolation,
  isUuid,
  setClause,
  tenantMatch,
} from "./db";
import { notFound } from "./shared";

const OPEN_STATUSES: ConversationStatus[] = ["agent", "human"];

function statusList(status: ConversationStatus | ConversationStatus[]): ConversationStatus[] {
  return Array.isArray(status) ? status : [status];
}

/** `ilike` substring pattern; `%`, `_` and `\` in the needle match literally. */
function likePattern(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** `where` conditions on `sendo_conversations c` for `filter` (ANDed; `true` when empty). */
function conversationWhere(db: Db, params: Params, filter: ConversationFilter): string {
  const where: string[] = [];
  if (filter.tenantId !== undefined)
    where.push(tenantMatch(params, "c.tenant_id", filter.tenantId));
  if (filter.accountId !== undefined) {
    where.push(
      isUuid(filter.accountId) ? `c.account_id = ${params.add(filter.accountId, "uuid")}` : "false",
    );
  }
  if (filter.status !== undefined) {
    where.push(`c.status::text = any(${params.add(statusList(filter.status), "text[]")})`);
  }
  if (filter.assignedTo === null) where.push("c.assigned_to is null");
  else if (filter.assignedTo !== undefined) {
    where.push(`c.assigned_to = ${params.add(filter.assignedTo, "text")}`);
  }
  if (filter.queue === null) where.push("c.queue is null");
  else if (filter.queue !== undefined) where.push(`c.queue = ${params.add(filter.queue, "text")}`);
  if (filter.visibleTo) {
    const user = params.add(filter.visibleTo.userId, "text");
    const queues = params.add(filter.visibleTo.queues, "text[]");
    where.push(
      `(c.assigned_to = ${user} or (c.assigned_to is null and (c.queue is null or c.queue = any(${queues}))))`,
    );
  }
  const tagIds = (filter.tagIds ?? []).filter(isUuid);
  if ((filter.tagIds ?? []).length > 0) {
    where.push(
      `exists (select 1 from ${db.t("sendo_conversation_tags")} ct where ct.conversation_id = c.id ` +
        `and ct.tag_id = any(${params.add(tagIds, "uuid[]")}))`,
    );
  }
  const needles = searchNeedles(filter.search);
  if (needles) {
    const text = params.add(likePattern(needles.text), "text");
    const parts = [`k.profile_name ilike ${text}`, `k.app_ref ilike ${text}`];
    if (needles.phone !== "") {
      parts.push(`k.phone ilike ${params.add(likePattern(needles.phone), "text")}`);
    }
    where.push(
      `exists (select 1 from ${db.t("sendo_contacts")} k where k.id = c.contact_id and (${parts.join(" or ")}))`,
    );
  }
  return where.length > 0 ? where.join(" and ") : "true";
}

export function prismaConversations(db: Db): SendoAdapter["conversations"] {
  const conversations = db.t("sendo_conversations");

  const getRow = async (operation: string, id: string): Promise<ConversationRow | null> => {
    if (!isUuid(id)) return null;
    const params = new Params();
    return db.row<ConversationRow>(
      operation,
      `select to_jsonb(c.*) as row from ${conversations} c where c.id = ${params.add(id, "uuid")}`,
      params,
    );
  };

  const findOpen = async (input: GetOpenOrCreateInput): Promise<ConversationRow | null> => {
    const params = new Params();
    return db.row<ConversationRow>(
      "conversations.getOpenOrCreate",
      `select to_jsonb(c.*) as row from ${conversations} c
       where c.contact_id = ${params.add(input.contactId, "uuid")}
         and c.account_id = ${params.add(input.accountId, "uuid")}
         and c.status <> 'closed'
       order by c.created_at desc limit 1`,
      params,
    );
  };

  return {
    async getOpenOrCreate(input): Promise<GetOpenOrCreateResult> {
      const operation = "conversations.getOpenOrCreate";
      // Concurrent callers race on the partial unique index (one open conversation per
      // contact); the loser re-reads the winner's row.
      for (let attempt = 0; attempt < 3; attempt++) {
        const open = await findOpen(input);
        if (open) return { conversation: toConversation(open), created: false, reopened: false };

        const lookup = new Params();
        const closed = await db.row<ConversationRow>(
          operation,
          `select to_jsonb(c.*) as row from ${conversations} c
           where c.contact_id = ${lookup.add(input.contactId, "uuid")}
             and c.account_id = ${lookup.add(input.accountId, "uuid")}
           order by c.created_at desc, c.id desc limit 1`,
          lookup,
        );

        const params = new Params();
        const result = closed
          ? await db.attempt<{ row: ConversationRow }>(
              `update ${conversations} c
               set status = 'agent', assigned_to = null, assigned_at = null, handoff_reason = null
               where c.id = ${params.add(closed.id, "uuid")} and c.status = 'closed'
               returning to_jsonb(c.*) as row`,
              params,
            )
          : await db.attempt<{ row: ConversationRow }>(
              `insert into ${conversations} as c (tenant_id, account_id, contact_id, channel, status)
               values (${params.add(input.tenantId, "uuid")}, ${params.add(input.accountId, "uuid")},
                       ${params.add(input.contactId, "uuid")}, ${params.add(input.channel ?? "whatsapp", "text")},
                       'agent')
               returning to_jsonb(c.*) as row`,
              params,
            );
        if (result.failed) {
          if (isUniqueViolation(result.error, "sendo_conversations_open_contact_key")) continue;
          throw new PrismaAdapterError(operation, result.error);
        }
        const row = result.rows[0]?.row;
        if (!row) continue;
        return { conversation: toConversation(row), created: !closed, reopened: Boolean(closed) };
      }
      const open = await findOpen(input);
      if (open) return { conversation: toConversation(open), created: false, reopened: false };
      throw new PrismaAdapterError(operation, {
        message: `could not open a conversation for contact ${input.contactId}`,
      });
    },

    async get(id) {
      const row = await getRow("conversations.get", id);
      return row ? toConversation(row) : null;
    },

    async update(id, patch) {
      const operation = "conversations.update";
      if (!isUuid(id)) throw notFound("conversation", id);
      const { incrementUnread, ...fields } = patch;
      const values = conversationPatchToRow(fields);
      const params = new Params();
      if (incrementUnread) {
        // One statement: the increment applies on top of `unreadCount` when both are given.
        const base =
          values.unread_count === undefined
            ? "c.unread_count"
            : params.add(values.unread_count, "int");
        delete values.unread_count;
        const assignments = [setClause(params, values)].filter((s) => s !== "");
        assignments.push(
          `unread_count = greatest(0, ${base} + ${params.add(incrementUnread, "int")})`,
        );
        const row = await db.row<ConversationRow>(
          operation,
          `update ${conversations} c set ${assignments.join(", ")}
           where c.id = ${params.add(id, "uuid")} returning to_jsonb(c.*) as row`,
          params,
        );
        if (!row) throw notFound("conversation", id);
        return toConversation(row);
      }
      const assignments = setClause(params, values);
      const row =
        assignments === ""
          ? await getRow(operation, id)
          : await db.row<ConversationRow>(
              operation,
              `update ${conversations} c set ${assignments}
               where c.id = ${params.add(id, "uuid")} returning to_jsonb(c.*) as row`,
              params,
            );
      if (!row) throw notFound("conversation", id);
      return toConversation(row);
    },

    async list(query): Promise<Page<ConversationListItem>> {
      const params = new Params();
      const where = [conversationWhere(db, params, query)];
      const cursor = decodeCursor(query.cursor);
      if (cursor) {
        where.push(
          `(c.last_activity_at, c.id) < (${params.add(cursor.t, "timestamptz")}, ${params.add(cursor.id, "uuid")})`,
        );
      }
      const rows = await db.query<{
        row: ConversationRow;
        contact: ContactRow | null;
        last_message: MessageRow | null;
      }>(
        "conversations.list",
        `select to_jsonb(c.*) as row, to_jsonb(k.*) as contact,
           (select to_jsonb(m.*) from ${db.t("sendo_messages")} m
            where m.conversation_id = c.id
            order by m.created_at desc, m.id desc limit 1) as last_message
         from ${conversations} c
         join ${db.t("sendo_contacts")} k on k.id = c.contact_id
         where ${where.join(" and ")}
         order by c.last_activity_at desc, c.id desc
         limit ${params.add(query.limit + 1, "int")}`,
        params,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1)?.row;
      return {
        items: page.map((r) =>
          toConversationListItem({
            ...r.row,
            sendo_contacts: r.contact,
            sendo_messages: r.last_message,
          }),
        ),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.last_activity_at, last.id) : null,
      };
    },

    async count(filter) {
      const params = new Params();
      const [row] = await db.query<{ n: number }>(
        "conversations.count",
        `select count(*)::int as n from ${conversations} c where ${conversationWhere(db, params, filter)}`,
        params,
      );
      return row?.n ?? 0;
    },

    async countBySource(query) {
      const params = new Params();
      const where = [tenantMatch(params, "c.tenant_id", query.tenantId)];
      if (query.accountId !== undefined) {
        where.push(
          isUuid(query.accountId)
            ? `c.account_id = ${params.add(query.accountId, "uuid")}`
            : "false",
        );
      }
      if (query.from)
        where.push(`c.created_at >= ${params.add(query.from.toISOString(), "timestamptz")}`);
      if (query.to)
        where.push(`c.created_at < ${params.add(query.to.toISOString(), "timestamptz")}`);
      const rows = await db.query<{ source: string | null; conversations: number }>(
        "conversations.countBySource",
        `select c.source, count(*)::int as conversations from ${conversations} c
         where ${where.join(" and ")} group by c.source`,
        params,
      );
      return sortSourceCounts(
        rows.map((r) => ({ source: r.source, conversations: r.conversations })),
      );
    },

    async countByAssignee(query) {
      const statuses = query.status === undefined ? OPEN_STATUSES : statusList(query.status);
      const assignees = [...new Set(query.assignees)];
      const counts: Record<string, number> = Object.fromEntries(assignees.map((id) => [id, 0]));
      if (assignees.length === 0) return counts;
      const params = new Params();
      const rows = await db.query<{ assigned_to: string; n: number }>(
        "conversations.countByAssignee",
        `select c.assigned_to, count(*)::int as n from ${conversations} c
         where ${tenantMatch(params, "c.tenant_id", query.tenantId)}
           and c.assigned_to = any(${params.add(assignees, "text[]")})
           and c.status::text = any(${params.add(statuses, "text[]")})
         group by c.assigned_to`,
        params,
      );
      for (const row of rows) counts[row.assigned_to] = row.n;
      return counts;
    },

    async findForTick(query) {
      const limit = Math.max(0, Math.floor(query.limit));
      if (limit === 0) return [];
      const params = new Params();
      const where = [tenantMatch(params, "c.tenant_id", query.tenantId)];
      if (query.accountId !== undefined) {
        where.push(
          isUuid(query.accountId)
            ? `c.account_id = ${params.add(query.accountId, "uuid")}`
            : "false",
        );
      }
      let order: string;
      if (query.type === "escalate") {
        where.push(
          "c.status = 'human'",
          "c.awaiting_reply_since is not null",
          `c.awaiting_reply_since < ${params.add(query.waitingSince.toISOString(), "timestamptz")}`,
          "(c.escalated_at is null or c.escalated_at < c.awaiting_reply_since)",
        );
        if (query.queue !== undefined) {
          where.push(`c.queue is not distinct from ${params.add(query.queue, "text")}`);
        }
        order = "c.awaiting_reply_since asc, c.id asc";
      } else {
        where.push(
          "c.status <> 'closed'",
          `c.last_activity_at < ${params.add(query.inactiveSince.toISOString(), "timestamptz")}`,
        );
        order = "c.last_activity_at asc, c.id asc";
      }
      const rows = await db.rows<ConversationRow>(
        "conversations.findForTick",
        `select to_jsonb(c.*) as row from ${conversations} c
         where ${where.join(" and ")} order by ${order} limit ${params.add(limit, "int")}`,
        params,
      );
      return rows.map(toConversation);
    },
  };
}
