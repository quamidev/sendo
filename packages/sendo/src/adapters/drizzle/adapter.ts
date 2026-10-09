import { sql } from "drizzle-orm";
import {
  AccountStateError,
  ConstraintViolationError,
  DuplicateAccountError,
  RecordNotFoundError,
} from "../../errors";
import type { MediaStore } from "../../media/types";
import type { SendoAdapter, ContactUpsertInput, ContactUpsertResult } from "../types";
import { SENDO_TABLES } from "../types";
import {
  type AccountRow,
  type ContactRow,
  type EventRow,
  type MediaRow,
  type TemplateRow,
  accountPatchToRow,
  mediaPatchToRow,
  reactivationToRow,
  toAccount,
  toContact,
  toEvent,
  toMedia,
  toTemplate,
} from "../supabase/rows";
import { drizzleBroadcasts } from "./broadcasts";
import { drizzleConversations } from "./conversations";
import {
  type DrizzleDatabase,
  DrizzleAdapterError,
  PG_UNDEFINED_TABLE,
  assignments,
  execute,
  insertReturning,
  isUniqueViolation,
  isUuid,
  jsonRow,
  jsonRows,
  jsonb,
  pgErrorOf,
  scalar,
  tenantEq,
  textArray,
  transaction,
} from "./db";
import { drizzleMessages } from "./messages";
import { drizzleMetrics } from "./metrics";
import { drizzleRules, drizzleSnippets, drizzleTags } from "./team";

export interface DrizzleAdapterOptions {
  /**
   * A `drizzle-orm/node-postgres` or `drizzle-orm/postgres-js` database connected to Postgres
   * with the `sendo-schema` migrations applied (tables in the connection's `search_path`,
   * `public` by default). Connect as a role that can write the `sendo_*` tables.
   */
  db: DrizzleDatabase;
  /** The adapter's default `MediaStore` (`adapter.storage`); `createSendo({ media })` wins over it. */
  media?: MediaStore;
}

const ACCOUNT_CONSTRAINTS = [
  "sendo_accounts_default_per_tenant",
  "sendo_accounts_whatsapp_ids",
  "sendo_accounts_channel_check",
  "sendo_accounts_onboarded_via_check",
  "sendo_accounts_agent_mode_check",
] as const;
const CONTACT_CONSTRAINTS = [
  "sendo_contacts_identity",
  "sendo_contacts_account_id_channel_user_id_key",
] as const;

function templateKey(name: string, language: string): string {
  return JSON.stringify([name, language]);
}

/**
 * `SendoAdapter` for any Postgres through Drizzle (optional peer `drizzle-orm`). Plain SQL over
 * the `sendo_*` tables (no RLS: access control is the package's role checks); the RPC
 * equivalents are single statements or transactions with the same advisory locks as the
 * Supabase functions. Media needs a `MediaStore` (`media` here or `createSendo({ media })`).
 */
