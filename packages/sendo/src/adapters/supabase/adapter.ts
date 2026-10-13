import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AccountStateError,
  ConstraintViolationError,
  DuplicateAccountError,
  RecordNotFoundError,
} from "../../errors";
import type { RecordEntity } from "../../errors/errors";
import type { JsonObject, Page, Tag, TenantId } from "../../types/entities";
import type { ConversationStatus } from "../../types/enums";
import {
  compareRules,
  compareSnippets,
  compareTags,
  searchNeedles,
  sortSourceCounts,
} from "../shared";
import type {
  ContactUpsertInput,
  ContactUpsertResult,
  ConversationFilter,
  ConversationListItem,
  GetOpenOrCreateInput,
  GetOpenOrCreateResult,
  RuleUpsertInput,
  RuleUpsertResult,
  StatusUpdateResult,
  SendoAdapter,
} from "../types";
import { SENDO_TABLES } from "../types";
import type { MediaStore } from "../../media/types";
import { supabaseStorage } from "../../storage/supabase";
import { supabaseBroadcasts } from "./broadcasts";
import { supabaseMetrics } from "./metrics";
import {
  UUID_RE,
  afterCursorFilter,
  decodeCursor,
  encodeCursor,
  exec,
  execById,
  execCount,
  quote,
  settle,
  writeFailure,
} from "./query";
import {
  type DbError,
  SupabaseAdapterError,
  isInvalidId,
  isMissingTable,
  isUniqueViolation,
} from "./errors";
import {
  type AccountRow,
  type ContactRow,
  type ConversationListRow,
  type ConversationRow,
  type EventRow,
  type MediaRow,
  type MessageRow,
  type MessageWithMediaRow,
  type RuleRow,
  type SnippetRow,
  type TagRow,
  type TemplateRow,
  type ConversationTagRow,
  accountPatchToRow,
  conversationPatchToRow,
  firstOf,
  mediaPatchToRow,
  messagePatchToRow,
  reactivationToRow,
  rulePatchToRow,
  toAccount,
  toContact,
  toConversation,
  toConversationListItem,
  toEvent,
  toMedia,
  toMessage,
  toMessageWithMedia,
  toRule,
  toSnippet,
  toTag,
  toTemplate,
} from "./rows";

export interface SupabaseAdapterOptions {
  /** Private Storage bucket for media, e.g. `sendo-media` (the adapter's default `supabaseStorage`). */
  storageBucket: string;
  /** TTL used by `storage.signedUrl` when it is called with a non-positive TTL. Default 3600. */
  signedUrlTtlSec?: number;
}

const OPEN_STATUSES = ["agent", "human"] as const;
const MESSAGE_WITH_MEDIA = "*, sendo_media(*)";
const UPDATE_RESULTS: readonly StatusUpdateResult[] = ["updated", "ignored", "placeholder"];
/** PostgREST `max_rows` is usually 1000; purge pages through media rows below that. */
const PURGE_PAGE_SIZE = 500;

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
const MESSAGE_CONSTRAINTS = ["sendo_messages_internal_draft_check"] as const;
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
/** Conversation ids per `sendo_conversation_tags` request (keeps the URL short). */
const TAG_LOOKUP_BATCH = 100;

function templateKey(name: string, language: string): string {
  return JSON.stringify([name, language]);
}

/** `ilike` substring pattern; `%`, `_` and `\` in the needle match literally. */
function likePattern(needle: string): string {
  return quote(`*${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}*`);
}

/** `or=` filter on the embedded contact for `ConversationFilter.search`. */
function searchFilter(needles: { text: string; phone: string }): string {
  const parts = [
    `profile_name.ilike.${likePattern(needles.text)}`,
    `app_ref.ilike.${likePattern(needles.text)}`,
  ];
  if (needles.phone !== "") parts.push(`phone.ilike.${likePattern(needles.phone)}`);
  return parts.join(",");
}

/** `or=` filter mirroring `canSeeConversation` for agents. */
function visibleToFilter(userId: string, queues: string[]): string {
  const queue =
    queues.length > 0
      ? `or(queue.is.null,queue.in.(${queues.map(quote).join(",")}))`
      : "queue.is.null";
  return `assigned_to.eq.${quote(userId)},and(assigned_to.is.null,${queue})`;
}

function statusList(status: ConversationStatus | ConversationStatus[]): ConversationStatus[] {
  return Array.isArray(status) ? status : [status];
}

/**
 * Production `SendoAdapter` backed by Postgres (PostgREST) and Supabase Storage.
 * Pass a SERVICE ROLE client: the `sendo_*` tables are RLS-protected and the RPC
 * functions are only granted to `service_role`. Requires the `schema` migration.
 */
export { decodeCursor };

