import type { Tag } from "../../types/entities";
import type { RecordEntity } from "../../errors/errors";
import { compareRules, compareSnippets, compareTags } from "../shared";
import {
  type ConversationRow,
  type RuleRow,
  type SnippetRow,
  type TagRow,
  rulePatchToRow,
  toRule,
  toSnippet,
  toTag,
} from "../supabase/rows";
import type { RuleUpsertInput, RuleUpsertResult, SendoAdapter } from "../types";
import {
  type Db,
  Params,
  PrismaAdapterError,
  insertClause,
  isUniqueViolation,
  isUuid,
  setClause,
  tenantMatch,
  writeFailure,
} from "./db";
import { RULE_CONSTRAINTS, SNIPPET_CONSTRAINTS, TAG_CONSTRAINTS, notFound } from "./shared";

/** Deletes one row by id; unknown or malformed id → `RecordNotFoundError`. */
async function deleteById(db: Db, table: string, entity: RecordEntity, id: string): Promise<void> {
  if (!isUuid(id)) throw notFound(entity, id);
  const params = new Params();
  const deleted = await db.execute(
    `${entity}s.delete`,
    `delete from ${db.t(table)} x where x.id = ${params.add(id, "uuid")}`,
    params,
  );
  if (deleted === 0) throw notFound(entity, id);
}

async function selectById<T>(
  db: Db,
  operation: string,
  table: string,
  id: string,
): Promise<T | null> {
  if (!isUuid(id)) return null;
  const params = new Params();
  return db.row<T>(
    operation,
    `select to_jsonb(x.*) as row from ${db.t(table)} x where x.id = ${params.add(id, "uuid")}`,
    params,
  );
}

export function prismaSnippets(db: Db): SendoAdapter["snippets"] {
  const snippets = db.t("sendo_snippets");
  return {
    async list(query) {
      const params = new Params();
      const where = [tenantMatch(params, "s.tenant_id", query.tenantId)];
      where.push(
        query.userId === undefined
          ? "s.visibility = 'tenant'"
          : `(s.visibility = 'tenant' or (s.visibility = 'personal' and s.owner_user_id = ${params.add(query.userId, "text")}))`,
      );
      if (query.accountId !== undefined) {
        where.push(
          isUuid(query.accountId)
            ? `(s.account_id is null or s.account_id = ${params.add(query.accountId, "uuid")})`
            : "s.account_id is null",
        );
      }
      const rows = await db.rows<SnippetRow>(
        "snippets.list",
        `select to_jsonb(s.*) as row from ${snippets} s where ${where.join(" and ")}`,
        params,
      );
      return rows.map(toSnippet).sort(compareSnippets);
    },

    async get(id) {
      const row = await selectById<SnippetRow>(db, "snippets.get", "sendo_snippets", id);
      return row ? toSnippet(row) : null;
    },

    async upsert(input) {
      const operation = "snippets.upsert";
      const at = new Date();
      const params = new Params();
      let sql: string;
      if (input.id !== undefined) {
        if (!isUuid(input.id)) throw notFound("snippet", input.id);
        const values: Record<string, unknown> = {
          shortcut: input.shortcut,
          body: input.body,
          updated_by: input.by ?? null,
          updated_at: at,
          account_id: input.accountId,
          visibility: input.visibility,
          owner_user_id: input.ownerUserId,
        };
        sql = `update ${snippets} s set ${setClause(params, values)}
               where s.id = ${params.add(input.id, "uuid")} and ${tenantMatch(params, "s.tenant_id", input.tenantId)}
               returning to_jsonb(s.*) as row`;
      } else {
        sql = `insert into ${snippets} as s ${insertClause(params, {
          tenant_id: input.tenantId,
          account_id: input.accountId ?? null,
          shortcut: input.shortcut,
          body: input.body,
          visibility: input.visibility ?? "tenant",
          owner_user_id: input.ownerUserId ?? null,
          created_by: input.by ?? null,
          updated_by: input.by ?? null,
          created_at: at,
          updated_at: at,
        })} returning to_jsonb(s.*) as row`;
      }
      const result = await db.attempt<{ row: SnippetRow }>(sql, params);
      if (result.failed) throw writeFailure(operation, result.error, SNIPPET_CONSTRAINTS);
      const row = result.rows[0]?.row;
      if (!row) throw notFound("snippet", input.id ?? "");
      return toSnippet(row);
    },

    delete: (id) => deleteById(db, "sendo_snippets", "snippet", id),
  };
}

