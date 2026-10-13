import type { MediaStore } from "../../media/types";
import { METRICS_SQL, metricsSqlParams } from "../../metrics/sql";
import { type MetricsDbRow, metricsFromSql } from "../metrics";
import {
  type EventRow,
  type MediaRow,
  type TemplateRow,
  mediaPatchToRow,
  toEvent,
  toMedia,
  toTemplate,
} from "../supabase/rows";
import { SENDO_TABLES, type SendoAdapter } from "../types";
import { prismaAccounts, prismaContacts } from "./accounts";
import { prismaBroadcasts } from "./broadcasts";
import { prismaConversations } from "./conversations";
import {
  Db,
  PG_UNDEFINED_TABLE,
  Params,
  type PrismaClientLike,
  PrismaAdapterError,
  insertClause,
  insertRowsClause,
  isUuid,
  quoteIdent,
  setClause,
} from "./db";
import { prismaMessages } from "./messages";
import { notFound } from "./shared";
import { prismaRules, prismaSnippets, prismaTags } from "./team";

export interface PrismaAdapterOptions {
  /**
   * A `PrismaClient` from your app (Prisma 5+; with Prisma 7, built with a driver adapter such
   * as `@prisma/adapter-pg`). Only `$queryRawUnsafe`, `$executeRawUnsafe` and `$transaction` are
   * used, so your generated models and their names don't matter.
   */
  prisma: PrismaClientLike;
  /** The adapter's default `MediaStore` (`adapter.storage`); `createSendo({ media })` wins over it. */
  media?: MediaStore;
  /** Postgres schema that holds the `sendo_*` tables. Default `public`. */
  schema?: string;
  /** Interactive transaction limits in ms (Prisma's defaults are 2000 / 5000). Default 10000 / 15000. */
  transaction?: { maxWait?: number; timeout?: number };
}

function templateKey(name: string, language: string): string {
  return JSON.stringify([name, language]);
}

/**
 * `SendoAdapter` for Postgres through Prisma (optional peer `@prisma/client`). Requires the
 * `schema` SQL migrations (tables, constraints and indexes; the `prisma-schema`
 * registry item adds matching models to your `schema.prisma`). Every query is raw SQL with
 * bound parameters; the multi-step operations (status updates, `markSent`, default swap,
 * reorder, purge) run in interactive transactions.
 */
