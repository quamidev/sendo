import { type SQL, sql } from "drizzle-orm";
import { RecordNotFoundError } from "../../errors";
import type { Page } from "../../types/entities";
import type { ConversationStatus } from "../../types/enums";
import { searchNeedles, sortSourceCounts } from "../shared";
import type { ConversationFilter, ConversationListItem, SendoAdapter } from "../types";
import { decodeCursor, encodeCursor } from "../supabase/query";
import {
  type ConversationListRow,
  type ConversationRow,
  conversationPatchToRow,
  toConversation,
  toConversationListItem,
} from "../supabase/rows";
import {
  type DrizzleDatabase,
  assignments,
  execute,
  isUniqueViolation,
  isUuid,
  jsonRow,
  jsonRows,
  likePattern,
  scalar,
  tenantEq,
  textArray,
  uuidArray,
  uuidEq,
  DrizzleAdapterError,
} from "./db";

const OPEN_STATUSES: ConversationStatus[] = ["agent", "human"];

const statusList = (status: ConversationStatus | ConversationStatus[]): ConversationStatus[] =>
  Array.isArray(status) ? status : [status];

/** `ConversationFilter` over `sendo_conversations c` joined with `sendo_contacts ct`. */
export function conversationWhere(filter: ConversationFilter): SQL {
  const parts: SQL[] = [sql`true`];
  if (filter.tenantId !== undefined) parts.push(tenantEq(sql`c.tenant_id`, filter.tenantId));
  if (filter.accountId !== undefined) parts.push(uuidEq(sql`c.account_id`, filter.accountId));
  const excluded = filter.excludeAccountIds ?? [];
  if (excluded.length > 0) {
    parts.push(sql`not (c.account_id = any(${uuidArray(excluded)}))`);
  }
  if (filter.status !== undefined) {
    parts.push(sql`c.status::text = any(${textArray(statusList(filter.status))})`);
  }
  if (filter.assignedTo === null) parts.push(sql`c.assigned_to is null`);
  else if (filter.assignedTo !== undefined) parts.push(sql`c.assigned_to = ${filter.assignedTo}`);
  if (filter.queue === null) parts.push(sql`c.queue is null`);
  else if (filter.queue !== undefined) parts.push(sql`c.queue = ${filter.queue}`);
  if (filter.visibleTo) {
    const { userId, queues } = filter.visibleTo;
    parts.push(
      sql`(c.assigned_to = ${userId} or (c.assigned_to is null and (c.queue is null or c.queue = any(${textArray(queues)}))))`,
    );
  }
  const tagIds = filter.tagIds ?? [];
  if (tagIds.length > 0) {
    parts.push(
      sql`exists (select 1 from sendo_conversation_tags x where x.conversation_id = c.id and x.tag_id = any(${uuidArray(tagIds)}))`,
    );
  }
  const needles = searchNeedles(filter.search);
  if (needles) {
    const text = likePattern(needles.text);
    const phone =
      needles.phone === "" ? sql`` : sql` or ct.phone ilike ${likePattern(needles.phone)}`;
    parts.push(sql`(ct.profile_name ilike ${text} or ct.app_ref ilike ${text}${phone})`);
  }
  return sql.join(parts, sql` and `);
}

