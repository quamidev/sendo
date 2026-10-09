import type { BroadcastRecipientCounts, BroadcastRecipientInsertInput } from "../adapters/types";
import { isUuid } from "../core/accounts";
import type { SendoContext } from "../core/context";
import {
  AccountNotFoundError,
  PayloadValidationError,
  RecordNotFoundError,
  TemplateNotFoundError,
  TemplateVariablesError,
} from "../errors/errors";
import { assertCan, requireActor, type Actor } from "../team/permissions";
import type {
  Account,
  Broadcast,
  BroadcastRecipient,
  Contact,
  Page,
  Template,
  TenantId,
} from "../types/entities";
import type { BroadcastRecipientStatus, BroadcastStatus, TemplateCategory } from "../types/enums";
import {
  BROADCAST_SKIP_REASONS,
  parseVariables,
  skipReasonFor,
  variableCount,
  type BroadcastSkipReason,
  type BroadcastVariables,
} from "./eligibility";

/** A contact id, a phone (upserted as a contact on create), or either with its own variables. */
export type BroadcastRecipientInput =
  | string
  | { phone: string }
  | { contactId?: string; phone?: string; variables?: BroadcastVariables };

export interface BroadcastCreateInput {
  /** Account id or Meta phone number id; omitted → the tenant's default (or only) number. */
  account?: string;
  /** Must be the actor's tenant when given. */
  tenant?: TenantId;
  template: string;
  language: string;
  recipients: BroadcastRecipientInput[];
  /** Shared by every recipient; a recipient's own `variables` win. */
  variables?: BroadcastVariables;
  /** Default 60. A positive integer. */
  ratePerMinute?: number;
  /** Needs `broadcasts.manage` (admin). */
  actor: Actor;
}

export type BroadcastPreviewInput = BroadcastCreateInput;

export interface BroadcastPreview {
  /** Distinct recipients (by contact, or by phone for numbers not yet stored). */
  total: number;
  eligible: number;
  skipped: Record<BroadcastSkipReason, number>;
  accountId: string;
  category: TemplateCategory;
  ratePerMinute: number;
  /** Minutes the tick needs at `ratePerMinute` (one pass per minute). */
  estimatedMinutes: number;
}

export interface BroadcastView extends Broadcast {
  counts: BroadcastRecipientCounts;
}

export interface BroadcastRecipientView extends BroadcastRecipient {
  contact: Pick<Contact, "id" | "phone" | "profileName" | "appRef"> | null;
}

export interface BroadcastsListQuery {
  actor: Actor;
  accountId?: string;
  status?: BroadcastStatus | BroadcastStatus[];
  cursor?: string | null;
  /** Default 20, at most 100. */
  limit?: number;
}

export interface BroadcastRecipientsQuery {
  actor: Actor;
  status?: BroadcastRecipientStatus | BroadcastRecipientStatus[];
  cursor?: string | null;
  /** Default 50, at most 200. */
  limit?: number;
}

/**
 * `sendo.broadcasts`: every method needs `broadcasts.manage` and acts on the actor's tenant
 * (another tenant's broadcast → `RECORD_NOT_FOUND`).
 */
export interface BroadcastsApi {
  /**
   * Stores a `queued` broadcast; the tick sends it. Eligible recipients are `pending`, the rest
   * `skipped` with `no_opt_in` / `opted_out` / `invalid_phone` (phones that don't parse have no
   * contact and are not stored). Throws `TEMPLATE_NOT_FOUND` (missing, inactive, not APPROVED),
   * `TEMPLATE_VARIABLES`, `INVALID_PAYLOAD` (`field`), `ACCOUNT_NOT_FOUND`, `AMBIGUOUS_ACCOUNT`,
   * `RECORD_NOT_FOUND` (unknown contact id), `FORBIDDEN`.
   */
  create(input: BroadcastCreateInput): Promise<Broadcast>;
  /** The same checks and counts as `create`, without writing anything. */
  preview(input: BroadcastPreviewInput): Promise<BroadcastPreview>;
  get(id: string, o: { actor: Actor }): Promise<BroadcastView>;
  /** Newest first. */
  list(q: BroadcastsListQuery): Promise<Page<Broadcast>>;
  /** Per-recipient results with the contact's phone and name. */
  recipients(id: string, q: BroadcastRecipientsQuery): Promise<Page<BroadcastRecipientView>>;
  /**
   * Pending recipients become `cancelled` and the broadcast `cancelled`. A finished (`done`,
   * `failed`) or already cancelled broadcast is returned unchanged.
   */
  cancel(id: string, o: { actor: Actor }): Promise<Broadcast>;
}

export const DEFAULT_RATE_PER_MINUTE = 60;
const INSERT_BATCH = 500;

interface Planned {
  /** Stored contact; null for a phone that has no contact yet. */
  contact: Contact | null;
  /** Normalized phone of a `{ phone }` recipient. */
  phone: string | null;
  variables: BroadcastVariables | undefined;
  skip: BroadcastSkipReason | null;
}

