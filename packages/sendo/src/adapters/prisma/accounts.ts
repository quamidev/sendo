import { AccountStateError, ConstraintViolationError, DuplicateAccountError } from "../../errors";
import {
  type AccountRow,
  type ContactRow,
  accountPatchToRow,
  reactivationToRow,
  toAccount,
  toContact,
} from "../supabase/rows";
import type { ContactUpsertInput, ContactUpsertResult, SendoAdapter } from "../types";
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
import { ACCOUNT_CONSTRAINTS, CONTACT_CONSTRAINTS, notFound } from "./shared";

export function prismaAccounts(
  db: Db,
  transaction: <R>(fn: (tx: Db) => Promise<R>) => Promise<R>,
): SendoAdapter["accounts"] {
  const accounts = db.t("sendo_accounts");

  const getRow = async (operation: string, id: string, on: Db = db): Promise<AccountRow | null> => {
    if (!isUuid(id)) return null;
    const params = new Params();
    return on.row<AccountRow>(
      operation,
      `select to_jsonb(a.*) as row from ${accounts} a where a.id = ${params.add(id, "uuid")}`,
      params,
    );
  };

  return {
    async getByPhoneNumberId(phoneNumberId) {
      const params = new Params();
      const row = await db.row<AccountRow>(
        "accounts.getByPhoneNumberId",
        `select to_jsonb(a.*) as row from ${accounts} a
         where a.phone_number_id = ${params.add(phoneNumberId, "text")}`,
        params,
      );
      return row ? toAccount(row) : null;
    },

    async getById(id) {
      const row = await getRow("accounts.getById", id);
      return row ? toAccount(row) : null;
    },

    async list(filter = {}) {
      const params = new Params();
      const where = ["true"];
      if (filter.tenantId !== undefined)
        where.push(tenantMatch(params, "a.tenant_id", filter.tenantId));
      if (filter.active !== undefined)
        where.push(`a.active = ${params.add(filter.active, "boolean")}`);
      const rows = await db.rows<AccountRow>(
        "accounts.list",
        `select to_jsonb(a.*) as row from ${accounts} a where ${where.join(" and ")}
         order by a.created_at asc, a.id asc`,
        params,
      );
      return rows.map(toAccount);
    },

    async insert(input) {
      const params = new Params();
      const result = await db.attempt<{ row: AccountRow }>(
        `insert into ${accounts} as a ${insertClause(params, {
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
        })}
        returning to_jsonb(a.*) as row`,
        params,
      );
      if (result.failed) {
        if (
          input.phoneNumberId != null &&
          isUniqueViolation(result.error, "sendo_accounts_phone_number_id_key")
        ) {
          throw new DuplicateAccountError(
            { phoneNumberId: input.phoneNumberId },
            { cause: result.error },
          );
        }
        throw writeFailure("accounts.insert", result.error, ACCOUNT_CONSTRAINTS);
      }
      const row = result.rows[0]?.row;
      if (!row) throw new PrismaAdapterError("accounts.insert", { message: "no row returned" });
      return toAccount(row);
    },

    async setDefault(id) {
      const operation = "accounts.setDefault";
      if (!isUuid(id)) throw notFound("account", id);
      // Port of `sendo_set_default_account`: one transaction, serialized per tenant.
      const row = await transaction(async (tx) => {
        const target = await getRow(operation, id, tx);
        if (!target) return null;
        const lock = new Params();
        await tx.execute(
          operation,
          `select pg_advisory_xact_lock(hashtextextended(${lock.add(
            `sendo_default_account:${target.tenant_id ?? ""}`,
            "text",
          )}, 0))`,
          lock,
        );
        const clear = new Params();
        await tx.execute(
          operation,
          `update ${accounts} a set is_default = false
           where a.is_default and a.id <> ${clear.add(id, "uuid")}
             and ${tenantMatch(clear, "a.tenant_id", target.tenant_id)}`,
          clear,
        );
        const set = new Params();
        return tx.row<AccountRow>(
          operation,
          `update ${accounts} a set is_default = true where a.id = ${set.add(id, "uuid")}
           returning to_jsonb(a.*) as row`,
          set,
        );
      });
      if (!row) throw notFound("account", id);
      return toAccount(row);
    },

    async update(id, patch) {
      const operation = "accounts.update";
      if (!isUuid(id)) throw notFound("account", id);
      const params = new Params();
      const assignments = setClause(params, accountPatchToRow(patch));
      if (assignments === "") {
        const row = await getRow(operation, id);
        if (!row) throw notFound("account", id);
        return toAccount(row);
      }
      const result = await db.attempt<{ row: AccountRow }>(
        `update ${accounts} a set ${assignments} where a.id = ${params.add(id, "uuid")}
         returning to_jsonb(a.*) as row`,
        params,
      );
      if (result.failed) throw writeFailure(operation, result.error, ACCOUNT_CONSTRAINTS);
      const row = result.rows[0]?.row;
      if (!row) throw notFound("account", id);
      return toAccount(row);
    },

    async reactivate(phoneNumberId, input) {
      const operation = "accounts.reactivate";
      const params = new Params();
      const result = await db.attempt<{ row: AccountRow }>(
        `update ${accounts} a set ${setClause(params, reactivationToRow(input))}
         where a.phone_number_id = ${params.add(phoneNumberId, "text")} and not a.active
           and ${tenantMatch(params, "a.tenant_id", input.tenantId ?? null)}
         returning to_jsonb(a.*) as row`,
        params,
      );
      if (result.failed) throw writeFailure(operation, result.error, ACCOUNT_CONSTRAINTS);
      const row = result.rows[0]?.row;
      if (row) return toAccount(row);
      const lookup = new Params();
      const existing = await db.query<{ id: string }>(
        operation,
        `select a.id from ${accounts} a where a.phone_number_id = ${lookup.add(phoneNumberId, "text")}`,
        lookup,
      );
      if (existing.length === 0) throw notFound("account", phoneNumberId);
      throw new DuplicateAccountError({ phoneNumberId });
    },

    async purge(id) {
      const operation = "accounts.purge";
      const account = await getRow(operation, id);
      if (!account) throw notFound("account", id);
      if (account.active) throw new AccountStateError({ accountId: id, state: "active" });
      return transaction(async (tx) => {
        const paths = new Params();
        const media = await tx.query<{ storage_path: string }>(
          operation,
          `select md.storage_path from ${db.t("sendo_media")} md
           join ${db.t("sendo_messages")} m on m.id = md.message_id
           join ${db.t("sendo_conversations")} c on c.id = m.conversation_id
           where c.account_id = ${paths.add(id, "uuid")} and md.storage_path is not null
           order by md.id`,
          paths,
        );
        // The FK cascades remove contacts, conversations, messages, media, templates,
        // broadcasts and account-scoped snippets and rules; `not active` makes a concurrent
        // reconnect win over the purge.
        const del = new Params();
        const deleted = await tx.execute(
          operation,
          `delete from ${accounts} a where a.id = ${del.add(id, "uuid")} and not a.active`,
          del,
        );
        if (deleted === 0) {
          const current = await getRow(operation, id, tx);
          if (!current) throw notFound("account", id);
          throw new AccountStateError({ accountId: id, state: "active" });
        }
        return { storagePaths: media.map((m) => m.storage_path) };
      });
    },
  };
}