export function drizzleConversations(db: DrizzleDatabase): SendoAdapter["conversations"] {
  const notFound = (id: string) => new RecordNotFoundError({ entity: "conversation", id });

  const getRow = (operation: string, id: string): Promise<ConversationRow | null> =>
    isUuid(id)
      ? jsonRow<ConversationRow>(
          db,
          operation,
          sql`select to_jsonb(t) as r from sendo_conversations t where t.id = ${id}::uuid`,
        )
      : Promise.resolve(null);

  const findOpen = (contactId: string, accountId: string) =>
    jsonRow<ConversationRow>(
      db,
      "conversations.getOpenOrCreate",
      sql`select to_jsonb(t) as r from sendo_conversations t
          where t.contact_id = ${contactId}::uuid and t.account_id = ${accountId}::uuid
            and t.status <> 'closed'
          order by t.created_at desc limit 1`,
    );

  return {
    async getOpenOrCreate(input) {
      const operation = "conversations.getOpenOrCreate";
      // Concurrent callers race on the partial unique index (one open conversation per
      // contact); the loser re-reads the winner's row.
      for (let attempt = 0; attempt < 3; attempt++) {
        const open = await findOpen(input.contactId, input.accountId);
        if (open) return { conversation: toConversation(open), created: false, reopened: false };
        try {
          const reopened = await jsonRow<ConversationRow>(
            db,
            operation,
            sql`update sendo_conversations as t
                set status = 'agent', assigned_to = null, assigned_at = null, handoff_reason = null
                where t.id = (
                  select l.id from sendo_conversations l
                  where l.contact_id = ${input.contactId}::uuid and l.account_id = ${input.accountId}::uuid
                  order by l.created_at desc, l.id desc limit 1
                ) and t.status = 'closed'
                returning to_jsonb(t) as r`,
          );
          if (reopened) {
            return { conversation: toConversation(reopened), created: false, reopened: true };
          }
          const latest = await scalar(
            db,
            operation,
            sql`select count(*) from sendo_conversations l
                where l.contact_id = ${input.contactId}::uuid and l.account_id = ${input.accountId}::uuid`,
          );
          if (latest > 0) continue;
          const created = await jsonRow<ConversationRow>(
            db,
            operation,
            sql`insert into sendo_conversations as t (tenant_id, account_id, contact_id, channel, status)
                values (${input.tenantId}::uuid, ${input.accountId}::uuid, ${input.contactId}::uuid,
                        ${input.channel ?? "whatsapp"}, 'agent')
                returning to_jsonb(t) as r`,
          );
          if (created)
            return { conversation: toConversation(created), created: true, reopened: false };
        } catch (error) {
          if (isUniqueViolation(error, "sendo_conversations_open_contact_key")) continue;
          throw error;
        }
      }
      const open = await findOpen(input.contactId, input.accountId);
      if (open) return { conversation: toConversation(open), created: false, reopened: false };
      throw new DrizzleAdapterError(
        operation,
        null,
        `could not open a conversation for contact ${input.contactId}`,
      );
    },

    async get(id) {
      const row = await getRow("conversations.get", id);
      return row ? toConversation(row) : null;
    },

    async update(id, patch) {
      const operation = "conversations.update";
      const { incrementUnread, ...fields } = patch;
      const values = conversationPatchToRow(fields);
      if (!isUuid(id)) throw notFound(id);
      const sets: SQL[] = [];
      if (Object.keys(values).length > 0) {
        const { unread_count: unread, ...rest } = values;
        if (Object.keys(rest).length > 0) sets.push(assignments(rest));
        if (incrementUnread) {
          const base = unread === undefined ? sql`t.unread_count` : sql`${unread}::int`;
          sets.push(sql`unread_count = greatest(0, ${base} + ${incrementUnread}::int)`);
        } else if (unread !== undefined) {
          sets.push(sql`unread_count = ${unread}::int`);
        }
      } else if (incrementUnread) {
        sets.push(sql`unread_count = greatest(0, t.unread_count + ${incrementUnread}::int)`);
      }
      const row =
        sets.length > 0
          ? await jsonRow<ConversationRow>(
              db,
              operation,
              sql`update sendo_conversations as t set ${sql.join(sets, sql`, `)}
                  where t.id = ${id}::uuid returning to_jsonb(t) as r`,
            )
          : await getRow(operation, id);
      if (!row) throw notFound(id);
      return toConversation(row);
    },

    async list(query): Promise<Page<ConversationListItem>> {
      const cursor = decodeCursor(query.cursor);
      const after = cursor
        ? sql` and (c.last_activity_at < ${cursor.t}::timestamptz or (c.last_activity_at = ${cursor.t}::timestamptz and c.id < ${cursor.id}::uuid))`
        : sql``;
      const rows = await jsonRows<ConversationListRow>(
        db,
        "conversations.list",
        sql`select to_jsonb(c) || jsonb_build_object(
              'sendo_contacts', to_jsonb(ct),
              'sendo_messages', (
                select to_jsonb(m) from sendo_messages m
                where m.conversation_id = c.id
                order by m.created_at desc, m.id desc limit 1
              )
            ) as r
            from sendo_conversations c
            join sendo_contacts ct on ct.id = c.contact_id
            where ${conversationWhere(query)}${after}
            order by c.last_activity_at desc, c.id desc
            limit ${query.limit + 1}`,
      );
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(toConversationListItem),
        nextCursor:
          rows.length > query.limit && last ? encodeCursor(last.last_activity_at, last.id) : null,
      };
    },

    count: (filter) =>
      scalar(
        db,
        "conversations.count",
        sql`select count(*) from sendo_conversations c
            join sendo_contacts ct on ct.id = c.contact_id
            where ${conversationWhere(filter)}`,
      ),

    async countBySource(query) {
      const range: SQL[] = [];
      if (query.accountId !== undefined) range.push(uuidEq(sql`c.account_id`, query.accountId));
      if (query.from) range.push(sql`c.created_at >= ${query.from.toISOString()}::timestamptz`);
      if (query.to) range.push(sql`c.created_at < ${query.to.toISOString()}::timestamptz`);
      const rows = await execute(
        db,
        "conversations.countBySource",
        sql`select c.source, count(*)::int as conversations from sendo_conversations c
            where ${sql.join([tenantEq(sql`c.tenant_id`, query.tenantId), ...range], sql` and `)}
            group by c.source`,
      );
      return sortSourceCounts(
        rows.map((r) => ({
          source: typeof r.source === "string" ? r.source : null,
          conversations: Number(r.conversations),
        })),
      );
    },

    async countByAssignee(query) {
      const statuses = query.status === undefined ? OPEN_STATUSES : statusList(query.status);
      const assignees = [...new Set(query.assignees)];
      const counts: Record<string, number> = Object.fromEntries(assignees.map((a) => [a, 0]));
      if (assignees.length === 0) return counts;
      const rows = await execute(
        db,
        "conversations.countByAssignee",
        sql`select c.assigned_to, count(*)::int as n from sendo_conversations c
            where ${tenantEq(sql`c.tenant_id`, query.tenantId)}
              and c.status::text = any(${textArray(statuses)})
              and c.assigned_to = any(${textArray(assignees)})
            group by c.assigned_to`,
      );
      for (const row of rows) counts[String(row.assigned_to)] = Number(row.n);
      return counts;
    },

    async findForTick(query) {
      const limit = Math.max(0, Math.floor(query.limit));
      if (limit === 0) return [];
      const account =
        query.accountId === undefined ? sql`true` : uuidEq(sql`c.account_id`, query.accountId);
      const rows =
        query.type === "escalate"
          ? await jsonRows<ConversationRow>(
              db,
              "conversations.findForTick",
              sql`select to_jsonb(c) as r from sendo_conversations c
                  where ${tenantEq(sql`c.tenant_id`, query.tenantId)}
                    and c.status = 'human'
                    and c.awaiting_reply_since is not null
                    and c.awaiting_reply_since < ${query.waitingSince.toISOString()}::timestamptz
                    and (c.escalated_at is null or c.escalated_at < c.awaiting_reply_since)
                    and ${account}
                    and ${query.queue === undefined ? sql`true` : sql`c.queue is not distinct from ${query.queue}::text`}
                  order by c.awaiting_reply_since asc, c.id asc
                  limit ${limit}`,
            )
          : await jsonRows<ConversationRow>(
              db,
              "conversations.findForTick",
              sql`select to_jsonb(c) as r from sendo_conversations c
                  where ${tenantEq(sql`c.tenant_id`, query.tenantId)}
                    and c.status <> 'closed'
                    and c.last_activity_at < ${query.inactiveSince.toISOString()}::timestamptz
                    and ${account}
                  order by c.last_activity_at asc, c.id asc
                  limit ${limit}`,
            );
      return rows.map(toConversation);
    },
  };
}