export function prismaTags(db: Db): SendoAdapter["tags"] {
  const tags = db.t("sendo_tags");
  const links = db.t("sendo_conversation_tags");
  return {
    async list(query) {
      const params = new Params();
      const rows = await db.rows<TagRow>(
        "tags.list",
        `select to_jsonb(g.*) as row from ${tags} g where ${tenantMatch(params, "g.tenant_id", query.tenantId)}`,
        params,
      );
      return rows.map(toTag).sort(compareTags);
    },

    async get(id) {
      const row = await selectById<TagRow>(db, "tags.get", "sendo_tags", id);
      return row ? toTag(row) : null;
    },

    async upsert(input) {
      const operation = "tags.upsert";
      const params = new Params();
      let sql: string;
      if (input.id !== undefined) {
        if (!isUuid(input.id)) throw notFound("tag", input.id);
        sql = `update ${tags} g set ${setClause(params, { name: input.name, color: input.color })}
               where g.id = ${params.add(input.id, "uuid")} and ${tenantMatch(params, "g.tenant_id", input.tenantId)}
               returning to_jsonb(g.*) as row`;
      } else {
        sql = `insert into ${tags} as g ${insertClause(params, {
          tenant_id: input.tenantId,
          name: input.name,
          color: input.color,
        })} returning to_jsonb(g.*) as row`;
      }
      const result = await db.attempt<{ row: TagRow }>(sql, params);
      if (result.failed) throw writeFailure(operation, result.error, TAG_CONSTRAINTS);
      const row = result.rows[0]?.row;
      if (!row) throw notFound("tag", input.id ?? "");
      return toTag(row);
    },

    delete: (id) => deleteById(db, "sendo_tags", "tag", id),

    async usage(id) {
      if (!isUuid(id)) return 0;
      const params = new Params();
      const [row] = await db.query<{ n: number }>(
        "tags.usage",
        `select count(*)::int as n from ${links} l where l.tag_id = ${params.add(id, "uuid")}`,
        params,
      );
      return row?.n ?? 0;
    },

    async addToConversation(conversationId, tagId, opts = {}) {
      const operation = "tags.addToConversation";
      const conversation = await selectById<ConversationRow>(
        db,
        operation,
        "sendo_conversations",
        conversationId,
      );
      if (!conversation) throw notFound("conversation", conversationId);
      const tag = await selectById<TagRow>(db, operation, "sendo_tags", tagId);
      if (!tag || tag.tenant_id !== conversation.tenant_id) throw notFound("tag", tagId);
      const params = new Params();
      const inserted = await db.execute(
        operation,
        `insert into ${links} ${insertClause(params, {
          conversation_id: conversationId,
          tag_id: tagId,
          tenant_id: conversation.tenant_id,
          added_by: opts.by ?? null,
        })} on conflict (conversation_id, tag_id) do nothing`,
        params,
      );
      return inserted > 0;
    },

    async removeFromConversation(conversationId, tagId) {
      if (!isUuid(conversationId) || !isUuid(tagId)) return false;
      const params = new Params();
      const deleted = await db.execute(
        "tags.removeFromConversation",
        `delete from ${links} l
         where l.conversation_id = ${params.add(conversationId, "uuid")} and l.tag_id = ${params.add(tagId, "uuid")}`,
        params,
      );
      return deleted > 0;
    },

    async forConversations(conversationIds) {
      const result: Record<string, Tag[]> = {};
      for (const id of conversationIds) result[id] = [];
      const ids = [...new Set(conversationIds)].filter(isUuid);
      if (ids.length === 0) return result;
      const params = new Params();
      const rows = await db.query<{ conversation_id: string; tag: TagRow }>(
        "tags.forConversations",
        `select l.conversation_id::text as conversation_id, to_jsonb(g.*) as tag
         from ${links} l join ${tags} g on g.id = l.tag_id
         where l.conversation_id = any(${params.add(ids, "uuid[]")})`,
        params,
      );
      for (const row of rows) result[row.conversation_id]?.push(toTag(row.tag));
      for (const list of Object.values(result)) list.sort(compareTags);
      return result;
    },
  };
}