export function prismaContacts(db: Db): SendoAdapter["contacts"] {
  const contacts = db.t("sendo_contacts");

  /** Keyed on the phone when given, else on the channel user id (the identity rule). */
  const findContact = async (input: ContactUpsertInput): Promise<ContactRow | null> => {
    if (!isUuid(input.accountId)) return null;
    const params = new Params();
    const key =
      input.phone != null
        ? `k.phone = ${params.add(input.phone, "text")}`
        : `k.channel_user_id = ${params.add(input.channelUserId ?? "", "text")}`;
    return db.row<ContactRow>(
      "contacts.upsert",
      `select to_jsonb(k.*) as row from ${contacts} k
       where k.account_id = ${params.add(input.accountId, "uuid")} and ${key}`,
      params,
    );
  };

  const updateExisting = async (
    existing: ContactRow,
    input: ContactUpsertInput,
  ): Promise<ContactUpsertResult> => {
    const profileChanged = input.profileName != null && input.profileName !== existing.profile_name;
    const values: Record<string, unknown> = {};
    if (input.waId != null && input.waId !== existing.wa_id) values.wa_id = input.waId;
    if (input.channelUserId != null && input.channelUserId !== existing.channel_user_id) {
      values.channel_user_id = input.channelUserId;
    }
    if (profileChanged) values.profile_name = input.profileName ?? null;
    if (Object.keys(values).length === 0) {
      return { contact: toContact(existing), created: false, profileChanged: false };
    }
    const params = new Params();
    const result = await db.attempt<{ row: ContactRow }>(
      `update ${contacts} k set ${setClause(params, values)}
       where k.id = ${params.add(existing.id, "uuid")} returning to_jsonb(k.*) as row`,
      params,
    );
    if (result.failed) throw writeFailure("contacts.upsert", result.error, CONTACT_CONSTRAINTS);
    const row = result.rows[0]?.row ?? existing;
    return { contact: toContact(row), created: false, profileChanged };
  };

  const setColumns = async (operation: string, id: string, values: Record<string, unknown>) => {
    if (!isUuid(id)) throw notFound("contact", id);
    const params = new Params();
    const row = await db.row<ContactRow>(
      operation,
      `update ${contacts} k set ${setClause(params, values)}
       where k.id = ${params.add(id, "uuid")} returning to_jsonb(k.*) as row`,
      params,
    );
    if (!row) throw notFound("contact", id);
    return toContact(row);
  };

  return {
    async upsert(input) {
      if (input.phone == null && input.channelUserId == null) {
        throw new ConstraintViolationError({ constraint: "sendo_contacts_identity" });
      }
      const existing = await findContact(input);
      if (existing) return updateExisting(existing, input);

      const params = new Params();
      const result = await db.attempt<{ row: ContactRow }>(
        `insert into ${contacts} as k ${insertClause(params, {
          tenant_id: input.tenantId,
          account_id: input.accountId,
          channel: input.channel ?? "whatsapp",
          phone: input.phone ?? null,
          channel_user_id: input.channelUserId ?? null,
          wa_id: input.waId ?? null,
          profile_name: input.profileName ?? null,
        })}
        returning to_jsonb(k.*) as row`,
        params,
      );
      if (result.failed) {
        // A concurrent upsert created the same identity first: update that row instead.
        const identityKey =
          input.phone != null
            ? "sendo_contacts_account_id_phone_key"
            : "sendo_contacts_account_id_channel_user_id_key";
        if (isUniqueViolation(result.error, identityKey)) {
          const raced = await findContact(input);
          if (raced) return updateExisting(raced, input);
        }
        throw writeFailure("contacts.upsert", result.error, CONTACT_CONSTRAINTS);
      }
      const row = result.rows[0]?.row;
      if (!row) throw new PrismaAdapterError("contacts.upsert", { message: "no row returned" });
      return { contact: toContact(row), created: true, profileChanged: false };
    },

    async get(id) {
      if (!isUuid(id)) return null;
      const params = new Params();
      const row = await db.row<ContactRow>(
        "contacts.get",
        `select to_jsonb(k.*) as row from ${contacts} k where k.id = ${params.add(id, "uuid")}`,
        params,
      );
      return row ? toContact(row) : null;
    },

    async getByPhone(accountId, phone) {
      if (!isUuid(accountId)) return null;
      const params = new Params();
      const row = await db.row<ContactRow>(
        "contacts.getByPhone",
        `select to_jsonb(k.*) as row from ${contacts} k
         where k.account_id = ${params.add(accountId, "uuid")} and k.phone = ${params.add(phone, "text")}`,
        params,
      );
      return row ? toContact(row) : null;
    },

    setAppRef: (id, appRef) => setColumns("contacts.setAppRef", id, { app_ref: appRef }),

    setOptIn: (id, input) =>
      setColumns("contacts.setOptIn", id, {
        marketing_opt_in: input.marketingOptIn,
        opt_in_at: input.optInAt,
      }),
  };
}
