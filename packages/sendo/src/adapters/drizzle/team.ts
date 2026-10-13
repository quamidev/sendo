import { type SQL, sql } from "drizzle-orm";
import { RecordNotFoundError } from "../../errors";
import type { RecordEntity } from "../../errors/errors";
import type { Tag, TenantId } from "../../types/entities";
import { compareRules, compareSnippets, compareTags } from "../shared";
import type { RuleUpsertInput, SendoAdapter } from "../types";
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
import {
  type DrizzleDatabase,
  DrizzleAdapterError,
  assignments,
  execute,
  insertReturning,
  isUniqueViolation,
  isUuid,
  jsonRow,
  jsonRows,
  jsonb,
  scalar,
  tenantEq,
  transaction,
  uuidArray,
  uuidEq,
} from "./db";

const SNIPPET_CONSTRAINTS = [
  "sendo_snippets_shortcut_key",
  "sendo_snippets_shortcut_check",
  "sendo_snippets_visibility_check",
  "sendo_snippets_owner_check",
] as const;
const TAG_CONSTRAINTS = [
  "sendo_tags_name_key",
  "sendo_tags_name_check",
  "sendo_tags_color_check",
] as const;
const RULE_CONSTRAINTS = ["sendo_rules_type_check", "sendo_rules_origin_check"] as const;

type TeamTable = "sendo_snippets" | "sendo_tags" | "sendo_rules";

function getById<R>(db: DrizzleDatabase, operation: string, table: TeamTable, id: string) {
  if (!isUuid(id)) return Promise.resolve(null);
  return jsonRow<R>(
    db,
    operation,
    sql`select to_jsonb(t) as r from ${sql.identifier(table)} t where t.id = ${id}::uuid`,
  );
}

/** Deletes one row by id; unknown or malformed id → `RecordNotFoundError`. */
async function deleteById(
  db: DrizzleDatabase,
  table: TeamTable,
  entity: RecordEntity,
  id: string,
): Promise<void> {
  const rows = isUuid(id)
    ? await execute(
        db,
        `${entity}s.delete`,
        sql`delete from ${sql.identifier(table)} t where t.id = ${id}::uuid returning t.id`,
      )
    : [];
  if (rows.length === 0) throw new RecordNotFoundError({ entity, id });
}

/** `update table as t set ... where id and tenant returning to_jsonb(t) as r`. */
function updateInTenant(table: TeamTable, id: string, tenantId: TenantId, sets: SQL): SQL {
  return sql`update ${sql.identifier(table)} as t set ${sets}
             where t.id = ${id}::uuid and ${tenantEq(sql`t.tenant_id`, tenantId)}
             returning to_jsonb(t) as r`;
}

export function drizzleSnippets(db: DrizzleDatabase): SendoAdapter["snippets"] {
  return {
    async list(query) {
      const visibility =
        query.userId === undefined
          ? sql`t.visibility = 'tenant'`
          : sql`(t.visibility = 'tenant' or (t.visibility = 'personal' and t.owner_user_id = ${query.userId}))`;
      const account =
        query.accountId === undefined
          ? sql`true`
          : sql`(t.account_id is null or ${uuidEq(sql`t.account_id`, query.accountId)})`;
      const rows = await jsonRows<SnippetRow>(
        db,
        "snippets.list",
        sql`select to_jsonb(t) as r from sendo_snippets t
            where ${tenantEq(sql`t.tenant_id`, query.tenantId)} and ${visibility} and ${account}`,
      );
      return rows.map(toSnippet).sort(compareSnippets);
    },

    async get(id) {
      const row = await getById<SnippetRow>(db, "snippets.get", "sendo_snippets", id);
      return row ? toSnippet(row) : null;
    },

    async upsert(input) {
      const operation = "snippets.upsert";
      const at = new Date();
      if (input.id !== undefined) {
        const id = input.id;
        const values: Record<string, unknown> = {
          shortcut: input.shortcut,
          body: input.body,
          updated_by: input.by ?? null,
          updated_at: at,
          account_id: input.accountId,
          visibility: input.visibility,
          owner_user_id: input.ownerUserId,
        };
        const row = isUuid(id)
          ? await jsonRow<SnippetRow>(
              db,
              operation,
              updateInTenant("sendo_snippets", id, input.tenantId, assignments(values)),
              SNIPPET_CONSTRAINTS,
            )
          : null;
        if (!row) throw new RecordNotFoundError({ entity: "snippet", id });
        return toSnippet(row);
      }
      const row = await jsonRow<SnippetRow>(
        db,
        operation,
        insertReturning("sendo_snippets", {
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
        }),
        SNIPPET_CONSTRAINTS,
      );
      if (!row) throw new DrizzleAdapterError(operation, null, "no row returned");
      return toSnippet(row);
    },

    delete: (id) => deleteById(db, "sendo_snippets", "snippet", id),
  };
}