export function supabaseAdapter(
  serviceRoleClient: SupabaseClient,
  options: SupabaseAdapterOptions,
): SendoAdapter & { storage: MediaStore } {
  const db = serviceRoleClient;

  const notFound = (entity: RecordEntity, id: string): RecordNotFoundError =>
    new RecordNotFoundError({ entity, id });

  const messageWithMediaQuery = () =>
    db
      .from("sendo_messages")
      .select(MESSAGE_WITH_MEDIA)
      .not("conversation_id", "is", null)
      .order("created_at", { referencedTable: "sendo_media", ascending: false })
      .limit(1, { referencedTable: "sendo_media" });

  const getAccountRow = (operation: string, id: string) =>
    execById<AccountRow>(
      operation,
      db.from("sendo_accounts").select("*").eq("id", id).maybeSingle(),
    );

  const getConversationRow = (operation: string, id: string) =>
    execById<ConversationRow>(
      operation,
      db.from("sendo_conversations").select("*").eq("id", id).maybeSingle(),
    );

  const findOpenConversation = async (
    input: GetOpenOrCreateInput,
  ): Promise<ConversationRow | null> =>
    exec<ConversationRow | null>(
      "conversations.getOpenOrCreate",
      db
        .from("sendo_conversations")
        .select("*")
        .eq("contact_id", input.contactId)
        .eq("account_id", input.accountId)
        .in("status", [...OPEN_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );

  const updateExistingContact = async (
    existing: ContactRow,
    input: ContactUpsertInput,
  ): Promise<ContactUpsertResult> => {
    const profileChanged = input.profileName != null && input.profileName !== existing.profile_name;
    const patch: Partial<ContactRow> = {};
    if (input.waId != null && input.waId !== existing.wa_id) patch.wa_id = input.waId;
    if (input.channelUserId != null && input.channelUserId !== existing.channel_user_id) {
      patch.channel_user_id = input.channelUserId;
    }
    if (profileChanged) patch.profile_name = input.profileName ?? null;
    if (Object.keys(patch).length === 0) {
      return { contact: toContact(existing), created: false, profileChanged: false };
    }
    const { data, error } = await settle(
      db.from("sendo_contacts").update(patch).eq("id", existing.id).select("*").single(),
    );
    if (error) throw writeFailure("contacts.upsert", error, CONTACT_CONSTRAINTS);
    return { contact: toContact(data as ContactRow), created: false, profileChanged };
  };

  /** Keyed on the phone when given, else on the channel user id (the identity rule). */
  const findContact = (input: ContactUpsertInput) => {
    const query = db.from("sendo_contacts").select("*").eq("account_id", input.accountId);
    return exec<ContactRow | null>(
      "contacts.upsert",
      (input.phone != null
        ? query.eq("phone", input.phone)
        : query.eq("channel_user_id", input.channelUserId ?? "")
      ).maybeSingle(),
    );
  };

  /**
   * `sendo_conversations` filtered by `filter`. `columns` must not embed `sendo_contacts` or
   * `sendo_conversation_tags` (added here when `search` / `tagIds` need them).
   */
  const filteredConversations = (
    columns: string,
    filter: ConversationFilter,
    options: { contacts?: boolean; count?: boolean } = {},
  ) => {
    const needles = searchNeedles(filter.search);
    const tagIds = filter.tagIds ?? [];
    const embeds = [columns];
    if (options.contacts || needles) {
      embeds.push(needles ? "sendo_contacts!inner(*)" : "sendo_contacts(*)");
    }
    if (tagIds.length > 0) embeds.push("sendo_conversation_tags!inner(tag_id)");
    let q = db
      .from("sendo_conversations")
      .select(embeds.join(", "), options.count ? { count: "exact", head: true } : undefined);
    if (filter.tenantId === null) q = q.is("tenant_id", null);
    else if (filter.tenantId !== undefined) q = q.eq("tenant_id", filter.tenantId);
    if (filter.accountId !== undefined) q = q.eq("account_id", filter.accountId);
    if (filter.status !== undefined) q = q.in("status", statusList(filter.status));
    if (filter.assignedTo === null) q = q.is("assigned_to", null);
    else if (filter.assignedTo !== undefined) q = q.eq("assigned_to", filter.assignedTo);
    if (filter.queue === null) q = q.is("queue", null);
    else if (filter.queue !== undefined) q = q.eq("queue", filter.queue);
    if (filter.visibleTo) {
      q = q.or(visibleToFilter(filter.visibleTo.userId, filter.visibleTo.queues));
    }
    if (tagIds.length > 0) q = q.in("sendo_conversation_tags.tag_id", tagIds);
    if (needles) q = q.or(searchFilter(needles), { referencedTable: "sendo_contacts" });
    return q;
  };

  const getTagRow = (operation: string, id: string) =>
    execById<TagRow>(operation, db.from("sendo_tags").select("*").eq("id", id).maybeSingle());

  const findRuleRow = (tenantId: TenantId, key: string) => {
    const q = db.from("sendo_rules").select("*").eq("key", key);
    return exec<RuleRow | null>(
      "rules.upsert",
      (tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", tenantId)).maybeSingle(),
    );
  };

  const nextRulePosition = async (tenantId: TenantId): Promise<number> => {
    const q = db.from("sendo_rules").select("position");
    const row = await exec<{ position: number } | null>(
      "rules.upsert",
      (tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", tenantId))
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    return row ? row.position + 1 : 0;
  };

  const writeRule = async (
    input: RuleUpsertInput,
    existing: RuleRow | null,
  ): Promise<{ data: unknown; error: DbError | null }> => {
    const at = new Date().toISOString();
    if (existing) {
      const values: Record<string, unknown> = {
        type: input.type,
        params: input.params,
        updated_by: input.updatedBy ?? null,
        updated_at: at,
      };
      if (input.accountId !== undefined) values.account_id = input.accountId;
      if (input.position !== undefined) values.position = input.position;
      if (input.active !== undefined) values.active = input.active;
      if (input.origin !== undefined) values.origin = input.origin;
      if (input.type !== existing.type) values.state = {};
      return settle(
        db.from("sendo_rules").update(values).eq("id", existing.id).select("*").maybeSingle(),
      );
    }
    return settle(
      db
        .from("sendo_rules")
        .insert({
          tenant_id: input.tenantId,
          account_id: input.accountId ?? null,
          key: input.key,
          type: input.type,
          params: input.params,
          position: input.position ?? (await nextRulePosition(input.tenantId)),
          active: input.active ?? true,
          origin: input.origin ?? "screen",
          updated_by: input.updatedBy ?? null,
          updated_at: at,
        })
        .select("*")
        .single(),
    );
  };

  /** Deletes one row by id; unknown or malformed id → `RecordNotFoundError`. */
  const deleteById = async (
    table: "sendo_snippets" | "sendo_tags" | "sendo_rules",
    entity: RecordEntity,
    id: string,
  ): Promise<void> => {
    const rows = await execById<{ id: string }[]>(
      `${entity}s.delete`,
      db.from(table).delete().eq("id", id).select("id"),
    );
    if (!rows || rows.length === 0) throw notFound(entity, id);
  };

  return {
    accounts: {
      async getByPhoneNumberId(phoneNumberId) {
        const row = await exec<AccountRow | null>(
          "accounts.getByPhoneNumberId",
          db.from("sendo_accounts").select("*").eq("phone_number_id", phoneNumberId).maybeSingle(),
        );
        return row ? toAccount(row) : null;
      },
      async getById(id) {
        const row = await execById<AccountRow>(
          "accounts.getById",
          db.from("sendo_accounts").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toAccount(row) : null;
      },
      async list(filter = {}) {
        let query = db.from("sendo_accounts").select("*");
        if (filter.tenantId === null) query = query.is("tenant_id", null);
        else if (filter.tenantId !== undefined) query = query.eq("tenant_id", filter.tenantId);
        if (filter.active !== undefined) query = query.eq("active", filter.active);
        const rows = await exec<AccountRow[]>(
          "accounts.list",
          query.order("created_at", { ascending: true }).order("id", { ascending: true }),
        );
        return rows.map(toAccount);
      },
      async insert(input) {
        const { data, error } = await settle(
          db
            .from("sendo_accounts")
            .insert({
              tenant_id: input.tenantId ?? null,
              channel: input.channel ?? "whatsapp",
              label: input.label ?? null,
              phone_number_id: input.phoneNumberId ?? null,
              waba_id: input.wabaId ?? null,
              display_phone: input.displayPhone,
              token_ref: input.tokenRef,
              ...(input.timezone !== undefined && { timezone: input.timezone }),
              ...(input.active !== undefined && { active: input.active }),
              is_default: input.isDefault ?? false,
              coexistence: input.coexistence ?? false,
              onboarded_via: input.onboardedVia ?? "manual",
              agent_paused: input.agentPaused ?? false,
              agent_mode: input.agentMode ?? null,
              billing_ready: input.billingReady ?? null,
              billing_checked_at: input.billingCheckedAt?.toISOString() ?? null,
            })
            .select("*")
            .single(),
        );
        if (error) {
          if (
            input.phoneNumberId != null &&
            isUniqueViolation(error, "sendo_accounts_phone_number_id_key")
          ) {
            throw new DuplicateAccountError(
              { phoneNumberId: input.phoneNumberId },
              { cause: error },
            );
          }
          throw writeFailure("accounts.insert", error, ACCOUNT_CONSTRAINTS);
        }
        return toAccount(data as AccountRow);
      },
      async setDefault(id) {
        const rows = await execById<AccountRow[]>(
          "accounts.setDefault",
          db.rpc("sendo_set_default_account", { id }),
        );
        const [row] = rows ?? [];
        if (!row) throw notFound("account", id);
        return toAccount(row);
      },
      async update(id, patch) {
        const values = accountPatchToRow(patch);
        if (Object.keys(values).length === 0) {
          const row = await getAccountRow("accounts.update", id);
          if (!row) throw notFound("account", id);
          return toAccount(row);
        }
        const { data, error } = await settle(
          db.from("sendo_accounts").update(values).eq("id", id).select("*").maybeSingle(),
        );
        if (error) {
          if (isInvalidId(error)) throw notFound("account", id);
          throw writeFailure("accounts.update", error, ACCOUNT_CONSTRAINTS);
        }
        if (!data) throw notFound("account", id);
        return toAccount(data as AccountRow);
      },
      async reactivate(phoneNumberId, input) {
        const tenantId = input.tenantId ?? null;
        let query = db
          .from("sendo_accounts")
          .update(reactivationToRow(input))
          .eq("phone_number_id", phoneNumberId)
          .eq("active", false);
        query = tenantId === null ? query.is("tenant_id", null) : query.eq("tenant_id", tenantId);
        const { data, error } = await settle(query.select("*").maybeSingle());
        if (error) throw writeFailure("accounts.reactivate", error, ACCOUNT_CONSTRAINTS);
        if (data) return toAccount(data as AccountRow);
        const existing = await exec<{ id: string } | null>(
          "accounts.reactivate",
          db.from("sendo_accounts").select("id").eq("phone_number_id", phoneNumberId).maybeSingle(),
        );
        if (!existing) throw notFound("account", phoneNumberId);
        throw new DuplicateAccountError({ phoneNumberId });
      },
      async purge(id) {
        const operation = "accounts.purge";
        const account = await getAccountRow(operation, id);
        if (!account) throw notFound("account", id);
        if (account.active) throw new AccountStateError({ accountId: id, state: "active" });

        const storagePaths: string[] = [];
        for (let from = 0; ; from += PURGE_PAGE_SIZE) {
          const rows = await exec<{ storage_path: string | null }[]>(
            operation,
            db
              .from("sendo_media")
              .select(
                "id, storage_path, sendo_messages!inner(sendo_conversations!inner(account_id))",
              )
              .eq("sendo_messages.sendo_conversations.account_id", id)
              .not("storage_path", "is", null)
              .order("id", { ascending: true })
              .range(from, from + PURGE_PAGE_SIZE - 1),
          );
          for (const row of rows)
            if (row.storage_path !== null) storagePaths.push(row.storage_path);
          if (rows.length < PURGE_PAGE_SIZE) break;
        }

        // One statement: the FK cascades remove contacts, conversations, messages, media and
        // templates; `active = false` makes a concurrent reconnect win over the purge.
        const deleted = await exec<{ id: string }[]>(
          operation,
          db.from("sendo_accounts").delete().eq("id", id).eq("active", false).select("id"),
        );
        if (deleted.length === 0) {
          const current = await getAccountRow(operation, id);
          if (!current) throw notFound("account", id);
          throw new AccountStateError({ accountId: id, state: "active" });
        }
        return { storagePaths };
      },
    },

    contacts: {
      async upsert(input) {
        if (input.phone == null && input.channelUserId == null) {
          throw new ConstraintViolationError({ constraint: "sendo_contacts_identity" });
        }
        const existing = await findContact(input);
        if (existing) return updateExistingContact(existing, input);

        const { data, error } = await settle(
          db
            .from("sendo_contacts")
            .insert({
              tenant_id: input.tenantId,
              account_id: input.accountId,
              channel: input.channel ?? "whatsapp",
              phone: input.phone ?? null,
              channel_user_id: input.channelUserId ?? null,
              wa_id: input.waId ?? null,
              profile_name: input.profileName ?? null,
            })
            .select("*")
            .single(),
        );
        if (error) {
          // A concurrent upsert created the same identity first: update that row instead.
          const identityKey =
            input.phone != null
              ? "sendo_contacts_account_id_phone_key"
              : "sendo_contacts_account_id_channel_user_id_key";
          if (isUniqueViolation(error, identityKey)) {
            const raced = await findContact(input);
            if (raced) return updateExistingContact(raced, input);
          }
          throw writeFailure("contacts.upsert", error, CONTACT_CONSTRAINTS);
        }
        return { contact: toContact(data as ContactRow), created: true, profileChanged: false };
      },
      async get(id) {
        const row = await execById<ContactRow>(
          "contacts.get",
          db.from("sendo_contacts").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toContact(row) : null;
      },
      async getByPhone(accountId, phone) {
        const row = await exec<ContactRow | null>(
          "contacts.getByPhone",
          db
            .from("sendo_contacts")
            .select("*")
            .eq("account_id", accountId)
            .eq("phone", phone)
            .maybeSingle(),
        );
        return row ? toContact(row) : null;
      },
      async setOptIn(id, input) {
        const row = await execById<ContactRow>(
          "contacts.setOptIn",
          db
            .from("sendo_contacts")
            .update({
              marketing_opt_in: input.marketingOptIn,
              opt_in_at: input.optInAt?.toISOString() ?? null,
            })
            .eq("id", id)
            .select("*")
            .maybeSingle(),
        );
        if (!row) throw notFound("contact", id);
        return toContact(row);
      },
      async setAppRef(id, appRef) {
        const row = await execById<ContactRow>(
          "contacts.setAppRef",
          db
            .from("sendo_contacts")
            .update({ app_ref: appRef })
            .eq("id", id)
            .select("*")
            .maybeSingle(),
        );
        if (!row) throw notFound("contact", id);
        return toContact(row);
      },
    },

    conversations: {
      async getOpenOrCreate(input): Promise<GetOpenOrCreateResult> {
        const operation = "conversations.getOpenOrCreate";
        // Concurrent callers race on the partial unique index (one open conversation per
        // contact); the loser re-reads the winner's row.
        for (let attempt = 0; attempt < 3; attempt++) {
          const open = await findOpenConversation(input);
          if (open) return { conversation: toConversation(open), created: false, reopened: false };

          const closed = await exec<ConversationRow | null>(
            operation,
            db
              .from("sendo_conversations")
              .select("*")
              .eq("contact_id", input.contactId)
              .eq("account_id", input.accountId)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .limit(1)
              .maybeSingle(),
          );

          const { data, error } = closed
            ? await settle(
                db
                  .from("sendo_conversations")
                  .update({
                    status: "agent",
                    assigned_to: null,
                    assigned_at: null,
                    handoff_reason: null,
                  })
                  .eq("id", closed.id)
                  .eq("status", "closed")
                  .select("*")
                  .maybeSingle(),
              )
            : await settle(
                db
                  .from("sendo_conversations")
                  .insert({
                    tenant_id: input.tenantId,
                    account_id: input.accountId,
                    contact_id: input.contactId,
                    channel: input.channel ?? "whatsapp",
                    status: "agent",
                  })
                  .select("*")
                  .single(),
              );
          if (error) {
            if (isUniqueViolation(error, "sendo_conversations_open_contact_key")) continue;
            throw new SupabaseAdapterError(operation, error);
          }
          if (!data) continue;
          return {
            conversation: toConversation(data as ConversationRow),
            created: !closed,
            reopened: Boolean(closed),
          };
        }
        const open = await findOpenConversation(input);
        if (open) return { conversation: toConversation(open), created: false, reopened: false };
        throw new SupabaseAdapterError(operation, {
          message: `could not open a conversation for contact ${input.contactId}`,
        });
      },
      async get(id) {
        const row = await getConversationRow("conversations.get", id);
        return row ? toConversation(row) : null;
      },
      async update(id, patch) {
        const operation = "conversations.update";
        const { incrementUnread, ...fields } = patch;
        const values = conversationPatchToRow(fields);
        let row =
          Object.keys(values).length > 0
            ? await execById<ConversationRow>(
                operation,
                db
                  .from("sendo_conversations")
                  .update(values)
                  .eq("id", id)
                  .select("*")
                  .maybeSingle(),
              )
            : await getConversationRow(operation, id);
        if (!row) throw notFound("conversation", id);
        if (incrementUnread) {
          const count = await exec<number | null>(
            operation,
            db.rpc("sendo_increment_unread", { conversation_id: id, amount: incrementUnread }),
          );
          if (count === null) throw notFound("conversation", id);
          row = { ...row, unread_count: count };
        }
        return toConversation(row);
      },
      async list(query): Promise<Page<ConversationListItem>> {
        let q = filteredConversations("*, sendo_messages(*)", query, { contacts: true })
          .order("last_activity_at", { ascending: false })
          .order("id", { ascending: false })
          .order("created_at", { referencedTable: "sendo_messages", ascending: false })
          .order("id", { referencedTable: "sendo_messages", ascending: false })
          .limit(1, { referencedTable: "sendo_messages" })
          .limit(query.limit + 1);
        const cursor = decodeCursor(query.cursor);
        if (cursor) q = q.or(afterCursorFilter("last_activity_at", cursor));

        const rows = await exec<ConversationListRow[]>("conversations.list", q);
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map(toConversationListItem),
          nextCursor:
            rows.length > query.limit && last ? encodeCursor(last.last_activity_at, last.id) : null,
        };
      },
      async count(filter) {
        return execCount(
          "conversations.count",
          filteredConversations("id", filter, { count: true }),
        );
      },
      async countBySource(query) {
        const rows = await exec<{ source: string | null; conversations: number | string }[]>(
          "conversations.countBySource",
          db.rpc("sendo_count_by_source", {
            tenant_id: query.tenantId,
            account_id: query.accountId ?? null,
            from_at: query.from?.toISOString() ?? null,
            to_at: query.to?.toISOString() ?? null,
          }),
        );
        return sortSourceCounts(
          rows.map((r) => ({ source: r.source, conversations: Number(r.conversations) })),
        );
      },
      async countByAssignee(query) {
        const statuses = query.status === undefined ? [...OPEN_STATUSES] : statusList(query.status);
        const assignees = [...new Set(query.assignees)];
        const counts = await Promise.all(
          assignees.map((assignee) => {
            const q = db
              .from("sendo_conversations")
              .select("id", { count: "exact", head: true })
              .eq("assigned_to", assignee)
              .in("status", statuses);
            return execCount(
              "conversations.countByAssignee",
              query.tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", query.tenantId),
            );
          }),
        );
        return Object.fromEntries(assignees.map((id, i) => [id, counts[i] ?? 0]));
      },
      async findForTick(query) {
        const limit = Math.max(0, Math.floor(query.limit));
        if (limit === 0) return [];
        if (query.type === "escalate") {
          const rows = await exec<ConversationRow[]>(
            "conversations.findForTick",
            db.rpc("sendo_escalation_candidates", {
              tenant_id: query.tenantId,
              waiting_since: query.waitingSince.toISOString(),
              max_rows: limit,
              account_id: query.accountId ?? null,
              match_queue: query.queue !== undefined,
              queue: query.queue ?? null,
            }),
          );
          return rows.map(toConversation);
        }
        let q = db
          .from("sendo_conversations")
          .select("*")
          .in("status", [...OPEN_STATUSES])
          .lt("last_activity_at", query.inactiveSince.toISOString());
        q = query.tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", query.tenantId);
        if (query.accountId !== undefined) q = q.eq("account_id", query.accountId);
        const rows = await exec<ConversationRow[]>(
          "conversations.findForTick",
          q
            .order("last_activity_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(limit),
        );
        return rows.map(toConversation);
      },
    },

    messages: {
      async insertInbound(input) {
        const rows = await exec<MessageRow[]>(
          "messages.insertInbound",
          db
            .from("sendo_messages")
            .upsert(
              {
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
                sent_at: input.sentAt.toISOString(),
              },
              { onConflict: "meta_message_id", ignoreDuplicates: true },
            )
            .select("*"),
        );
        const row = rows[0];
        return row ? toMessage(row) : null;
      },
      async insertOutbound(input) {
        const { data, error } = await settle(
          db
            .from("sendo_messages")
            .insert({
              tenant_id: input.tenantId,
              conversation_id: input.conversationId,
              direction: "out",
              type: input.type,
              content: input.content,
              text: input.text ?? null,
              reply_to_meta_id: input.replyToMetaId ?? null,
              status: input.status ?? "pending",
              ...(input.status === "sent" && { sent_at: new Date().toISOString() }),
              sender: input.sender,
              sender_ref: input.senderRef ?? null,
              metadata: input.metadata ?? {},
              internal: input.internal ?? false,
              draft: input.draft ?? false,
              tokens_in: input.tokensIn ?? null,
              tokens_out: input.tokensOut ?? null,
              cost_cents: input.costCents ?? null,
            })
            .select("*")
            .single(),
        );
        if (error) throw writeFailure("messages.insertOutbound", error, MESSAGE_CONSTRAINTS);
        return toMessage(data as MessageRow);
      },
      async markSent(id, metaMessageId) {
        const rows = await execById<MessageRow[]>(
          "messages.markSent",
          db.rpc("sendo_mark_sent", { message_id: id, meta_message_id: metaMessageId }),
        );
        const row = rows?.[0];
        if (!row) throw notFound("message", id);
        return toMessage(row);
      },
      async markFailed(id, error) {
        const row = await execById<MessageRow>(
          "messages.markFailed",
          db
            .from("sendo_messages")
            .update({ status: "failed", error })
            .eq("id", id)
            .not("conversation_id", "is", null)
            .select("*")
            .maybeSingle(),
        );
        if (!row) throw notFound("message", id);
        return toMessage(row);
      },
      async updateStatus(metaMessageId, status, opts = {}) {
        const result = await exec<string>(
          "messages.updateStatus",
          db.rpc("sendo_update_message_status", {
            meta_message_id: metaMessageId,
            status,
            error: opts.error ?? null,
            at: opts.at ? opts.at.toISOString() : null,
          }),
        );
        const known = UPDATE_RESULTS.find((r) => r === result);
        if (!known) {
          throw new SupabaseAdapterError("messages.updateStatus", {
            message: `unexpected result ${JSON.stringify(result)}`,
          });
        }
        return known;
      },
      async get(id) {
        const row = await execById<MessageWithMediaRow>(
          "messages.get",
          messageWithMediaQuery().eq("id", id).maybeSingle(),
        );
        return row ? toMessageWithMedia(row) : null;
      },
      async getByMetaId(metaMessageId) {
        const row = await exec<MessageWithMediaRow | null>(
          "messages.getByMetaId",
          messageWithMediaQuery().eq("meta_message_id", metaMessageId).maybeSingle(),
        );
        return row ? toMessageWithMedia(row) : null;
      },
      async history(conversationId, limit) {
        if (limit <= 0) return [];
        const rows = await execById<MessageWithMediaRow[]>(
          "messages.history",
          messageWithMediaQuery()
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(limit),
        );
        return (rows ?? []).reverse().map(toMessageWithMedia);
      },
      async thread(conversationId, query) {
        let q = messageWithMediaQuery()
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(query.limit + 1);
        const cursor = decodeCursor(query.cursor);
        if (cursor) q = q.or(afterCursorFilter("created_at", cursor));
        const rows = (await execById<MessageWithMediaRow[]>("messages.thread", q)) ?? [];
        const page = rows.slice(0, query.limit);
        const last = page.at(-1);
        return {
          items: page.map(toMessageWithMedia),
          nextCursor:
            rows.length > query.limit && last ? encodeCursor(last.created_at, last.id) : null,
        };
      },
      async countInboundSince(contactId, since) {
        const operation = "messages.countInboundSince";
        const conversations =
          (await execById<{ id: string }[]>(
            operation,
            db.from("sendo_conversations").select("id").eq("contact_id", contactId),
          )) ?? [];
        if (conversations.length === 0) return 0;
        return execCount(
          operation,
          db
            .from("sendo_messages")
            .select("id", { count: "exact", head: true })
            .eq("direction", "in")
            .in(
              "conversation_id",
              conversations.map((c) => c.id),
            )
            .gte("created_at", since.toISOString()),
        );
      },
      async updateMetadata(id, patch: JsonObject) {
        const rows = await execById<MessageRow[]>(
          "messages.updateMetadata",
          db.rpc("sendo_merge_message_metadata", { message_id: id, patch }),
        );
        const row = rows?.[0];
        if (!row) throw notFound("message", id);
        return toMessage(row);
      },
      async update(id, patch) {
        const operation = "messages.update";
        const values = messagePatchToRow(patch);
        let row: MessageRow | null = null;
        if (Object.keys(values).length > 0) {
          const { data, error } = await settle(
            db
              .from("sendo_messages")
              .update(values)
              .eq("id", id)
              .not("conversation_id", "is", null)
              .select("*")
              .maybeSingle(),
          );
          if (error) {
            if (isInvalidId(error)) throw notFound("message", id);
            throw writeFailure(operation, error, MESSAGE_CONSTRAINTS);
          }
          if (!data) throw notFound("message", id);
          row = data as MessageRow;
        }
        if (patch.metadata !== undefined) {
          const rows = await execById<MessageRow[]>(
            operation,
            db.rpc("sendo_merge_message_metadata", { message_id: id, patch: patch.metadata }),
          );
          row = rows?.[0] ?? null;
          if (!row) throw notFound("message", id);
        }
        if (!row) {
          row = await execById<MessageRow>(
            operation,
            db
              .from("sendo_messages")
              .select("*")
              .eq("id", id)
              .not("conversation_id", "is", null)
              .maybeSingle(),
          );
          if (!row) throw notFound("message", id);
        }
        return toMessage(row);
      },
      async deleteDrafts(conversationId) {
        const { error, count } = await settle(
          db
            .from("sendo_messages")
            .delete({ count: "exact" })
            .eq("conversation_id", conversationId)
            .eq("draft", true),
        );
        if (error) {
          if (isInvalidId(error)) return 0;
          throw new SupabaseAdapterError("messages.deleteDrafts", error);
        }
        return count ?? 0;
      },
      async pendingDraftConversations(conversationIds) {
        const ids = [...new Set(conversationIds)].filter((id) => UUID_RE.test(id));
        const found = new Set<string>();
        for (let i = 0; i < ids.length; i += TAG_LOOKUP_BATCH) {
          const rows = await exec<{ conversation_id: string }[]>(
            "messages.pendingDraftConversations",
            db
              .from("sendo_messages")
              .select("conversation_id")
              .eq("draft", true)
              .in("conversation_id", ids.slice(i, i + TAG_LOOKUP_BATCH)),
          );
          for (const row of rows) found.add(row.conversation_id);
        }
        return [...found];
      },
    },

    media: {
      async insert(input) {
        const row = await exec<MediaRow>(
          "media.insert",
          db
            .from("sendo_media")
            .insert({
              tenant_id: input.tenantId,
              message_id: input.messageId,
              meta_media_id: input.metaMediaId ?? null,
              mime_type: input.mimeType ?? null,
              size_bytes: input.sizeBytes ?? null,
              sha256: input.sha256 ?? null,
              storage_path: input.storagePath ?? null,
              download_status: input.downloadStatus ?? "pending",
            })
            .select("*")
            .single(),
        );
        return toMedia(row);
      },
      async update(id, patch) {
        const values = mediaPatchToRow(patch);
        const query =
          Object.keys(values).length > 0
            ? db.from("sendo_media").update(values).eq("id", id).select("*").maybeSingle()
            : db.from("sendo_media").select("*").eq("id", id).maybeSingle();
        const row = await execById<MediaRow>("media.update", query);
        if (!row) throw notFound("media", id);
        return toMedia(row);
      },
    },

    templates: {
      async upsertMany(accountId, templates) {
        const operation = "templates.upsertMany";
        if (templates.length === 0) return [];
        const account = await execById<Pick<AccountRow, "tenant_id">>(
          operation,
          db.from("sendo_accounts").select("tenant_id").eq("id", accountId).maybeSingle(),
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
            synced_at: (t.syncedAt ?? new Date()).toISOString(),
          });
        }
        const rows = await exec<TemplateRow[]>(
          operation,
          db
            .from("sendo_templates")
            .upsert([...byKey.values()], { onConflict: "account_id,name,language" })
            .select("*"),
        );
        const saved = new Map(rows.map((r) => [templateKey(r.name, r.language), toTemplate(r)]));
        return templates.map((t) => {
          const template = saved.get(templateKey(t.name, t.language));
          if (!template) {
            throw new SupabaseAdapterError(operation, {
              message: `template ${t.name} (${t.language}) was not returned`,
            });
          }
          return template;
        });
      },
      async markInactiveExcept(accountId, keep) {
        const operation = "templates.markInactiveExcept";
        const active =
          (await execById<Pick<TemplateRow, "id" | "name" | "language">[]>(
            operation,
            db
              .from("sendo_templates")
              .select("id, name, language")
              .eq("account_id", accountId)
              .eq("active", true),
          )) ?? [];
        const kept = new Set(keep.map((k) => templateKey(k.name, k.language)));
        const ids = active
          .filter((t) => !kept.has(templateKey(t.name, t.language)))
          .map((t) => t.id);
        if (ids.length === 0) return 0;
        return execCount(
          operation,
          db
            .from("sendo_templates")
            .update({ active: false }, { count: "exact" })
            .in("id", ids)
            .eq("active", true),
        );
      },
      async list(query = {}) {
        let q = db.from("sendo_templates").select("*");
        if (query.accountId !== undefined) q = q.eq("account_id", query.accountId);
        if (query.status !== undefined) q = q.eq("status", query.status);
        if (query.active !== undefined) q = q.eq("active", query.active);
        const rows =
          (await execById<TemplateRow[]>(
            "templates.list",
            q.order("name", { ascending: true }).order("language", { ascending: true }),
          )) ?? [];
        return rows.map(toTemplate);
      },
      async get(accountId, name, language) {
        const row = await execById<TemplateRow>(
          "templates.get",
          db
            .from("sendo_templates")
            .select("*")
            .eq("account_id", accountId)
            .eq("name", name)
            .eq("language", language)
            .maybeSingle(),
        );
        return row ? toTemplate(row) : null;
      },
    },

    snippets: {
      async list(query) {
        let q = db.from("sendo_snippets").select("*");
        q = query.tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", query.tenantId);
        q =
          query.userId === undefined
            ? q.eq("visibility", "tenant")
            : q.or(
                `visibility.eq.tenant,and(visibility.eq.personal,owner_user_id.eq.${quote(query.userId)})`,
              );
        if (query.accountId !== undefined) {
          q = q.or(`account_id.is.null,account_id.eq.${quote(query.accountId)}`);
        }
        const rows = (await execById<SnippetRow[]>("snippets.list", q)) ?? [];
        return rows.map(toSnippet).sort(compareSnippets);
      },
      async get(id) {
        const row = await execById<SnippetRow>(
          "snippets.get",
          db.from("sendo_snippets").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toSnippet(row) : null;
      },
      async upsert(input) {
        const operation = "snippets.upsert";
        const at = new Date().toISOString();
        if (input.id !== undefined) {
          const values: Record<string, unknown> = {
            shortcut: input.shortcut,
            body: input.body,
            updated_by: input.by ?? null,
            updated_at: at,
          };
          if (input.accountId !== undefined) values.account_id = input.accountId;
          if (input.visibility !== undefined) values.visibility = input.visibility;
          if (input.ownerUserId !== undefined) values.owner_user_id = input.ownerUserId;
          const q = db.from("sendo_snippets").update(values).eq("id", input.id);
          const { data, error } = await settle(
            (input.tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", input.tenantId))
              .select("*")
              .maybeSingle(),
          );
          if (error) {
            if (isInvalidId(error)) throw notFound("snippet", input.id);
            throw writeFailure(operation, error, SNIPPET_CONSTRAINTS);
          }
          if (!data) throw notFound("snippet", input.id);
          return toSnippet(data as SnippetRow);
        }
        const { data, error } = await settle(
          db
            .from("sendo_snippets")
            .insert({
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
            })
            .select("*")
            .single(),
        );
        if (error) throw writeFailure(operation, error, SNIPPET_CONSTRAINTS);
        return toSnippet(data as SnippetRow);
      },
      delete: (id) => deleteById("sendo_snippets", "snippet", id),
    },

    tags: {
      async list(query) {
        const q = db.from("sendo_tags").select("*");
        const rows = await exec<TagRow[]>(
          "tags.list",
          query.tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", query.tenantId),
        );
        return rows.map(toTag).sort(compareTags);
      },
      async get(id) {
        const row = await getTagRow("tags.get", id);
        return row ? toTag(row) : null;
      },
      async upsert(input) {
        const operation = "tags.upsert";
        const values = { name: input.name, color: input.color };
        if (input.id !== undefined) {
          const q = db.from("sendo_tags").update(values).eq("id", input.id);
          const { data, error } = await settle(
            (input.tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", input.tenantId))
              .select("*")
              .maybeSingle(),
          );
          if (error) {
            if (isInvalidId(error)) throw notFound("tag", input.id);
            throw writeFailure(operation, error, TAG_CONSTRAINTS);
          }
          if (!data) throw notFound("tag", input.id);
          return toTag(data as TagRow);
        }
        const { data, error } = await settle(
          db
            .from("sendo_tags")
            .insert({ tenant_id: input.tenantId, ...values })
            .select("*")
            .single(),
        );
        if (error) throw writeFailure(operation, error, TAG_CONSTRAINTS);
        return toTag(data as TagRow);
      },
      delete: (id) => deleteById("sendo_tags", "tag", id),
      async usage(id) {
        const { error, count } = await settle(
          db
            .from("sendo_conversation_tags")
            .select("tag_id", { count: "exact", head: true })
            .eq("tag_id", id),
        );
        if (error) {
          if (isInvalidId(error)) return 0;
          throw new SupabaseAdapterError("tags.usage", error);
        }
        return count ?? 0;
      },
      async addToConversation(conversationId, tagId, opts = {}) {
        const operation = "tags.addToConversation";
        const conversation = await getConversationRow(operation, conversationId);
        if (!conversation) throw notFound("conversation", conversationId);
        const tag = await getTagRow(operation, tagId);
        if (!tag || tag.tenant_id !== conversation.tenant_id) throw notFound("tag", tagId);
        const rows = await exec<{ tag_id: string }[]>(
          operation,
          db
            .from("sendo_conversation_tags")
            .upsert(
              {
                conversation_id: conversationId,
                tag_id: tagId,
                tenant_id: conversation.tenant_id,
                added_by: opts.by ?? null,
              },
              { onConflict: "conversation_id,tag_id", ignoreDuplicates: true },
            )
            .select("tag_id"),
        );
        return rows.length > 0;
      },
      async removeFromConversation(conversationId, tagId) {
        const rows = await execById<{ tag_id: string }[]>(
          "tags.removeFromConversation",
          db
            .from("sendo_conversation_tags")
            .delete()
            .eq("conversation_id", conversationId)
            .eq("tag_id", tagId)
            .select("tag_id"),
        );
        return (rows ?? []).length > 0;
      },
      async forConversations(conversationIds) {
        const result: Record<string, Tag[]> = {};
        for (const id of conversationIds) result[id] = [];
        const ids = [...new Set(conversationIds)].filter((id) => UUID_RE.test(id));
        for (let i = 0; i < ids.length; i += TAG_LOOKUP_BATCH) {
          const rows = await exec<ConversationTagRow[]>(
            "tags.forConversations",
            db
              .from("sendo_conversation_tags")
              .select("conversation_id, sendo_tags(*)")
              .in("conversation_id", ids.slice(i, i + TAG_LOOKUP_BATCH)),
          );
          for (const row of rows) {
            const tag = firstOf(row.sendo_tags);
            if (tag) result[row.conversation_id]?.push(toTag(tag));
          }
        }
        for (const tags of Object.values(result)) tags.sort(compareTags);
        return result;
      },
    },

    rules: {
      async list(query = {}) {
        let q = db.from("sendo_rules").select("*");
        if (query.tenantId === null) q = q.is("tenant_id", null);
        else if (query.tenantId !== undefined) q = q.eq("tenant_id", query.tenantId);
        if (query.accountId !== undefined) {
          q = q.or(`account_id.is.null,account_id.eq.${quote(query.accountId)}`);
        }
        if (query.active !== undefined) q = q.eq("active", query.active);
        const rows = (await execById<RuleRow[]>("rules.list", q)) ?? [];
        return rows.map(toRule).sort(compareRules);
      },
      async get(id) {
        const row = await execById<RuleRow>(
          "rules.get",
          db.from("sendo_rules").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toRule(row) : null;
      },
      async upsert(input, opts = {}): Promise<RuleUpsertResult> {
        const operation = "rules.upsert";
        // A concurrent insert of the same (tenant, key) loses on the unique constraint and
        // retries as an update (or returns the winner with `ifMissing`).
        for (let attempt = 0; attempt < 3; attempt++) {
          const existing = await findRuleRow(input.tenantId, input.key);
          if (existing && opts.ifMissing) return { rule: toRule(existing), created: false };
          const { data, error } = await writeRule(input, existing);
          if (error) {
            if (!existing && isUniqueViolation(error, "sendo_rules_tenant_key")) continue;
            throw writeFailure(operation, error, RULE_CONSTRAINTS);
          }
          if (!data) continue;
          return { rule: toRule(data as RuleRow), created: !existing };
        }
        throw new SupabaseAdapterError(operation, {
          message: `could not upsert rule ${input.key}`,
        });
      },
      async update(id, patch) {
        const { data, error } = await settle(
          db
            .from("sendo_rules")
            .update(rulePatchToRow(patch, new Date()))
            .eq("id", id)
            .select("*")
            .maybeSingle(),
        );
        if (error) {
          if (isInvalidId(error)) throw notFound("rule", id);
          throw writeFailure("rules.update", error, RULE_CONSTRAINTS);
        }
        if (!data) throw notFound("rule", id);
        return toRule(data as RuleRow);
      },
      delete: (id) => deleteById("sendo_rules", "rule", id),
      async reorder(tenantId, ids) {
        const operation = "rules.reorder";
        if (ids.length === 0) return;
        const malformed = ids.find((id) => !UUID_RE.test(id));
        if (malformed !== undefined) throw notFound("rule", malformed);
        const q = db.from("sendo_rules").select("id").in("id", ids);
        const found = await exec<{ id: string }[]>(
          operation,
          tenantId === null ? q.is("tenant_id", null) : q.eq("tenant_id", tenantId),
        );
        const known = new Set(found.map((r) => r.id));
        const missing = ids.find((id) => !known.has(id));
        if (missing !== undefined) throw notFound("rule", missing);
        await Promise.all(
          ids.map((id, position) =>
            exec<null>(operation, db.from("sendo_rules").update({ position }).eq("id", id)),
          ),
        );
      },
      async patchState(id, patch) {
        const rows = await execById<RuleRow[]>(
          "rules.patchState",
          db.rpc("sendo_merge_rule_state", { rule_id: id, patch }),
        );
        const row = rows?.[0];
        if (!row) throw notFound("rule", id);
        return toRule(row);
      },
    },

    broadcasts: supabaseBroadcasts(db),

    metrics: supabaseMetrics(db),

    events: {
      async insert(input) {
        const row = await exec<EventRow>(
          "events.insert",
          db
            .from("sendo_events")
            .insert({ payload: input.payload ?? null })
            .select("*")
            .single(),
        );
        return toEvent(row);
      },
      async setStatus(id, status, error) {
        const values: Record<string, unknown> = { status, error: error ?? null };
        if (status !== "received") values.processed_at = new Date().toISOString();
        const row = await execById<EventRow>(
          "events.setStatus",
          db.from("sendo_events").update(values).eq("id", id).select("*").maybeSingle(),
        );
        if (!row) throw notFound("event", id);
        return toEvent(row);
      },
      async get(id) {
        const row = await execById<EventRow>(
          "events.get",
          db.from("sendo_events").select("*").eq("id", id).maybeSingle(),
        );
        return row ? toEvent(row) : null;
      },
      async prune(olderThan) {
        return execCount(
          "events.prune",
          db
            .from("sendo_events")
            .delete({ count: "exact" })
            .lt("received_at", olderThan.toISOString()),
        );
      },
    },

    locks: {
      async acquire(key, ttlMs) {
        const acquired = await exec<boolean | null>(
          "locks.acquire",
          db.rpc("sendo_acquire_lock", { key, ttl_ms: Math.max(1, Math.ceil(ttlMs)) }),
        );
        return acquired === true;
      },
      async release(key) {
        await exec<null>("locks.release", db.rpc("sendo_release_lock", { key }));
      },
    },

    storage: supabaseStorage({
      client: db,
      bucket: options.storageBucket,
      signedUrlTtlSec: options.signedUrlTtlSec,
    }),

    async schemaVersion() {
      const { data, error } = await settle(
        db
          .from("sendo_schema_meta")
          .select("version")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      if (error) {
        if (isMissingTable(error)) return null;
        throw new SupabaseAdapterError("schemaVersion", error);
      }
      const row = data as { version: number | string } | null;
      return row ? Number(row.version) : null;
    },

    async healthCheck() {
      const results = await Promise.all(
        SENDO_TABLES.map(async (table) => {
          const { error } = await db.from(table).select("*").limit(0);
          if (!error) return null;
          if (isMissingTable(error)) return table;
          throw new SupabaseAdapterError("healthCheck", error);
        }),
      );
      const missing = results.filter((t): t is (typeof SENDO_TABLES)[number] => t !== null);
      return { tablesOk: missing.length === 0, missing };
    },
  };
}