export function prismaRules(
  db: Db,
  transaction: <R>(fn: (tx: Db) => Promise<R>) => Promise<R>,
): SendoAdapter["rules"] {
  const rules = db.t("sendo_rules");

  const findByKey = async (input: RuleUpsertInput): Promise<RuleRow | null> => {
    const params = new Params();
    return db.row<RuleRow>(
      "rules.upsert",
      `select to_jsonb(r.*) as row from ${rules} r
       where ${tenantMatch(params, "r.tenant_id", input.tenantId)} and r.key = ${params.add(input.key, "text")}`,
      params,
    );
  };

  const write = (input: RuleUpsertInput, existing: RuleRow | null) => {
    const at = new Date();
    const params = new Params();
    if (existing) {
      const values: Record<string, unknown> = {
        type: input.type,
        params: input.params,
        updated_by: input.updatedBy ?? null,
        updated_at: at,
        account_id: input.accountId,
        position: input.position,
        active: input.active,
        origin: input.origin,
        state: input.type !== existing.type ? {} : undefined,
      };
      return db.attempt<{ row: RuleRow }>(
        `update ${rules} r set ${setClause(params, values)}
         where r.id = ${params.add(existing.id, "uuid")} returning to_jsonb(r.*) as row`,
        params,
      );
    }
    // Position defaults to after the tenant's last rule, computed in the same statement.
    const position =
      input.position !== undefined
        ? params.add(input.position, "int")
        : `(select coalesce(max(p.position) + 1, 0) from ${rules} p
            where ${tenantMatch(params, "p.tenant_id", input.tenantId)})`;
    return db.attempt<{ row: RuleRow }>(
      `insert into ${rules} as r
         (tenant_id, account_id, key, type, params, position, active, origin, updated_by, updated_at)
       values (${params.add(input.tenantId, "uuid")}, ${params.add(input.accountId ?? null, "uuid")},
               ${params.add(input.key, "text")}, ${params.add(input.type, "text")},
               ${params.add(JSON.stringify(input.params), "jsonb")}, ${position},
               ${params.add(input.active ?? true, "boolean")}, ${params.add(input.origin ?? "screen", "text")},
               ${params.add(input.updatedBy ?? null, "text")}, ${params.add(at.toISOString(), "timestamptz")})
       returning to_jsonb(r.*) as row`,
      params,
    );
  };

  return {
    async list(query = {}) {
      const params = new Params();
      const where = ["true"];
      if (query.tenantId !== undefined)
        where.push(tenantMatch(params, "r.tenant_id", query.tenantId));
      if (query.accountId !== undefined) {
        where.push(
          isUuid(query.accountId)
            ? `(r.account_id is null or r.account_id = ${params.add(query.accountId, "uuid")})`
            : "r.account_id is null",
        );
      }
      if (query.active !== undefined)
        where.push(`r.active = ${params.add(query.active, "boolean")}`);
      const rows = await db.rows<RuleRow>(
        "rules.list",
        `select to_jsonb(r.*) as row from ${rules} r where ${where.join(" and ")}`,
        params,
      );
      return rows.map(toRule).sort(compareRules);
    },

    async get(id) {
      const row = await selectById<RuleRow>(db, "rules.get", "sendo_rules", id);
      return row ? toRule(row) : null;
    },

    async upsert(input, opts = {}): Promise<RuleUpsertResult> {
      const operation = "rules.upsert";
      // A concurrent insert of the same (tenant, key) loses on the unique constraint and
      // retries as an update (or returns the winner with `ifMissing`).
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await findByKey(input);
        if (existing && opts.ifMissing) return { rule: toRule(existing), created: false };
        const result = await write(input, existing);
        if (result.failed) {
          if (!existing && isUniqueViolation(result.error, "sendo_rules_tenant_key")) continue;
          throw writeFailure(operation, result.error, RULE_CONSTRAINTS);
        }
        const row = result.rows[0]?.row;
        if (!row) continue;
        return { rule: toRule(row), created: !existing };
      }
      throw new PrismaAdapterError(operation, { message: `could not upsert rule ${input.key}` });
    },

    async update(id, patch) {
      if (!isUuid(id)) throw notFound("rule", id);
      const params = new Params();
      const result = await db.attempt<{ row: RuleRow }>(
        `update ${rules} r set ${setClause(params, rulePatchToRow(patch, new Date()))}
         where r.id = ${params.add(id, "uuid")} returning to_jsonb(r.*) as row`,
        params,
      );
      if (result.failed) throw writeFailure("rules.update", result.error, RULE_CONSTRAINTS);
      const row = result.rows[0]?.row;
      if (!row) throw notFound("rule", id);
      return toRule(row);
    },

    delete: (id) => deleteById(db, "sendo_rules", "rule", id),

    async reorder(tenantId, ids) {
      const operation = "rules.reorder";
      if (ids.length === 0) return;
      const malformed = ids.find((id) => !isUuid(id));
      if (malformed !== undefined) throw notFound("rule", malformed);
      await transaction(async (tx) => {
        const check = new Params();
        const found = await tx.query<{ id: string }>(
          operation,
          `select r.id::text as id from ${rules} r
           where r.id = any(${check.add(ids, "uuid[]")}) and ${tenantMatch(check, "r.tenant_id", tenantId)}
           for update`,
          check,
        );
        const known = new Set(found.map((r) => r.id));
        const missing = ids.find((id) => !known.has(id.toLowerCase()));
        if (missing !== undefined) throw notFound("rule", missing);
        const params = new Params();
        await tx.execute(
          operation,
          `update ${rules} r set position = u.ord - 1
           from unnest(${params.add(ids, "uuid[]")}) with ordinality as u(id, ord)
           where r.id = u.id`,
          params,
        );
      });
    },

    async patchState(id, patch) {
      if (!isUuid(id)) throw notFound("rule", id);
      const params = new Params();
      const row = await db.row<RuleRow>(
        "rules.patchState",
        `update ${rules} r set state = r.state || ${params.add(JSON.stringify(patch), "jsonb")}
         where r.id = ${params.add(id, "uuid")} returning to_jsonb(r.*) as row`,
        params,
      );
      if (!row) throw notFound("rule", id);
      return toRule(row);
    },
  };
}