export function drizzleTags(db: DrizzleDatabase): SendoAdapter["tags"] {
  const notFound = (entity: RecordEntity, id: string) => new RecordNotFoundError({ entity, id });

  return {
    async list(query) {
      const rows = await jsonRows<TagRow>(
        db,
        "tags.list",
        sql`select to_jsonb(t) as r from sendo_tags t where ${tenantEq(sql`t.tenant_id`, query.tenantId)}`,
      );
      return rows.map(toTag).sort(compareTags);
    },

    async get(id) {
      const row = await getById<TagRow>(db, "tags.get", "sendo_tags", id);
      return row ? toTag(row) : null;
    },

    async upsert(input) {
      const operation = "tags.upsert";
      const values = { name: input.name, color: input.color };
      if (input.id !== undefined) {
        const id = input.id;
        const row = isUuid(id)
          ? await jsonRow<TagRow>(
              db,
              operation,
              updateInTenant("sendo_tags", id, input.tenantId, assignments(values)),
              TAG_CONSTRAINTS,
            )
          : null;
        if (!row) throw notFound("tag", id);
        return toTag(row);
      }
      const row = await jsonRow<TagRow>(
        db,
        operation,
        insertReturning("sendo_tags", { tenant_id: input.tenantId, ...values }),
        TAG_CONSTRAINTS,
      );
      if (!row) throw new DrizzleAdapterError(operation, null, "no row returned");
      return toTag(row);
    },

    delete: (id) => deleteById(db, "sendo_tags", "tag", id),

    usage: (id) =>
      isUuid(id)
        ? scalar(
            db,
            "tags.usage",
            sql`select count(*) from sendo_conversation_tags ct where ct.tag_id = ${id}::uuid`,
          )
        : Promise.resolve(0),

    async addToConversation(conversationId, tagId, opts = {}) {
      const operation = "tags.addToConversation";
      const conversation = isUuid(conversationId)
        ? await jsonRow<Pick<ConversationRow, "tenant_id">>(
            db,
            operation,
            sql`select jsonb_build_object('tenant_id', c.tenant_id) as r
                from sendo_conversations c where c.id = ${conversationId}::uuid`,
          )
        : null;
      if (!conversation) throw notFound("conversation", conversationId);
      const tag = await getById<TagRow>(db, operation, "sendo_tags", tagId);
      if (!tag || tag.tenant_id !== conversation.tenant_id) throw notFound("tag", tagId);
      const rows = await execute(
        db,
        operation,
        sql`insert into sendo_conversation_tags (conversation_id, tag_id, tenant_id, added_by)
            values (${conversationId}::uuid, ${tagId}::uuid, ${conversation.tenant_id}::uuid,
                    ${opts.by ?? null})
            on conflict (conversation_id, tag_id) do nothing
            returning tag_id`,
      );
      return rows.length > 0;
    },

    async removeFromConversation(conversationId, tagId) {
      if (!isUuid(conversationId) || !isUuid(tagId)) return false;
      const rows = await execute(
        db,
        "tags.removeFromConversation",
        sql`delete from sendo_conversation_tags ct
            where ct.conversation_id = ${conversationId}::uuid and ct.tag_id = ${tagId}::uuid
            returning ct.tag_id`,
      );
      return rows.length > 0;
    },

    async forConversations(conversationIds) {
      const result: Record<string, Tag[]> = {};
      for (const id of conversationIds) result[id] = [];
      if (conversationIds.length === 0) return result;
      const rows = await execute(
        db,
        "tags.forConversations",
        sql`select ct.conversation_id, to_jsonb(t) as r
            from sendo_conversation_tags ct join sendo_tags t on t.id = ct.tag_id
            where ct.conversation_id = any(${uuidArray(conversationIds)})`,
      );
      for (const row of rows) result[String(row.conversation_id)]?.push(toTag(row.r as TagRow));
      for (const tags of Object.values(result)) tags.sort(compareTags);
      return result;
    },
  };
}