interface Plan {
  account: Account;
  template: Template;
  ratePerMinute: number;
  variables: BroadcastVariables | undefined;
  recipients: Planned[];
  invalidPhones: number;
}

function invalid(field: string, message: string): PayloadValidationError {
  return new PayloadValidationError({ field, message });
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

function emptySkipped(): Record<BroadcastSkipReason, number> {
  return Object.fromEntries(BROADCAST_SKIP_REASONS.map((r) => [r, 0])) as Record<
    BroadcastSkipReason,
    number
  >;
}

export function createBroadcastsApi(ctx: SendoContext): BroadcastsApi {
  const { adapter } = ctx;

  async function begin(actor: Actor): Promise<void> {
    requireActor(actor, "broadcasts.manage");
    assertCan(actor, "broadcasts.manage");
    await ctx.ready();
  }

  async function requireBroadcast(id: string, actor: Actor): Promise<Broadcast> {
    const broadcast = await adapter.broadcasts.get(id);
    if (broadcast === null || broadcast.tenantId !== actor.tenantId) {
      throw new RecordNotFoundError({ entity: "broadcast", id });
    }
    return broadcast;
  }

  async function resolveAccount(input: BroadcastCreateInput): Promise<Account> {
    const { actor } = input;
    if (input.tenant !== undefined && input.tenant !== actor.tenantId) {
      throw new AccountNotFoundError({ account: input.account ?? null, tenantId: input.tenant });
    }
    return ctx.resolveAccount({ account: input.account, tenant: actor.tenantId });
  }

  async function requireTemplate(account: Account, name: string, language: string) {
    const template = await adapter.templates.get(account.id, name, language);
    const notFound = (reason: "missing" | "inactive" | "not_approved") =>
      new TemplateNotFoundError({ name, language, accountId: account.id, reason });
    if (template === null) throw notFound("missing");
    if (!template.active) throw notFound("inactive");
    if (template.status !== "APPROVED") throw notFound("not_approved");
    return template;
  }

  function assertVariables(template: Template, variables: BroadcastVariables | undefined): void {
    const received = variableCount(variables);
    if (received !== template.variableCount) {
      throw new TemplateVariablesError({
        name: template.name,
        expected: template.variableCount,
        received,
      });
    }
  }

  /** Validates the input and classifies every recipient. Writes nothing. */
  async function plan(input: BroadcastCreateInput): Promise<Plan> {
    if (typeof input.template !== "string" || input.template.trim() === "") {
      throw invalid("template", "is required");
    }
    if (typeof input.language !== "string" || input.language.trim() === "") {
      throw invalid("language", "is required");
    }
    if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
      throw invalid("recipients", "needs at least one recipient");
    }
    const ratePerMinute = input.ratePerMinute ?? DEFAULT_RATE_PER_MINUTE;
    if (!Number.isInteger(ratePerMinute) || ratePerMinute < 1) {
      throw invalid("ratePerMinute", "must be a positive integer");
    }
    const variables = parseVariables(input.variables, "variables");

    const account = await resolveAccount(input);
    const template = await requireTemplate(account, input.template, input.language);

    const recipients: Planned[] = [];
    const seen = new Set<string>();
    let invalidPhones = 0;
    for (const [i, entry] of input.recipients.entries()) {
      const field = `recipients[${String(i)}]`;
      const raw: unknown = typeof entry === "string" ? { contactId: entry } : entry;
      if (typeof raw !== "object" || raw === null) {
        throw invalid(field, "must be a contact id or { phone }");
      }
      const ref = raw as { contactId?: unknown; phone?: unknown; variables?: unknown };
      const own = parseVariables(ref.variables, `${field}.variables`);
      assertVariables(template, own ?? variables);
      const contactId = ref.contactId;

      let contact: Contact | null;
      let phone: string | null = null;
      let key: string;
      if (contactId !== undefined) {
        if (typeof contactId !== "string" || contactId === "") {
          throw invalid(`${field}.contactId`, "must be a contact id");
        }
        const found = await adapter.contacts.get(contactId);
        if (found === null || found.tenantId !== account.tenantId) {
          throw new RecordNotFoundError({ entity: "contact", id: contactId });
        }
        if (found.accountId !== account.id) {
          throw invalid(`${field}.contactId`, "belongs to another number of the tenant");
        }
        contact = found;
        key = found.id;
      } else {
        const rawPhone = ref.phone;
        if (typeof rawPhone !== "string" || rawPhone.trim() === "") {
          throw invalid(field, "needs a contactId or a phone");
        }
        try {
          phone = ctx.normalizePhone(rawPhone);
        } catch {
          invalidPhones++;
          continue;
        }
        contact = await adapter.contacts.getByPhone(account.id, phone);
        key = contact?.id ?? `phone:${phone}`;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      // A phone not stored yet is a new contact: no marketing decision yet.
      const skip = skipReasonFor(
        template.category,
        contact ?? { marketingOptIn: false, optInAt: null, phone: "" },
      );
      recipients.push({ contact, phone, variables: own, skip });
    }
    return { account, template, ratePerMinute, variables, recipients, invalidPhones };
  }

  function summarize(p: Plan): BroadcastPreview {
    const skipped = emptySkipped();
    skipped.invalid_phone = p.invalidPhones;
    let eligible = 0;
    for (const r of p.recipients) {
      if (r.skip === null) eligible++;
      else skipped[r.skip]++;
    }
    return {
      total: p.recipients.length + p.invalidPhones,
      eligible,
      skipped,
      accountId: p.account.id,
      category: p.template.category,
      ratePerMinute: p.ratePerMinute,
      estimatedMinutes: Math.ceil(eligible / p.ratePerMinute),
    };
  }

  return {
    async preview(input) {
      await begin(input.actor);
      return summarize(await plan(input));
    },

    async create(input) {
      await begin(input.actor);
      const p = await plan(input);
      // New phones become contacts (`services.contacts.ensure`, so `linkContact` runs).
      for (const r of p.recipients) {
        if (r.contact !== null || r.phone === null) continue;
        r.contact = (
          await ctx.services.contacts.ensure({ account: p.account, phone: r.phone })
        ).contact;
        r.skip = skipReasonFor(p.template.category, r.contact);
      }
      const broadcast = await adapter.broadcasts.insert({
        tenantId: p.account.tenantId,
        accountId: p.account.id,
        templateName: p.template.name,
        language: p.template.language,
        category: p.template.category,
        variables: p.variables ?? null,
        ratePerMinute: p.ratePerMinute,
        createdBy: input.actor.userId,
      });
      const rows: BroadcastRecipientInsertInput[] = p.recipients.flatMap((r) =>
        r.contact === null
          ? []
          : [
              {
                contactId: r.contact.id,
                variables: r.variables ?? null,
                ...(r.skip === null ? {} : { status: "skipped" as const, skipReason: r.skip }),
              },
            ],
      );
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await adapter.broadcasts.insertRecipients(broadcast.id, rows.slice(i, i + INSERT_BATCH));
      }
      if (p.invalidPhones > 0) {
        ctx.logger.warn(
          `[sendo] broadcast ${broadcast.id}: ${String(p.invalidPhones)} invalid phone(s) skipped`,
        );
      }
      return broadcast;
    },

    async get(id, { actor }) {
      await begin(actor);
      const broadcast = await requireBroadcast(id, actor);
      return { ...broadcast, counts: await adapter.broadcasts.counts(id) };
    },

    async list({ actor, accountId, status, cursor, limit }) {
      await begin(actor);
      let scoped: string | undefined;
      if (accountId !== undefined) {
        // A filter on a number of the actor's tenant (connected or not), by id or phone number id.
        const account =
          (isUuid(accountId) ? await adapter.accounts.getById(accountId) : null) ??
          (await adapter.accounts.getByPhoneNumberId(accountId));
        if (account === null || account.tenantId !== actor.tenantId) {
          throw new AccountNotFoundError({ account: accountId, tenantId: actor.tenantId });
        }
        scoped = account.id;
      }
      return adapter.broadcasts.list({
        tenantId: actor.tenantId,
        ...(scoped === undefined ? {} : { accountId: scoped }),
        ...(status === undefined ? {} : { status }),
        cursor: cursor ?? null,
        limit: clampLimit(limit, 20, 100),
      });
    },

    async recipients(id, { actor, status, cursor, limit }) {
      await begin(actor);
      await requireBroadcast(id, actor);
      const page = await adapter.broadcasts.listRecipients({
        broadcastId: id,
        ...(status === undefined ? {} : { status }),
        cursor: cursor ?? null,
        limit: clampLimit(limit, 50, 200),
      });
      const items = await Promise.all(
        page.items.map(async (recipient): Promise<BroadcastRecipientView> => {
          const c = await adapter.contacts.get(recipient.contactId);
          return {
            ...recipient,
            contact:
              c === null
                ? null
                : { id: c.id, phone: c.phone, profileName: c.profileName, appRef: c.appRef },
          };
        }),
      );
      return { items, nextCursor: page.nextCursor };
    },

    async cancel(id, { actor }) {
      await begin(actor);
      const broadcast = await requireBroadcast(id, actor);
      if (
        broadcast.status === "done" ||
        broadcast.status === "failed" ||
        broadcast.status === "cancelled"
      ) {
        return broadcast;
      }
      // Status first, so a running tick pass stops before its next send.
      const cancelled = await adapter.broadcasts.update(id, {
        status: "cancelled",
        pauseReason: null,
        finishedAt: new Date(),
      });
      await adapter.broadcasts.cancelPending(id);
      return cancelled;
    },
  };
}