export function drizzleAdapter(options: DrizzleAdapterOptions): SendoAdapter {
  const { db } = options;
  const notFound = (entity: "account" | "contact" | "media" | "event", id: string) =>
    new RecordNotFoundError({ entity, id });

  const accountById = (operation: string, id: string) =>
    isUuid(id)
      ? jsonRow<AccountRow>(
          db,
          operation,
          sql`select to_jsonb(t) as r from sendo_accounts t where t.id = ${id}::uuid`,
        )
      : Promise.resolve(null);

  const contactById = (operation: string, id: string) =>
    isUuid(id)
      ? jsonRow<ContactRow>(
          db,
          operation,
          sql`select to_jsonb(t) as r from sendo_contacts t where t.id = ${id}::uuid`,
        )
      : Promise.resolve(null);

  /** Keyed on the phone when given, else on the channel user id (the identity rule). */
  const findContact = (input: ContactUpsertInput) =>
    isUuid(input.accountId)
      ? jsonRow<ContactRow>(
          db,
          "contacts.upsert",
          sql`select to_jsonb(t) as r from sendo_contacts t
              where t.account_id = ${input.accountId}::uuid and ${
                input.phone != null
                  ? sql`t.phone = ${input.phone}`
                  : sql`t.channel_user_id = ${input.channelUserId ?? ""}`
              }`,
        )
      : Promise.resolve(null);

  const updateExistingContact = async (
    existing: ContactRow,
    input: ContactUpsertInput,
  ): Promise<ContactUpsertResult> => {
    const profileChanged = input.profileName != null && input.profileName !== existing.profile_name;
    const patch: Record<string, unknown> = {};
    if (input.waId != null && input.waId !== existing.wa_id) patch.wa_id = input.waId;
    if (input.channelUserId != null && input.channelUserId !== existing.channel_user_id) {
      patch.channel_user_id = input.channelUserId;
    }
    if (profileChanged) patch.profile_name = input.profileName ?? null;
    if (Object.keys(patch).length === 0) {
      return { contact: toContact(existing), created: false, profileChanged: false };
    }
    const row = await jsonRow<ContactRow>(
      db,
      "contacts.upsert",
      sql`update sendo_contacts as t set ${assignments(patch)}
          where t.id = ${existing.id}::uuid returning to_jsonb(t) as r`,
      CONTACT_CONSTRAINTS,
    );
    if (!row) throw notFound("contact", existing.id);
    return { contact: toContact(row), created: false, profileChanged };
  };

  return {
    accounts: {
      async getByPhoneNumberId(phoneNumberId) {
        const row = await jsonRow<AccountRow>(
          db,
          "accounts.getByPhoneNumberId",
          sql`select to_jsonb(t) as r from sendo_accounts t where t.phone_number_id = ${phoneNumberId}`,
        );
        return row ? toAccount(row) : null;
      },

      async getById(id) {
        const row = await accountById("accounts.getById", id);
        return row ? toAccount(row) : null;
      },

      async list(filter = {}) {
        const tenant =
          filter.tenantId === undefined ? sql`true` : tenantEq(sql`t.tenant_id`, filter.tenantId);
        const active = filter.active === undefined ? sql`true` : sql`t.active = ${filter.active}`;
        const rows = await jsonRows<AccountRow>(
          db,
          "accounts.list",
          sql`select to_jsonb(t) as r from sendo_accounts t where ${tenant} and ${active}
              order by t.created_at asc, t.id asc`,
        );
        return rows.map(toAccount);
      },

      async insert(input) {
        try {
          const row = await jsonRow<AccountRow>(
            db,
            "accounts.insert",
            insertReturning("sendo_accounts", {
              tenant_id: input.tenantId ?? null,
              channel: input.channel ?? "whatsapp",
              label: input.label ?? null,
              phone_number_id: input.phoneNumberId ?? null,
              waba_id: input.wabaId ?? null,
              display_phone: input.displayPhone,
              token_ref: input.tokenRef,
              timezone: input.timezone,
              active: input.active,
              is_default: input.isDefault ?? false,
              coexistence: input.coexistence ?? false,
              onboarded_via: input.onboardedVia ?? "manual",
              agent_paused: input.agentPaused ?? false,
              agent_mode: input.agentMode ?? null,
              billing_ready: input.billingReady ?? null,
              billing_checked_at: input.billingCheckedAt ?? null,
            }),
            ACCOUNT_CONSTRAINTS,
          );
          if (!row) throw new DrizzleAdapterError("accounts.insert", null, "no row returned");
          return toAccount(row);
        } catch (error) {
          if (
            input.phoneNumberId != null &&
            isUniqueViolation(error, "sendo_accounts_phone_number_id_key")
          ) {
            throw new DuplicateAccountError(
              { phoneNumberId: input.phoneNumberId },
              { cause: error },
            );
          }
          throw error;
        }
      },

      async setDefault(id) {
        const operation = "accounts.setDefault";
        if (!isUuid(id)) throw notFound("account", id);
        // Same steps and advisory lock as `sendo_set_default_account` (serialized per tenant).
        const row = await transaction(
          db,
          operation,
          async (tx) => {
            const target = await jsonRow<AccountRow>(
              tx,
              operation,
              sql`select to_jsonb(t) as r from sendo_accounts t where t.id = ${id}::uuid`,
            );
            if (!target) return null;
            await execute(
              tx,
              operation,
              sql`select pg_advisory_xact_lock(hashtextextended(${`sendo_default_account:${target.tenant_id ?? ""}`}::text, 0))`,
            );
            await execute(
              tx,
              operation,
              sql`update sendo_accounts as t set is_default = false
                  where t.is_default and t.id <> ${id}::uuid
                    and ${tenantEq(sql`t.tenant_id`, target.tenant_id)}`,
            );
            return jsonRow<AccountRow>(
              tx,
              operation,
              sql`update sendo_accounts as t set is_default = true
                  where t.id = ${id}::uuid returning to_jsonb(t) as r`,
            );
          },
          ACCOUNT_CONSTRAINTS,
        );
        if (!row) throw notFound("account", id);
        return toAccount(row);
      },

      async update(id, patch) {
        const values = accountPatchToRow(patch);
        const row =
          Object.keys(values).length === 0
            ? await accountById("accounts.update", id)
            : isUuid(id)
              ? await jsonRow<AccountRow>(
                  db,
                  "accounts.update",
                  sql`update sendo_accounts as t set ${assignments(values)}
                      where t.id = ${id}::uuid returning to_jsonb(t) as r`,
                  ACCOUNT_CONSTRAINTS,
                )
              : null;
        if (!row) throw notFound("account", id);
        return toAccount(row);
      },

      async reactivate(phoneNumberId, input) {
        const operation = "accounts.reactivate";
        const row = await jsonRow<AccountRow>(
          db,
          operation,
          sql`update sendo_accounts as t set ${assignments(reactivationToRow(input))}
              where t.phone_number_id = ${phoneNumberId} and not t.active
                and ${tenantEq(sql`t.tenant_id`, input.tenantId ?? null)}
              returning to_jsonb(t) as r`,
          ACCOUNT_CONSTRAINTS,
        );
        if (row) return toAccount(row);
        const exists = await scalar(
          db,
          operation,
          sql`select count(*) from sendo_accounts t where t.phone_number_id = ${phoneNumberId}`,
        );
        if (exists === 0) throw notFound("account", phoneNumberId);
        throw new DuplicateAccountError({ phoneNumberId });
      },

      async purge(id) {
        const operation = "accounts.purge";
        if (!isUuid(id)) throw notFound("account", id);
        return transaction(db, operation, async (tx) => {
          // The row lock makes a concurrent reconnect wait (and then fail: the row is gone) or
          // win (the purge then sees an active account).
          const account = await jsonRow<AccountRow>(
            tx,
            operation,
            sql`select to_jsonb(t) as r from sendo_accounts t where t.id = ${id}::uuid for update`,
          );
          if (!account) throw notFound("account", id);
          if (account.active) throw new AccountStateError({ accountId: id, state: "active" });
          const paths = await execute(
            tx,
            operation,
            sql`select md.storage_path from sendo_media md
                join sendo_messages m on m.id = md.message_id
                join sendo_conversations c on c.id = m.conversation_id
                where c.account_id = ${id}::uuid and md.storage_path is not null
                order by md.id`,
          );
          // The FK cascades remove contacts, conversations, messages, media, templates,
          // account-scoped snippets and rules, and broadcasts.
          await execute(tx, operation, sql`delete from sendo_accounts t where t.id = ${id}::uuid`);
          return { storagePaths: paths.map((p) => String(p.storage_path)) };
        });
      },
    },

    contacts: {
      async upsert(input) {
        if (input.phone == null && input.channelUserId == null) {
          throw new ConstraintViolationError({ constraint: "sendo_contacts_identity" });
        }
        const existing = await findContact(input);
        if (existing) return updateExistingContact(existing, input);
        try {
          const row = await jsonRow<ContactRow>(
            db,
            "contacts.upsert",
            insertReturning("sendo_contacts", {
              tenant_id: input.tenantId,
              account_id: input.accountId,
              channel: input.channel ?? "whatsapp",
              phone: input.phone ?? null,
              channel_user_id: input.channelUserId ?? null,
              wa_id: input.waId ?? null,
              profile_name: input.profileName ?? null,
            }),
            CONTACT_CONSTRAINTS,
          );
          if (!row) throw new DrizzleAdapterError("contacts.upsert", null, "no row returned");
          return { contact: toContact(row), created: true, profileChanged: false };
        } catch (error) {
          // A concurrent upsert created the same identity first: update that row instead.
          const identityKey =
            input.phone != null
              ? "sendo_contacts_account_id_phone_key"
              : "sendo_contacts_account_id_channel_user_id_key";
          if (isUniqueViolation(error, identityKey)) {
            const raced = await findContact(input);
            if (raced) return updateExistingContact(raced, input);
          }
          throw error;
        }
      },

      async get(id) {
        const row = await contactById("contacts.get", id);
        return row ? toContact(row) : null;
      },

      async getByPhone(accountId, phone) {
        if (!isUuid(accountId)) return null;
        const row = await jsonRow<ContactRow>(
          db,
          "contacts.getByPhone",
          sql`select to_jsonb(t) as r from sendo_contacts t
              where t.account_id = ${accountId}::uuid and t.phone = ${phone}`,
        );
        return row ? toContact(row) : null;
      },

      async setAppRef(id, appRef) {
        const row = isUuid(id)
          ? await jsonRow<ContactRow>(
              db,
              "contacts.setAppRef",
              sql`update sendo_contacts as t set app_ref = ${appRef}
                  where t.id = ${id}::uuid returning to_jsonb(t) as r`,
            )
          : null;
        if (!row) throw notFound("contact", id);
        return toContact(row);
      },

      async setOptIn(id, input) {
        const row = isUuid(id)
          ? await jsonRow<ContactRow>(
              db,
              "contacts.setOptIn",
              sql`update sendo_contacts as t
                  set marketing_opt_in = ${input.marketingOptIn},
                      opt_in_at = ${input.optInAt?.toISOString() ?? null}::timestamptz
                  where t.id = ${id}::uuid returning to_jsonb(t) as r`,
            )
          : null;
        if (!row) throw notFound("contact", id);
        return toContact(row);
      },
    },

    conversations: drizzleConversations(db),

    messages: drizzleMessages(db),

    media: {
      async insert(input) {
        const row = await jsonRow<MediaRow>(
          db,
          "media.insert",
          insertReturning("sendo_media", {
            tenant_id: input.tenantId,
            message_id: input.messageId,
            meta_media_id: input.metaMediaId ?? null,
            mime_type: input.mimeType ?? null,
            size_bytes: input.sizeBytes ?? null,
            sha256: input.sha256 ?? null,
            storage_path: input.storagePath ?? null,
            download_status: input.downloadStatus ?? "pending",
          }),
        );
        if (!row) throw new DrizzleAdapterError("media.insert", null, "no row returned");
        return toMedia(row);
      },

      async update(id, patch) {
        const values = mediaPatchToRow(patch);
        const row = !isUuid(id)
          ? null
          : await jsonRow<MediaRow>(
              db,
              "media.update",
              Object.keys(values).length > 0
                ? sql`update sendo_media as t set ${assignments(values)}
                      where t.id = ${id}::uuid returning to_jsonb(t) as r`
                : sql`select to_jsonb(t) as r from sendo_media t where t.id = ${id}::uuid`,
            );
        if (!row) throw notFound("media", id);
        return toMedia(row);
      },
    },

    templates: {
      async upsertMany(accountId, templates) {
        const operation = "templates.upsertMany";
        if (templates.length === 0) return [];
        const account = await accountById(operation, accountId);
        if (!account) throw notFound("account", accountId);
        const byKey = new Map<string, (typeof templates)[number]>();
        for (const t of templates) byKey.set(templateKey(t.name, t.language), t);
        const values = [...byKey.values()].map(
          (t) =>
            sql`(${account.tenant_id}::uuid, ${accountId}::uuid, ${t.name}, ${t.language},
                 ${t.category}, ${t.status}, ${jsonb(t.components)}, ${t.variableCount}::int, true,
                 ${(t.syncedAt ?? new Date()).toISOString()}::timestamptz)`,
        );
        const rows = await jsonRows<TemplateRow>(
          db,
          operation,
          sql`insert into sendo_templates as t
                (tenant_id, account_id, name, language, category, status, components,
                 variable_count, active, synced_at)
              values ${sql.join(values, sql`, `)}
              on conflict (account_id, name, language) do update set
                tenant_id = excluded.tenant_id, category = excluded.category,
                status = excluded.status, components = excluded.components,
                variable_count = excluded.variable_count, active = true,
                synced_at = excluded.synced_at
              returning to_jsonb(t) as r`,
        );
        const saved = new Map(rows.map((r) => [templateKey(r.name, r.language), toTemplate(r)]));
        return templates.map((t) => {
          const template = saved.get(templateKey(t.name, t.language));
          if (!template) {
            throw new DrizzleAdapterError(
              operation,
              null,
              `template ${t.name} (${t.language}) was not returned`,
            );
          }
          return template;
        });
      },

      async markInactiveExcept(accountId, keep) {
        if (!isUuid(accountId)) return 0;
        const kept = JSON.stringify(keep.map((k) => ({ name: k.name, language: k.language })));
        const rows = await execute(
          db,
          "templates.markInactiveExcept",
          sql`update sendo_templates as t set active = false
              where t.account_id = ${accountId}::uuid and t.active
                and not exists (
                  select 1 from jsonb_to_recordset(${kept}::jsonb) as k(name text, language text)
                  where k.name = t.name and k.language = t.language
                )
              returning t.id`,
        );
        return rows.length;
      },

      async list(query = {}) {
        const parts = [sql`true`];
        if (query.accountId !== undefined) {
          parts.push(
            isUuid(query.accountId) ? sql`t.account_id = ${query.accountId}::uuid` : sql`false`,
          );
        }
        if (query.status !== undefined) parts.push(sql`t.status = ${query.status}`);
        if (query.active !== undefined) parts.push(sql`t.active = ${query.active}`);
        const rows = await jsonRows<TemplateRow>(
          db,
          "templates.list",
          sql`select to_jsonb(t) as r from sendo_templates t where ${sql.join(parts, sql` and `)}
              order by t.name asc, t.language asc`,
        );
        return rows.map(toTemplate);
      },

      async get(accountId, name, language) {
        if (!isUuid(accountId)) return null;
        const row = await jsonRow<TemplateRow>(
          db,
          "templates.get",
          sql`select to_jsonb(t) as r from sendo_templates t
              where t.account_id = ${accountId}::uuid and t.name = ${name} and t.language = ${language}`,
        );
        return row ? toTemplate(row) : null;
      },
    },

    snippets: drizzleSnippets(db),

    tags: drizzleTags(db),

    rules: drizzleRules(db),

    broadcasts: drizzleBroadcasts(db),

    metrics: drizzleMetrics(db),

    events: {
      async insert(input) {
        const row = await jsonRow<EventRow>(
          db,
          "events.insert",
          sql`insert into sendo_events as t (payload) values (${jsonb(input.payload ?? null)})
              returning to_jsonb(t) as r`,
        );
        if (!row) throw new DrizzleAdapterError("events.insert", null, "no row returned");
        return toEvent(row);
      },

      async setStatus(id, status, error) {
        const row = isUuid(id)
          ? await jsonRow<EventRow>(
              db,
              "events.setStatus",
              sql`update sendo_events as t
                  set status = ${status}::sendo_event_status, error = ${error ?? null},
                      processed_at = ${status === "received" ? sql`t.processed_at` : sql`${new Date().toISOString()}::timestamptz`}
                  where t.id = ${id}::uuid returning to_jsonb(t) as r`,
            )
          : null;
        if (!row) throw notFound("event", id);
        return toEvent(row);
      },

      async get(id) {
        const row = isUuid(id)
          ? await jsonRow<EventRow>(
              db,
              "events.get",
              sql`select to_jsonb(t) as r from sendo_events t where t.id = ${id}::uuid`,
            )
          : null;
        return row ? toEvent(row) : null;
      },

      prune: (olderThan) =>
        scalar(
          db,
          "events.prune",
          sql`with deleted as (
                delete from sendo_events t
                where t.received_at < ${olderThan.toISOString()}::timestamptz returning 1
              ) select count(*) from deleted`,
        ),
    },

    locks: {
      // Same statements as `sendo_acquire_lock` / `sendo_release_lock`.
      async acquire(key, ttlMs) {
        const rows = await execute(
          db,
          "locks.acquire",
          sql`insert into sendo_locks as l (key, expires_at)
              values (${key}, clock_timestamp() + ${Math.max(1, Math.ceil(ttlMs))}::int * interval '1 millisecond')
              on conflict (key) do update set expires_at = excluded.expires_at
                where l.expires_at <= clock_timestamp()
              returning true as acquired`,
        );
        return rows.length > 0;
      },
      async release(key) {
        await execute(db, "locks.release", sql`delete from sendo_locks l where l.key = ${key}`);
      },
    },

    storage: options.media,

    async schemaVersion() {
      try {
        const [row] = await execute(
          db,
          "schemaVersion",
          sql`select m.version from sendo_schema_meta m order by m.version desc limit 1`,
        );
        return row ? Number(row.version) : null;
      } catch (error) {
        if (pgErrorOf(error)?.code === PG_UNDEFINED_TABLE) return null;
        throw error;
      }
    },

    async healthCheck() {
      const rows = await execute(
        db,
        "healthCheck",
        sql`select n as missing from unnest(${textArray(SENDO_TABLES)}) as n
            where to_regclass(n) is null`,
      );
      const missing = SENDO_TABLES.filter((table) => rows.some((r) => r.missing === table));
      return { tablesOk: missing.length === 0, missing };
    },
  };
}