export function drizzleRules(db: DrizzleDatabase): SendoAdapter["rules"] {
  const notFound = (id: string) => new RecordNotFoundError({ entity: "rule", id });

  const findRule = (tenantId: TenantId, key: string) =>
    jsonRow<RuleRow>(
      db,
      "rules.upsert",
      sql`select to_jsonb(t) as r from sendo_rules t
          where ${tenantEq(sql`t.tenant_id`, tenantId)} and t.key = ${key}`,
    );

  const writeRule = (input: RuleUpsertInput, existing: RuleRow | null) => {
    const at = new Date();
    if (existing) {
      const values: Record<string, unknown> = {
        type: input.type,
        params: jsonb(input.params),
        updated_by: input.updatedBy ?? null,
        updated_at: at,
        account_id: input.accountId,
        position: input.position,
        active: input.active,
        origin: input.origin,
        state: input.type !== existing.type ? jsonb({}) : undefined,
      };
      return jsonRow<RuleRow>(
        db,
        "rules.upsert",
        sql`update sendo_rules as t set ${assignments(values)}
            where t.id = ${existing.id}::uuid returning to_jsonb(t) as r`,
        RULE_CONSTRAINTS,
      );
    }
    // `position` defaults to after the tenant's last rule, computed in the same statement.
    const position =
      input.position === undefined
        ? sql`(select coalesce(max(p.position) + 1, 0) from sendo_rules p where ${tenantEq(sql`p.tenant_id`, input.tenantId)})`
        : sql`${input.position}::int`;
    return jsonRow<RuleRow>(
      db,
      "rules.upsert",
      insertReturning("sendo_rules", {
        tenant_id: input.tenantId,
        account_id: input.accountId ?? null,
        key: input.key,
        type: input.type,
        params: jsonb(input.params),
        position,
        active: input.active ?? true,
        origin: input.origin ?? "screen",
        updated_by: input.updatedBy ?? null,
        updated_at: at,
      }),
      RULE_CONSTRAINTS,
    );
  };

  return {
    async list(query = {}) {
      const parts: SQL[] = [sql`true`];
      if (query.tenantId !== undefined) parts.push(tenantEq(sql`t.tenant_id`, query.tenantId));
      if (query.accountId !== undefined) {
        parts.push(sql`(t.account_id is null or ${uuidEq(sql`t.account_id`, query.accountId)})`);
      }
      if (query.active !== undefined) parts.push(sql`t.active = ${query.active}`);
      const rows = await jsonRows<RuleRow>(
        db,
        "rules.list",
        sql`select to_jsonb(t) as r from sendo_rules t where ${sql.join(parts, sql` and `)}`,
      );
      return rows.map(toRule).sort(compareRules);
    },

    async get(id) {
      const row = await getById<RuleRow>(db, "rules.get", "sendo_rules", id);
      return row ? toRule(row) : null;
    },

    async upsert(input, opts = {}) {
      // A concurrent insert of the same (tenant, key) loses on the unique constraint and
      // retries as an update (or returns the winner with `ifMissing`).
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await findRule(input.tenantId, input.key);
        if (existing && opts.ifMissing) return { rule: toRule(existing), created: false };
        try {
          const row = await writeRule(input, existing);
          if (row) return { rule: toRule(row), created: !existing };
        } catch (error) {
          if (!existing && isUniqueViolation(error, "sendo_rules_tenant_key")) continue;
          throw error;
        }
      }
      throw new DrizzleAdapterError("rules.upsert", null, `could not upsert rule ${input.key}`);
    },

    async update(id, patch) {
      if (!isUuid(id)) throw notFound(id);
      const { params, ...values } = rulePatchToRow(patch, new Date());
      const row = await jsonRow<RuleRow>(
        db,
        "rules.update",
        sql`update sendo_rules as t
            set ${assignments({ ...values, params: params === undefined ? undefined : jsonb(params) })}
            where t.id = ${id}::uuid returning to_jsonb(t) as r`,
        RULE_CONSTRAINTS,
      );
      if (!row) throw notFound(id);
      return toRule(row);
    },

    delete: (id) => deleteById(db, "sendo_rules", "rule", id),

    async reorder(tenantId, ids) {
      const operation = "rules.reorder";
      if (ids.length === 0) return;
      const malformed = ids.find((id) => !isUuid(id));
      if (malformed !== undefined) throw notFound(malformed);
      await transaction(db, operation, async (tx) => {
        const found = await execute(
          tx,
          operation,
          sql`select t.id from sendo_rules t
              where t.id = any(${uuidArray(ids)}) and ${tenantEq(sql`t.tenant_id`, tenantId)}
              for update`,
        );
        const known = new Set(found.map((r) => String(r.id)));
        const missing = ids.find((id) => !known.has(id));
        if (missing !== undefined) throw notFound(missing);
        await execute(
          tx,
          operation,
          sql`update sendo_rules as t set position = k.ord - 1
              from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) with ordinality as k(id, ord)
              where t.id = k.id::uuid`,
        );
      });
    },

    async patchState(id, patch) {
      if (!isUuid(id)) throw notFound(id);
      const row = await jsonRow<RuleRow>(
        db,
        "rules.patchState",
        sql`update sendo_rules as t set state = t.state || ${jsonb(patch)}
            where t.id = ${id}::uuid returning to_jsonb(t) as r`,
      );
      if (!row) throw notFound(id);
      return toRule(row);
    },
  };
}