export function prismaAdapter(options: PrismaAdapterOptions): SendoAdapter {
  const schema = options.schema ?? "public";
  const prefix = `${quoteIdent(schema)}.`;
  const db = new Db(options.prisma, prefix);
  const txOptions = { maxWait: 10_000, timeout: 15_000, ...options.transaction };
  const transaction = async <R>(fn: (tx: Db) => Promise<R>): Promise<R> =>
    options.prisma.$transaction((tx) => fn(new Db(tx, prefix)), txOptions);

  const metricsSql = (name: keyof typeof METRICS_SQL): string =>
    METRICS_SQL[name].replaceAll("public.sendo_", `${prefix}sendo_`);

  return {
    accounts: prismaAccounts(db, transaction),
    contacts: prismaContacts(db),
    conversations: prismaConversations(db),
    messages: prismaMessages(db, transaction),

    media: {
      async insert(input) {
        const params = new Params();
        const row = await db.row<MediaRow>(
          "media.insert",
          `insert into ${db.t("sendo_media")} as md ${insertClause(params, {
            tenant_id: input.tenantId,
            message_id: input.messageId,
            meta_media_id: input.metaMediaId ?? null,
            mime_type: input.mimeType ?? null,
            size_bytes: input.sizeBytes ?? null,
            sha256: input.sha256 ?? null,
            storage_path: input.storagePath ?? null,
            download_status: input.downloadStatus ?? "pending",
          })} returning to_jsonb(md.*) as row`,
          params,
        );
        if (!row) throw new PrismaAdapterError("media.insert", { message: "no row returned" });
        return toMedia(row);
      },
      async update(id, patch) {
        if (!isUuid(id)) throw notFound("media", id);
        const params = new Params();
        const assignments = setClause(params, mediaPatchToRow(patch));
        const row = await db.row<MediaRow>(
          "media.update",
          assignments === ""
            ? `select to_jsonb(md.*) as row from ${db.t("sendo_media")} md where md.id = ${params.add(id, "uuid")}`
            : `update ${db.t("sendo_media")} md set ${assignments}
               where md.id = ${params.add(id, "uuid")} returning to_jsonb(md.*) as row`,
          params,
        );
        if (!row) throw notFound("media", id);
        return toMedia(row);
      },
    },

    templates: {
      async upsertMany(accountId, templates) {
        const operation = "templates.upsertMany";
        if (templates.length === 0) return [];
        if (!isUuid(accountId)) throw notFound("account", accountId);
        const lookup = new Params();
        const [account] = await db.query<{ tenant_id: string | null }>(
          operation,
          `select a.tenant_id::text as tenant_id from ${db.t("sendo_accounts")} a
           where a.id = ${lookup.add(accountId, "uuid")}`,
          lookup,
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
            synced_at: t.syncedAt ?? new Date(),
          });
        }
        const params = new Params();
        const rows = await db.rows<TemplateRow>(
          operation,
          `insert into ${db.t("sendo_templates")} as t ${insertRowsClause(params, [...byKey.values()])}
           on conflict (account_id, name, language) do update set
             tenant_id = excluded.tenant_id, category = excluded.category, status = excluded.status,
             components = excluded.components, variable_count = excluded.variable_count,
             active = excluded.active, synced_at = excluded.synced_at
           returning to_jsonb(t.*) as row`,
          params,
        );
        const saved = new Map(rows.map((r) => [templateKey(r.name, r.language), toTemplate(r)]));
        return templates.map((t) => {
          const template = saved.get(templateKey(t.name, t.language));
          if (!template) {
            throw new PrismaAdapterError(operation, {
              message: `template ${t.name} (${t.language}) was not returned`,
            });
          }
          return template;
        });
      },
      async markInactiveExcept(accountId, keep) {
        if (!isUuid(accountId)) return 0;
        const params = new Params();
        return db.execute(
          "templates.markInactiveExcept",
          `update ${db.t("sendo_templates")} t set active = false
           where t.account_id = ${params.add(accountId, "uuid")} and t.active
             and (t.name, t.language) not in (
               select k.name, k.language
               from unnest(${params.add(
                 keep.map((k) => k.name),
                 "text[]",
               )},
                           ${params.add(
                             keep.map((k) => k.language),
                             "text[]",
                           )}) as k(name, language))`,
          params,
        );
      },
      async list(query = {}) {
        const params = new Params();
        const where = ["true"];
        if (query.accountId !== undefined) {
          where.push(
            isUuid(query.accountId)
              ? `t.account_id = ${params.add(query.accountId, "uuid")}`
              : "false",
          );
        }
        if (query.status !== undefined)
          where.push(`t.status = ${params.add(query.status, "text")}`);
        if (query.active !== undefined)
          where.push(`t.active = ${params.add(query.active, "boolean")}`);
        const rows = await db.rows<TemplateRow>(
          "templates.list",
          `select to_jsonb(t.*) as row from ${db.t("sendo_templates")} t where ${where.join(" and ")}
           order by t.name asc, t.language asc`,
          params,
        );
        return rows.map(toTemplate);
      },
      async get(accountId, name, language) {
        if (!isUuid(accountId)) return null;
        const params = new Params();
        const row = await db.row<TemplateRow>(
          "templates.get",
          `select to_jsonb(t.*) as row from ${db.t("sendo_templates")} t
           where t.account_id = ${params.add(accountId, "uuid")} and t.name = ${params.add(name, "text")}
             and t.language = ${params.add(language, "text")}`,
          params,
        );
        return row ? toTemplate(row) : null;
      },
    },

    snippets: prismaSnippets(db),
    tags: prismaTags(db),
    rules: prismaRules(db, transaction),
    broadcasts: prismaBroadcasts(db),

    // `METRICS_SQL` over the base tables; rows read as JSON (dates as `YYYY-MM-DD`).
    metrics: metricsFromSql(async (name, query) => {
      const params = new Params();
      for (const value of metricsSqlParams(query)) {
        params.add(value instanceof Date ? value.toISOString() : value);
      }
      return db.rows<MetricsDbRow>(
        `metrics.${name}`,
        `select to_jsonb(v.*) as row from (${metricsSql(name)}) v`,
        params,
      );
    }),

    events: {
      async insert(input) {
        const params = new Params();
        const row = await db.row<EventRow>(
          "events.insert",
          `insert into ${db.t("sendo_events")} as e (payload)
           values (${params.add(JSON.stringify(input.payload ?? null), "jsonb")})
           returning to_jsonb(e.*) as row`,
          params,
        );
        if (!row) throw new PrismaAdapterError("events.insert", { message: "no row returned" });
        return toEvent(row);
      },
      async setStatus(id, status, error) {
        if (!isUuid(id)) throw notFound("event", id);
        const params = new Params();
        const processed = status === "received" ? "" : ", processed_at = now()";
        const row = await db.row<EventRow>(
          "events.setStatus",
          `update ${db.t("sendo_events")} e
           set status = ${params.add(status)}, error = ${params.add(error ?? null, "text")}${processed}
           where e.id = ${params.add(id, "uuid")} returning to_jsonb(e.*) as row`,
          params,
        );
        if (!row) throw notFound("event", id);
        return toEvent(row);
      },
      async get(id) {
        if (!isUuid(id)) return null;
        const params = new Params();
        const row = await db.row<EventRow>(
          "events.get",
          `select to_jsonb(e.*) as row from ${db.t("sendo_events")} e where e.id = ${params.add(id, "uuid")}`,
          params,
        );
        return row ? toEvent(row) : null;
      },
      async prune(olderThan) {
        const params = new Params();
        return db.execute(
          "events.prune",
          `delete from ${db.t("sendo_events")} e
           where e.received_at < ${params.add(olderThan.toISOString(), "timestamptz")}`,
          params,
        );
      },
    },

    locks: {
      // Port of `sendo_acquire_lock`: one upsert that only replaces an expired lock.
      async acquire(key, ttlMs) {
        const params = new Params();
        const rows = await db.query<{ acquired: boolean }>(
          "locks.acquire",
          `insert into ${db.t("sendo_locks")} as l (key, expires_at)
           values (${params.add(key, "text")},
                   clock_timestamp() + ${params.add(Math.max(1, Math.ceil(ttlMs)), "int")} * interval '1 millisecond')
           on conflict (key) do update set expires_at = excluded.expires_at
             where l.expires_at <= clock_timestamp()
           returning true as acquired`,
          params,
        );
        return rows.length > 0;
      },
      async release(key) {
        const params = new Params();
        await db.execute(
          "locks.release",
          `delete from ${db.t("sendo_locks")} l where l.key = ${params.add(key, "text")}`,
          params,
        );
      },
    },

    storage: options.media,

    async schemaVersion() {
      try {
        const [row] = await db.query<{ version: number | null }>(
          "schemaVersion",
          `select max(m.version)::int as version from ${db.t("sendo_schema_meta")} m`,
          [],
        );
        return row?.version ?? null;
      } catch (error) {
        if (error instanceof PrismaAdapterError && error.code === PG_UNDEFINED_TABLE) return null;
        throw error;
      }
    },

    async healthCheck() {
      const params = new Params();
      const rows = await db.query<{ name: string }>(
        "healthCheck",
        `select c.relname::text as name from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = ${params.add(schema, "text")} and c.relname = any(${params.add([...SENDO_TABLES], "text[]")})`,
        params,
      );
      const present = new Set(rows.map((r) => r.name));
      const missing = SENDO_TABLES.filter((table) => !present.has(table));
      return { tablesOk: missing.length === 0, missing };
    },
  };
}
