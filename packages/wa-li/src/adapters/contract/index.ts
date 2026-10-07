import { afterEach, describe, expect, it } from "vitest";
import type { Account, Contact, Conversation, MessageError, TenantId } from "../../types/entities";
import { WA_SCHEMA_VERSION } from "../../utils/schema-version";
import type {
  AccountInsertInput,
  InsertInboundMessageInput,
  InsertOutboundMessageInput,
  TemplateUpsertInput,
  WhatsAppAdapter,
} from "../types";

export type MakeAdapter = () => Promise<WhatsAppAdapter> | WhatsAppAdapter;

export interface AdapterContractOptions {
  /** `true` or a reason string skips the whole suite (e.g. the backing service is unreachable). */
  skip?: boolean | string;
  /** Runs after every test, e.g. to truncate tables. */
  afterEach?: () => Promise<void>;
}

const NOT_FOUND = { code: "RECORD_NOT_FOUND" };
const DUPLICATE_ACCOUNT = { code: "ACCOUNT_EXISTS" };
const HOUR_MS = 60 * 60 * 1000;

let counter = 0;
const uid = (): string =>
  `${Date.now().toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const digits = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join("");
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
/** Spacing between writes whose `createdAt` order matters, so real databases never tie. */
const tick = (): Promise<void> => sleep(5);

const makePhone = (): string => `+5025${digits(7)}`;
const makeTenantId = (): string => crypto.randomUUID();

const makeAccountInput = (overrides: Partial<AccountInsertInput> = {}): AccountInsertInput => ({
  tenantId: null,
  phoneNumberId: `pn${digits(12)}`,
  wabaId: `waba${digits(12)}`,
  displayPhone: "+502 5555 0000",
  tokenRef: "WA_TEST_TOKEN",
  ...overrides,
});

const makeTemplateInput = (overrides: Partial<TemplateUpsertInput> = {}): TemplateUpsertInput => ({
  name: `tpl_${uid()}`,
  language: "es",
  category: "UTILITY",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hola {{1}}" }],
  variableCount: 1,
  ...overrides,
});

const makeError = (overrides: Partial<MessageError> = {}): MessageError => ({
  code: 131047,
  title: "Re-engagement message",
  message: "More than 24 hours have passed since the recipient last replied.",
  ...overrides,
});

interface Seed {
  account: Account;
  contact: Contact;
  conversation: Conversation;
}

async function seedAccount(
  adapter: WhatsAppAdapter,
  overrides: Partial<AccountInsertInput> = {},
): Promise<Account> {
  return adapter.accounts.insert(makeAccountInput(overrides));
}

async function seedContact(
  adapter: WhatsAppAdapter,
  account: Account,
  phone: string = makePhone(),
): Promise<Contact> {
  const { contact } = await adapter.contacts.upsert({
    accountId: account.id,
    tenantId: account.tenantId,
    phone,
    waId: phone.slice(1),
    profileName: "Ana López",
  });
  return contact;
}

async function seedConversation(
  adapter: WhatsAppAdapter,
  opts: { tenantId?: TenantId; account?: Account } = {},
): Promise<Seed> {
  const account = opts.account ?? (await seedAccount(adapter, { tenantId: opts.tenantId ?? null }));
  const contact = await seedContact(adapter, account);
  const { conversation } = await adapter.conversations.getOpenOrCreate({
    contactId: contact.id,
    accountId: account.id,
    tenantId: account.tenantId,
  });
  return { account, contact, conversation };
}

const makeInbound = (
  conversation: Conversation,
  overrides: Partial<InsertInboundMessageInput> = {},
): InsertInboundMessageInput => ({
  tenantId: conversation.tenantId,
  conversationId: conversation.id,
  type: "text",
  content: { body: "Hola" },
  text: "Hola",
  metaMessageId: `wamid.${uid()}`,
  sentAt: new Date("2026-01-15T15:00:00.000Z"),
  ...overrides,
});

const makeOutbound = (
  conversation: Conversation,
  overrides: Partial<InsertOutboundMessageInput> = {},
): InsertOutboundMessageInput => ({
  tenantId: conversation.tenantId,
  conversationId: conversation.id,
  type: "text",
  content: { body: "Buenas tardes" },
  text: "Buenas tardes",
  sender: "agent",
  senderRef: "recepcion",
  ...overrides,
});

const makeMetaId = (): string => `wamid.${uid()}`;

/**
 * Executable spec for `WhatsAppAdapter`. Every adapter must pass it.
 *
 * `makeAdapter` is called once per test and must return an isolated adapter. The suite
 * scopes reads by unique tenant/account ids, so a shared database works as long as
 * each test's rows do not collide; use `afterEach` to clean up.
 */
export function runAdapterContract(
  name: string,
  makeAdapter: MakeAdapter,
  options: AdapterContractOptions = {},
): void {
  const skip = options.skip ?? false;
  const title =
    typeof skip === "string"
      ? `adapter contract: ${name} (skipped: ${skip})`
      : `adapter contract: ${name}`;

  describe.skipIf(skip !== false)(title, () => {
    const cleanup = options.afterEach;
    if (cleanup) afterEach(cleanup);

    const fresh = async (): Promise<WhatsAppAdapter> => makeAdapter();

    describe("accounts", () => {
      it("inserts with defaults and reads by id and phone number id", async () => {
        const adapter = await fresh();
        const input = makeAccountInput({ tenantId: makeTenantId() });
        const account = await adapter.accounts.insert(input);

        expect(account).toMatchObject({
          tenantId: input.tenantId,
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          displayPhone: input.displayPhone,
          tokenRef: input.tokenRef,
          timezone: "America/Guatemala",
          active: true,
        });
        expect(typeof account.id).toBe("string");
        expect(account.createdAt).toBeInstanceOf(Date);
        expect(await adapter.accounts.getById(account.id)).toEqual(account);
        expect(await adapter.accounts.getByPhoneNumberId(input.phoneNumberId)).toEqual(account);
      });

      it("returns null for unknown accounts", async () => {
        const adapter = await fresh();
        expect(await adapter.accounts.getById(crypto.randomUUID())).toBeNull();
        expect(await adapter.accounts.getByPhoneNumberId(`pn${digits(12)}`)).toBeNull();
      });

      it("throws DuplicateAccountError for a repeated phone number id", async () => {
        const adapter = await fresh();
        const input = makeAccountInput();
        await adapter.accounts.insert(input);
        await expect(adapter.accounts.insert({ ...input, wabaId: "other" })).rejects.toMatchObject({
          ...DUPLICATE_ACCOUNT,
          phoneNumberId: input.phoneNumberId,
        });
      });

      it("lists by tenant and active flag, oldest first", async () => {
        const adapter = await fresh();
        const tenantId = makeTenantId();
        const first = await seedAccount(adapter, { tenantId });
        await tick();
        const second = await seedAccount(adapter, { tenantId, active: false, timezone: "UTC" });
        await seedAccount(adapter, { tenantId: makeTenantId() });

        expect((await adapter.accounts.list({ tenantId })).map((a) => a.id)).toEqual([
          first.id,
          second.id,
        ]);
        expect((await adapter.accounts.list({ tenantId, active: false })).map((a) => a.id)).toEqual(
          [second.id],
        );
        expect(second.timezone).toBe("UTC");
        const all = (await adapter.accounts.list()).map((a) => a.id);
        expect(all).toEqual(expect.arrayContaining([first.id, second.id]));
      });

      it("lists accounts without a tenant when tenantId is null", async () => {
        const adapter = await fresh();
        const untenanted = await seedAccount(adapter, { tenantId: null });
        const tenanted = await seedAccount(adapter, { tenantId: makeTenantId() });
        const ids = (await adapter.accounts.list({ tenantId: null })).map((a) => a.id);
        expect(ids).toContain(untenanted.id);
        expect(ids).not.toContain(tenanted.id);
      });
    });

    describe("contacts", () => {
      it("creates a contact on first upsert", async () => {
        const adapter = await fresh();
        const account = await seedAccount(adapter, { tenantId: makeTenantId() });
        const phone = makePhone();
        const result = await adapter.contacts.upsert({
          accountId: account.id,
          tenantId: account.tenantId,
          phone,
          waId: phone.slice(1),
          profileName: "Ana",
        });

        expect(result.created).toBe(true);
        expect(result.profileChanged).toBe(false);
        expect(result.contact).toMatchObject({
          accountId: account.id,
          tenantId: account.tenantId,
          phone,
          waId: phone.slice(1),
          profileName: "Ana",
          appRef: null,
          marketingOptIn: false,
          optInAt: null,
        });
        expect(await adapter.contacts.get(result.contact.id)).toEqual(result.contact);
      });

      it("reuses the contact per (account, phone) and reports profile changes", async () => {
        const adapter = await fresh();
        const account = await seedAccount(adapter);
        const phone = makePhone();
        const base = { accountId: account.id, tenantId: account.tenantId, phone };
        const first = await adapter.contacts.upsert({
          ...base,
          waId: "502111",
          profileName: "Ana",
        });

        const same = await adapter.contacts.upsert({ ...base, profileName: "Ana" });
        expect(same).toMatchObject({ created: false, profileChanged: false });
        expect(same.contact.id).toBe(first.contact.id);

        const renamed = await adapter.contacts.upsert({ ...base, profileName: "Ana María" });
        expect(renamed).toMatchObject({ created: false, profileChanged: true });
        expect(renamed.contact.profileName).toBe("Ana María");

        const kept = await adapter.contacts.upsert({ ...base, waId: null, profileName: null });
        expect(kept).toMatchObject({ created: false, profileChanged: false });
        expect(kept.contact).toMatchObject({ waId: "502111", profileName: "Ana María" });
      });

      it("keeps one contact per account for the same phone", async () => {
        const adapter = await fresh();
        const phone = makePhone();
        const a = await seedAccount(adapter);
        const b = await seedAccount(adapter);
        const onA = await adapter.contacts.upsert({ accountId: a.id, tenantId: null, phone });
        const onB = await adapter.contacts.upsert({ accountId: b.id, tenantId: null, phone });

        expect(onA.created).toBe(true);
        expect(onB.created).toBe(true);
        expect(onA.contact.id).not.toBe(onB.contact.id);
        expect(onB.contact.accountId).toBe(b.id);
      });

      it("sets and clears appRef", async () => {
        const adapter = await fresh();
        const contact = await seedContact(adapter, await seedAccount(adapter));
        expect((await adapter.contacts.setAppRef(contact.id, "patient-42")).appRef).toBe(
          "patient-42",
        );
        expect((await adapter.contacts.get(contact.id))?.appRef).toBe("patient-42");
        expect((await adapter.contacts.setAppRef(contact.id, null)).appRef).toBeNull();
      });

      it("returns null or throws RecordNotFoundError for unknown contacts", async () => {
        const adapter = await fresh();
        const id = crypto.randomUUID();
        expect(await adapter.contacts.get(id)).toBeNull();
        await expect(adapter.contacts.setAppRef(id, "x")).rejects.toMatchObject({
          ...NOT_FOUND,
          entity: "contact",
          id,
        });
      });
    });

    describe("conversations", () => {
      it("creates an agent conversation when the contact has none", async () => {
        const adapter = await fresh();
        const account = await seedAccount(adapter, { tenantId: makeTenantId() });
        const contact = await seedContact(adapter, account);
        const result = await adapter.conversations.getOpenOrCreate({
          contactId: contact.id,
          accountId: account.id,
          tenantId: account.tenantId,
        });

        expect(result.created).toBe(true);
        expect(result.reopened).toBe(false);
        expect(result.conversation).toMatchObject({
          tenantId: account.tenantId,
          accountId: account.id,
          contactId: contact.id,
          status: "agent",
          assignedTo: null,
          handoffReason: null,
          lastInboundAt: null,
          windowExpiresAt: null,
          unreadCount: 0,
        });
        expect(result.conversation.lastActivityAt).toBeInstanceOf(Date);
        expect(result.conversation.createdAt).toBeInstanceOf(Date);
        expect(await adapter.conversations.get(result.conversation.id)).toEqual(
          result.conversation,
        );
      });

      it("reuses the open conversation (agent or human)", async () => {
        const adapter = await fresh();
        const { account, contact, conversation } = await seedConversation(adapter);
        const input = { contactId: contact.id, accountId: account.id, tenantId: account.tenantId };

        const again = await adapter.conversations.getOpenOrCreate(input);
        expect(again).toMatchObject({ created: false, reopened: false });
        expect(again.conversation.id).toBe(conversation.id);

        await adapter.conversations.update(conversation.id, { status: "human", assignedTo: "u1" });
        const human = await adapter.conversations.getOpenOrCreate(input);
        expect(human).toMatchObject({ created: false, reopened: false });
        expect(human.conversation).toMatchObject({
          id: conversation.id,
          status: "human",
          assignedTo: "u1",
        });
      });

      it("reopens the closed conversation instead of creating one", async () => {
        const adapter = await fresh();
        const { account, contact, conversation } = await seedConversation(adapter);
        await adapter.conversations.update(conversation.id, {
          status: "closed",
          assignedTo: "u1",
          handoffReason: "billing",
        });

        const result = await adapter.conversations.getOpenOrCreate({
          contactId: contact.id,
          accountId: account.id,
          tenantId: account.tenantId,
        });
        expect(result).toMatchObject({ created: false, reopened: true });
        expect(result.conversation).toMatchObject({
          id: conversation.id,
          status: "agent",
          assignedTo: null,
          handoffReason: null,
        });
        expect(await adapter.conversations.get(conversation.id)).toMatchObject({
          status: "agent",
          assignedTo: null,
          handoffReason: null,
        });
      });

      it("keeps conversations separate per contact", async () => {
        const adapter = await fresh();
        const account = await seedAccount(adapter);
        const first = await seedConversation(adapter, { account });
        const second = await seedConversation(adapter, { account });
        expect(first.conversation.id).not.toBe(second.conversation.id);
      });

      it("updates fields and increments unread atomically", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const lastInboundAt = new Date("2026-02-01T10:00:00.000Z");
        const windowExpiresAt = new Date("2026-02-02T10:00:00.000Z");
        const lastActivityAt = new Date("2026-02-01T10:05:00.000Z");

        const updated = await adapter.conversations.update(conversation.id, {
          status: "human",
          assignedTo: "user-7",
          handoffReason: "pidió humano",
          lastInboundAt,
          lastActivityAt,
          windowExpiresAt,
          incrementUnread: 1,
        });
        expect(updated).toMatchObject({
          id: conversation.id,
          status: "human",
          assignedTo: "user-7",
          handoffReason: "pidió humano",
          lastInboundAt,
          lastActivityAt,
          windowExpiresAt,
          unreadCount: 1,
        });

        await adapter.conversations.update(conversation.id, { incrementUnread: 2 });
        expect((await adapter.conversations.get(conversation.id))?.unreadCount).toBe(3);

        const reset = await adapter.conversations.update(conversation.id, { unreadCount: 0 });
        expect(reset.unreadCount).toBe(0);
        expect(reset.status).toBe("human");

        const both = await adapter.conversations.update(conversation.id, {
          unreadCount: 5,
          incrementUnread: 1,
        });
        expect(both.unreadCount).toBe(6);

        const cleared = await adapter.conversations.update(conversation.id, {
          assignedTo: null,
          handoffReason: null,
        });
        expect(cleared).toMatchObject({ assignedTo: null, handoffReason: null, status: "human" });
      });

      it("returns null or throws RecordNotFoundError for unknown conversations", async () => {
        const adapter = await fresh();
        const id = crypto.randomUUID();
        expect(await adapter.conversations.get(id)).toBeNull();
        await expect(adapter.conversations.update(id, { status: "closed" })).rejects.toMatchObject({
          ...NOT_FOUND,
          entity: "conversation",
          id,
        });
      });

      describe("list", () => {
        const setActivity = async (
          adapter: WhatsAppAdapter,
          seed: Seed,
          iso: string,
          patch: Parameters<WhatsAppAdapter["conversations"]["update"]>[1] = {},
        ): Promise<Conversation> =>
          adapter.conversations.update(seed.conversation.id, {
            lastActivityAt: new Date(iso),
            ...patch,
          });

        it("sorts by lastActivityAt desc and includes contact and lastMessage", async () => {
          const adapter = await fresh();
          const tenantId = makeTenantId();
          const account = await seedAccount(adapter, { tenantId });
          const older = await seedConversation(adapter, { account });
          const newer = await seedConversation(adapter, { account });
          const empty = await seedConversation(adapter, { account });
          await setActivity(adapter, older, "2026-03-01T10:00:00.000Z");
          await setActivity(adapter, newer, "2026-03-03T10:00:00.000Z");
          await setActivity(adapter, empty, "2026-03-02T10:00:00.000Z");

          await adapter.messages.insertInbound(makeInbound(newer.conversation, { text: "uno" }));
          await tick();
          const last = await adapter.messages.insertOutbound(
            makeOutbound(newer.conversation, { text: "dos" }),
          );
          await adapter.messages.updateStatus(makeMetaId(), "delivered");

          const page = await adapter.conversations.list({ tenantId, limit: 10 });
          expect(page.items.map((c) => c.id)).toEqual([
            newer.conversation.id,
            empty.conversation.id,
            older.conversation.id,
          ]);
          expect(page.nextCursor).toBeNull();

          const [first, second] = page.items;
          expect(first?.contact).toEqual(newer.contact);
          expect(first?.lastMessage?.id).toBe(last.id);
          expect(first?.lastMessage?.text).toBe("dos");
          expect(second?.contact.id).toBe(empty.contact.id);
          expect(second?.lastMessage).toBeNull();
        });

        it("filters by tenant, including null tenant", async () => {
          const adapter = await fresh();
          const tenantA = makeTenantId();
          const tenantB = makeTenantId();
          const a = await seedConversation(adapter, { tenantId: tenantA });
          const b = await seedConversation(adapter, { tenantId: tenantB });
          const none = await seedConversation(adapter, { tenantId: null });

          const pageA = await adapter.conversations.list({ tenantId: tenantA, limit: 10 });
          expect(pageA.items.map((c) => c.id)).toEqual([a.conversation.id]);

          const pageNull = await adapter.conversations.list({ tenantId: null, limit: 100 });
          const nullIds = pageNull.items.map((c) => c.id);
          expect(nullIds).toContain(none.conversation.id);
          expect(nullIds).not.toContain(a.conversation.id);
          expect(nullIds).not.toContain(b.conversation.id);
        });

        it("filters by account", async () => {
          const adapter = await fresh();
          const tenantId = makeTenantId();
          const accountA = await seedAccount(adapter, { tenantId });
          const accountB = await seedAccount(adapter, { tenantId });
          const a = await seedConversation(adapter, { account: accountA });
          await seedConversation(adapter, { account: accountB });

          const page = await adapter.conversations.list({ accountId: accountA.id, limit: 10 });
          expect(page.items.map((c) => c.id)).toEqual([a.conversation.id]);
        });

        it("filters by one or several statuses", async () => {
          const adapter = await fresh();
          const tenantId = makeTenantId();
          const account = await seedAccount(adapter, { tenantId });
          const agent = await seedConversation(adapter, { account });
          const human = await seedConversation(adapter, { account });
          const closed = await seedConversation(adapter, { account });
          await setActivity(adapter, agent, "2026-03-03T00:00:00.000Z");
          await setActivity(adapter, human, "2026-03-02T00:00:00.000Z", { status: "human" });
          await setActivity(adapter, closed, "2026-03-01T00:00:00.000Z", { status: "closed" });

          const single = await adapter.conversations.list({ tenantId, status: "human", limit: 10 });
          expect(single.items.map((c) => c.id)).toEqual([human.conversation.id]);

          const multi = await adapter.conversations.list({
            tenantId,
            status: ["agent", "closed"],
            limit: 10,
          });
          expect(multi.items.map((c) => c.id)).toEqual([
            agent.conversation.id,
            closed.conversation.id,
          ]);
        });

        it("filters by assignee, with null meaning unassigned", async () => {
          const adapter = await fresh();
          const tenantId = makeTenantId();
          const account = await seedAccount(adapter, { tenantId });
          const mine = await seedConversation(adapter, { account });
          const theirs = await seedConversation(adapter, { account });
          const unassigned = await seedConversation(adapter, { account });
          await setActivity(adapter, mine, "2026-03-03T00:00:00.000Z", { assignedTo: "u1" });
          await setActivity(adapter, theirs, "2026-03-02T00:00:00.000Z", { assignedTo: "u2" });
          await setActivity(adapter, unassigned, "2026-03-01T00:00:00.000Z");

          const assigned = await adapter.conversations.list({
            tenantId,
            assignedTo: "u1",
            limit: 10,
          });
          expect(assigned.items.map((c) => c.id)).toEqual([mine.conversation.id]);

          const none = await adapter.conversations.list({ tenantId, assignedTo: null, limit: 10 });
          expect(none.items.map((c) => c.id)).toEqual([unassigned.conversation.id]);
        });

        it("paginates with a cursor", async () => {
          const adapter = await fresh();
          const tenantId = makeTenantId();
          const account = await seedAccount(adapter, { tenantId });
          const seeds: Seed[] = [];
          for (let i = 0; i < 5; i++) {
            const seed = await seedConversation(adapter, { account });
            await setActivity(adapter, seed, `2026-04-0${i + 1}T12:00:00.000Z`);
            seeds.push(seed);
          }
          const expected = seeds.map((s) => s.conversation.id).reverse();

          const first = await adapter.conversations.list({ tenantId, limit: 2 });
          expect(first.items.map((c) => c.id)).toEqual(expected.slice(0, 2));
          expect(first.nextCursor).not.toBeNull();

          const second = await adapter.conversations.list({
            tenantId,
            limit: 2,
            cursor: first.nextCursor,
          });
          expect(second.items.map((c) => c.id)).toEqual(expected.slice(2, 4));
          expect(second.nextCursor).not.toBeNull();

          const third = await adapter.conversations.list({
            tenantId,
            limit: 2,
            cursor: second.nextCursor,
          });
          expect(third.items.map((c) => c.id)).toEqual(expected.slice(4));
          expect(third.nextCursor).toBeNull();

          const exact = await adapter.conversations.list({ tenantId, limit: 5 });
          expect(exact.items).toHaveLength(5);
          expect(exact.nextCursor).toBeNull();
        });
      });
    });

    describe("messages", () => {
      it("inserts inbound messages with fixed direction, status and sender", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter, { tenantId: makeTenantId() });
        const input = makeInbound(conversation, {
          replyToMetaId: "wamid.previous",
          metadata: { source: "webhook" },
        });
        const message = await adapter.messages.insertInbound(input);

        expect(message).toMatchObject({
          tenantId: conversation.tenantId,
          conversationId: conversation.id,
          direction: "in",
          type: "text",
          content: { body: "Hola" },
          text: "Hola",
          metaMessageId: input.metaMessageId,
          replyToMetaId: "wamid.previous",
          status: "received",
          error: null,
          sender: "contact",
          senderRef: null,
          metadata: { source: "webhook" },
          sentAt: input.sentAt,
        });
        expect(message?.createdAt).toBeInstanceOf(Date);
      });

      it("returns null for a duplicate inbound metaMessageId and writes nothing", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const input = makeInbound(conversation);
        const first = await adapter.messages.insertInbound(input);
        expect(first).not.toBeNull();
        expect(await adapter.messages.insertInbound({ ...input, text: "otra vez" })).toBeNull();

        const history = await adapter.messages.history(conversation.id, 10);
        expect(history.map((m) => m.id)).toEqual([first?.id]);
        expect(history[0]?.text).toBe("Hola");
      });

      it("inserts outbound messages as pending without a Meta id", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const message = await adapter.messages.insertOutbound(makeOutbound(conversation));
        expect(message).toMatchObject({
          conversationId: conversation.id,
          direction: "out",
          status: "pending",
          metaMessageId: null,
          sender: "agent",
          senderRef: "recepcion",
          error: null,
          replyToMetaId: null,
          metadata: {},
          sentAt: null,
        });
      });

      it("markSent sets the Meta id, status sent and sentAt", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
        const metaId = makeMetaId();
        const sent = await adapter.messages.markSent(pending.id, metaId);

        expect(sent).toMatchObject({ id: pending.id, metaMessageId: metaId, status: "sent" });
        expect(sent.sentAt).toBeInstanceOf(Date);
        expect((await adapter.messages.getByMetaId(metaId))?.id).toBe(pending.id);
      });

      it("markFailed records the error", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
        const error = makeError();
        const failed = await adapter.messages.markFailed(pending.id, error);
        expect(failed).toMatchObject({ status: "failed", error });
        expect((await adapter.messages.get(pending.id))?.error).toEqual(error);
      });

      it("throws RecordNotFoundError for writes to unknown messages", async () => {
        const adapter = await fresh();
        const id = crypto.randomUUID();
        const expected = { ...NOT_FOUND, entity: "message", id };
        await expect(adapter.messages.markSent(id, makeMetaId())).rejects.toMatchObject(expected);
        await expect(adapter.messages.markFailed(id, makeError())).rejects.toMatchObject(expected);
        await expect(adapter.messages.updateMetadata(id, { a: 1 })).rejects.toMatchObject(expected);
        expect(await adapter.messages.get(id)).toBeNull();
        expect(await adapter.messages.getByMetaId(makeMetaId())).toBeNull();
      });

      describe("updateStatus", () => {
        const sentMessage = async (adapter: WhatsAppAdapter) => {
          const { conversation } = await seedConversation(adapter);
          const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
          const metaId = makeMetaId();
          await adapter.messages.markSent(pending.id, metaId);
          return { id: pending.id, metaId };
        };

        it("moves forward and ignores late or backward statuses", async () => {
          const adapter = await fresh();
          const { id, metaId } = await sentMessage(adapter);

          expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("updated");
          expect(await adapter.messages.updateStatus(metaId, "read")).toBe("updated");
          expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
          expect(await adapter.messages.updateStatus(metaId, "sent")).toBe("ignored");
          expect(await adapter.messages.updateStatus(metaId, "read")).toBe("ignored");
          expect(await adapter.messages.updateStatus(metaId, "failed")).toBe("ignored");
          expect((await adapter.messages.get(id))?.status).toBe("read");
        });

        it("lets read skip delivered", async () => {
          const adapter = await fresh();
          const { id, metaId } = await sentMessage(adapter);
          expect(await adapter.messages.updateStatus(metaId, "read")).toBe("updated");
          expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
          expect((await adapter.messages.get(id))?.status).toBe("read");
        });

        it("records the error on failed and treats failed as final", async () => {
          const adapter = await fresh();
          const { id, metaId } = await sentMessage(adapter);
          const error = makeError({ code: 131026, message: "Message undeliverable" });

          expect(await adapter.messages.updateStatus(metaId, "failed", { error })).toBe("updated");
          expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
          expect(await adapter.messages.get(id)).toMatchObject({ status: "failed", error });
        });

        it("ignores status updates for inbound messages", async () => {
          const adapter = await fresh();
          const { conversation } = await seedConversation(adapter);
          const inbound = await adapter.messages.insertInbound(makeInbound(conversation));
          const metaId = inbound?.metaMessageId ?? "";
          expect(await adapter.messages.updateStatus(metaId, "read")).toBe("ignored");
          expect((await adapter.messages.getByMetaId(metaId))?.status).toBe("received");
        });

        it("stores a hidden placeholder when no message has the Meta id", async () => {
          const adapter = await fresh();
          const { conversation } = await seedConversation(adapter);
          const real = await adapter.messages.insertInbound(makeInbound(conversation));
          const metaId = makeMetaId();

          expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("placeholder");
          expect(await adapter.messages.updateStatus(metaId, "read")).toBe("placeholder");

          expect(await adapter.messages.getByMetaId(metaId)).toBeNull();
          expect((await adapter.messages.history(conversation.id, 50)).map((m) => m.id)).toEqual([
            real?.id,
          ]);
          const thread = await adapter.messages.thread(conversation.id, { limit: 50 });
          expect(thread.items.map((m) => m.id)).toEqual([real?.id]);
          expect(thread.items.every((m) => m.type !== "status_placeholder")).toBe(true);
        });

        it("markSent merges a placeholder into the highest status and removes it", async () => {
          const adapter = await fresh();
          const { conversation } = await seedConversation(adapter);
          const metaId = makeMetaId();
          expect(await adapter.messages.updateStatus(metaId, "read")).toBe("placeholder");
          expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("placeholder");

          const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
          const merged = await adapter.messages.markSent(pending.id, metaId);
          expect(merged).toMatchObject({ id: pending.id, metaMessageId: metaId, status: "read" });

          expect(await adapter.messages.getByMetaId(metaId)).toMatchObject({
            id: pending.id,
            status: "read",
          });
          expect(await adapter.messages.updateStatus(metaId, "delivered")).toBe("ignored");
          const history = await adapter.messages.history(conversation.id, 50);
          expect(history.map((m) => m.id)).toEqual([pending.id]);
        });

        it("markSent merges a failed placeholder with its error", async () => {
          const adapter = await fresh();
          const { conversation } = await seedConversation(adapter);
          const metaId = makeMetaId();
          const error = makeError();
          expect(await adapter.messages.updateStatus(metaId, "failed", { error })).toBe(
            "placeholder",
          );

          const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
          const merged = await adapter.messages.markSent(pending.id, metaId);
          expect(merged).toMatchObject({ status: "failed", error });
        });

        it("a placeholder keeps the forward-only rule (failed does not beat delivered)", async () => {
          const adapter = await fresh();
          const { conversation } = await seedConversation(adapter);
          const metaId = makeMetaId();
          await adapter.messages.updateStatus(metaId, "delivered");
          await adapter.messages.updateStatus(metaId, "failed", { error: makeError() });

          const pending = await adapter.messages.insertOutbound(makeOutbound(conversation));
          const merged = await adapter.messages.markSent(pending.id, metaId);
          expect(merged).toMatchObject({ status: "delivered", error: null });
        });

        it("markSent without a placeholder for its Meta id leaves other placeholders alone", async () => {
          const adapter = await fresh();
          const { conversation } = await seedConversation(adapter);
          const otherMetaId = makeMetaId();
          await adapter.messages.updateStatus(otherMetaId, "read");

          const first = await adapter.messages.insertOutbound(makeOutbound(conversation));
          expect((await adapter.messages.markSent(first.id, makeMetaId())).status).toBe("sent");

          const second = await adapter.messages.insertOutbound(makeOutbound(conversation));
          expect((await adapter.messages.markSent(second.id, otherMetaId)).status).toBe("read");
        });
      });

      it("get and getByMetaId attach media", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const message = await adapter.messages.insertInbound(
          makeInbound(conversation, { type: "image", content: { id: "media-1" }, text: null }),
        );
        if (!message) throw new Error("expected a message");
        expect((await adapter.messages.get(message.id))?.media).toBeNull();

        const media = await adapter.media.insert({
          tenantId: conversation.tenantId,
          messageId: message.id,
          metaMediaId: "media-1",
          mimeType: "image/jpeg",
        });
        expect((await adapter.messages.get(message.id))?.media).toEqual(media);
        expect((await adapter.messages.getByMetaId(message.metaMessageId ?? ""))?.media).toEqual(
          media,
        );
      });

      it("history returns the last N messages oldest first with media", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const other = await seedConversation(adapter);
        await adapter.messages.insertInbound(makeInbound(other.conversation));

        const ids: string[] = [];
        for (let i = 0; i < 4; i++) {
          const m =
            i % 2 === 0
              ? await adapter.messages.insertInbound(makeInbound(conversation, { text: `m${i}` }))
              : await adapter.messages.insertOutbound(
                  makeOutbound(conversation, { text: `m${i}` }),
                );
          if (!m) throw new Error("expected a message");
          ids.push(m.id);
          await tick();
        }
        const lastId = ids[3] ?? "";
        const media = await adapter.media.insert({
          tenantId: conversation.tenantId,
          messageId: lastId,
          mimeType: "audio/ogg",
          downloadStatus: "done",
        });

        const history = await adapter.messages.history(conversation.id, 3);
        expect(history.map((m) => m.id)).toEqual(ids.slice(1));
        expect(history.map((m) => m.text)).toEqual(["m1", "m2", "m3"]);
        expect(history[2]?.media).toEqual(media);
        expect(history[0]?.media).toBeNull();

        expect((await adapter.messages.history(conversation.id, 50)).map((m) => m.id)).toEqual(ids);
        expect(await adapter.messages.history(crypto.randomUUID(), 10)).toEqual([]);
      });

      it("thread pages newest first and nextCursor loads older messages", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const ids: string[] = [];
        for (let i = 0; i < 5; i++) {
          const m = await adapter.messages.insertOutbound(
            makeOutbound(conversation, { text: `m${i}` }),
          );
          ids.push(m.id);
          await tick();
        }
        const newestFirst = [...ids].reverse();

        const first = await adapter.messages.thread(conversation.id, { limit: 2 });
        expect(first.items.map((m) => m.id)).toEqual(newestFirst.slice(0, 2));
        expect(first.items[0]).toHaveProperty("media", null);
        expect(first.nextCursor).not.toBeNull();

        const second = await adapter.messages.thread(conversation.id, {
          limit: 2,
          cursor: first.nextCursor,
        });
        expect(second.items.map((m) => m.id)).toEqual(newestFirst.slice(2, 4));
        expect(second.nextCursor).not.toBeNull();

        const third = await adapter.messages.thread(conversation.id, {
          limit: 2,
          cursor: second.nextCursor,
        });
        expect(third.items.map((m) => m.id)).toEqual(newestFirst.slice(4));
        expect(third.nextCursor).toBeNull();

        const all = await adapter.messages.thread(conversation.id, { limit: 5, cursor: null });
        expect(all.items).toHaveLength(5);
        expect(all.nextCursor).toBeNull();

        const empty = await adapter.messages.thread(crypto.randomUUID(), { limit: 5 });
        expect(empty).toEqual({ items: [], nextCursor: null });
      });

      it("countInboundSince counts the contact's inbound messages only", async () => {
        const adapter = await fresh();
        const { contact, conversation } = await seedConversation(adapter);
        const other = await seedConversation(adapter);
        const before = new Date(Date.now() - HOUR_MS);

        await adapter.messages.insertInbound(makeInbound(conversation));
        await adapter.messages.insertInbound(makeInbound(conversation));
        await adapter.messages.insertOutbound(makeOutbound(conversation));
        await adapter.messages.insertInbound(makeInbound(other.conversation));
        await adapter.messages.updateStatus(makeMetaId(), "read");

        expect(await adapter.messages.countInboundSince(contact.id, before)).toBe(2);
        expect(
          await adapter.messages.countInboundSince(contact.id, new Date(Date.now() + HOUR_MS)),
        ).toBe(0);
        expect(await adapter.messages.countInboundSince(other.contact.id, before)).toBe(1);
      });

      it("updateMetadata shallow-merges", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter);
        const message = await adapter.messages.insertOutbound(
          makeOutbound(conversation, { metadata: { a: 1, nested: { x: 1 } } }),
        );
        const updated = await adapter.messages.updateMetadata(message.id, {
          b: 2,
          nested: { y: 2 },
        });
        expect(updated.metadata).toEqual({ a: 1, b: 2, nested: { y: 2 } });
        expect((await adapter.messages.get(message.id))?.metadata).toEqual(updated.metadata);
      });
    });

    describe("media", () => {
      it("inserts with defaults and updates", async () => {
        const adapter = await fresh();
        const { conversation } = await seedConversation(adapter, { tenantId: makeTenantId() });
        const message = await adapter.messages.insertInbound(
          makeInbound(conversation, { type: "document", content: { id: "doc-1" } }),
        );
        if (!message) throw new Error("expected a message");

        const media = await adapter.media.insert({
          tenantId: conversation.tenantId,
          messageId: message.id,
          metaMediaId: "doc-1",
        });
        expect(media).toMatchObject({
          tenantId: conversation.tenantId,
          messageId: message.id,
          metaMediaId: "doc-1",
          mimeType: null,
          sizeBytes: null,
          sha256: null,
          storagePath: null,
          downloadStatus: "pending",
        });

        const updated = await adapter.media.update(media.id, {
          mimeType: "application/pdf",
          sizeBytes: 2048,
          sha256: "abc123",
          storagePath: "t/a/c/doc-1.pdf",
          downloadStatus: "done",
        });
        expect(updated).toEqual({
          ...media,
          mimeType: "application/pdf",
          sizeBytes: 2048,
          sha256: "abc123",
          storagePath: "t/a/c/doc-1.pdf",
          downloadStatus: "done",
        });
        expect((await adapter.messages.get(message.id))?.media).toEqual(updated);

        const failed = await adapter.media.update(media.id, { downloadStatus: "failed" });
        expect(failed).toMatchObject({ downloadStatus: "failed", mimeType: "application/pdf" });
      });

      it("throws RecordNotFoundError for unknown media", async () => {
        const adapter = await fresh();
        const id = crypto.randomUUID();
        await expect(adapter.media.update(id, { downloadStatus: "done" })).rejects.toMatchObject({
          ...NOT_FOUND,
          entity: "media",
          id,
        });
      });
    });

    describe("templates", () => {
      it("upserts by (account, name, language) and keeps the id", async () => {
        const adapter = await fresh();
        const account = await seedAccount(adapter);
        const syncedAt = new Date("2026-05-01T00:00:00.000Z");
        const es = makeTemplateInput({ name: "recordatorio", language: "es", syncedAt });
        const en = makeTemplateInput({ name: "recordatorio", language: "en_US", syncedAt });

        const [createdEs, createdEn] = await adapter.templates.upsertMany(account.id, [es, en]);
        expect(createdEs).toMatchObject({
          accountId: account.id,
          name: "recordatorio",
          language: "es",
          category: "UTILITY",
          status: "APPROVED",
          components: es.components,
          variableCount: 1,
          active: true,
          syncedAt,
        });
        expect(createdEn?.id).not.toBe(createdEs?.id);

        const [updated] = await adapter.templates.upsertMany(account.id, [
          { ...es, status: "PAUSED", variableCount: 2 },
        ]);
        expect(updated?.id).toBe(createdEs?.id);
        expect(updated).toMatchObject({ status: "PAUSED", variableCount: 2 });

        expect(await adapter.templates.get(account.id, "recordatorio", "es")).toEqual(updated);
        expect(await adapter.templates.get(account.id, "recordatorio", "en_US")).toEqual(createdEn);
        expect(await adapter.templates.get(account.id, "recordatorio", "fr")).toBeNull();
        expect(await adapter.templates.list({ accountId: account.id })).toHaveLength(2);
      });

      it("keeps the same template name separate per account", async () => {
        const adapter = await fresh();
        const a = await seedAccount(adapter);
        const b = await seedAccount(adapter);
        const input = makeTemplateInput({ name: "bienvenida" });
        const [onA] = await adapter.templates.upsertMany(a.id, [input]);
        const [onB] = await adapter.templates.upsertMany(b.id, [{ ...input, status: "PENDING" }]);

        expect(onA?.id).not.toBe(onB?.id);
        expect((await adapter.templates.get(a.id, "bienvenida", "es"))?.status).toBe("APPROVED");
        expect((await adapter.templates.get(b.id, "bienvenida", "es"))?.status).toBe("PENDING");
      });

      it("markInactiveExcept deactivates missing templates and upsert reactivates", async () => {
        const adapter = await fresh();
        const account = await seedAccount(adapter);
        const other = await seedAccount(adapter);
        const keep = makeTemplateInput();
        const dropA = makeTemplateInput();
        const dropB = makeTemplateInput({ language: "en" });
        await adapter.templates.upsertMany(account.id, [keep, dropA, dropB]);
        const [foreign] = await adapter.templates.upsertMany(other.id, [makeTemplateInput()]);

        const changed = await adapter.templates.markInactiveExcept(account.id, [
          { name: keep.name, language: keep.language },
          { name: dropB.name, language: "es" },
        ]);
        expect(changed).toBe(2);
        expect(
          await adapter.templates.markInactiveExcept(account.id, [
            { name: keep.name, language: keep.language },
          ]),
        ).toBe(0);

        expect((await adapter.templates.get(account.id, keep.name, "es"))?.active).toBe(true);
        expect((await adapter.templates.get(account.id, dropA.name, "es"))?.active).toBe(false);
        expect((await adapter.templates.get(account.id, dropB.name, "en"))?.active).toBe(false);
        expect((await adapter.templates.get(other.id, foreign?.name ?? "", "es"))?.active).toBe(
          true,
        );

        const [revived] = await adapter.templates.upsertMany(account.id, [dropA]);
        expect(revived?.active).toBe(true);
      });

      it("lists with account, status and active filters", async () => {
        const adapter = await fresh();
        const account = await seedAccount(adapter);
        const other = await seedAccount(adapter);
        const approved = makeTemplateInput();
        const rejected = makeTemplateInput({ status: "REJECTED" });
        const gone = makeTemplateInput();
        await adapter.templates.upsertMany(account.id, [approved, rejected, gone]);
        await adapter.templates.upsertMany(other.id, [makeTemplateInput()]);
        await adapter.templates.markInactiveExcept(account.id, [
          { name: approved.name, language: "es" },
          { name: rejected.name, language: "es" },
        ]);

        const names = async (query: Parameters<WhatsAppAdapter["templates"]["list"]>[0]) =>
          (await adapter.templates.list(query)).map((t) => t.name).sort();

        expect(await names({ accountId: account.id })).toEqual(
          [approved.name, rejected.name, gone.name].sort(),
        );
        expect(await names({ accountId: account.id, status: "REJECTED" })).toEqual([rejected.name]);
        expect(await names({ accountId: account.id, active: true })).toEqual(
          [approved.name, rejected.name].sort(),
        );
        expect(await names({ accountId: account.id, active: false })).toEqual([gone.name]);
        expect((await adapter.templates.list()).length).toBeGreaterThanOrEqual(4);
      });
    });

    describe("events", () => {
      it("inserts as received and sets status", async () => {
        const adapter = await fresh();
        const payload = { object: "whatsapp_business_account", entry: [{ id: uid() }] };
        const event = await adapter.events.insert({ payload });
        expect(event).toMatchObject({
          payload,
          status: "received",
          error: null,
          processedAt: null,
        });
        expect(event.receivedAt).toBeInstanceOf(Date);
        expect(await adapter.events.get(event.id)).toEqual(event);

        const failed = await adapter.events.setStatus(event.id, "failed", "boom");
        expect(failed).toMatchObject({ status: "failed", error: "boom" });
        expect(failed.processedAt).toBeInstanceOf(Date);

        const processed = await adapter.events.setStatus(event.id, "processed");
        expect(processed).toMatchObject({ status: "processed", error: null });
        expect(processed.processedAt).toBeInstanceOf(Date);

        const unrouted = await adapter.events.setStatus(event.id, "unrouted", null);
        expect(unrouted.status).toBe("unrouted");
        expect(await adapter.events.get(event.id)).toEqual(unrouted);
      });

      it("returns null or throws RecordNotFoundError for unknown events", async () => {
        const adapter = await fresh();
        const id = crypto.randomUUID();
        expect(await adapter.events.get(id)).toBeNull();
        await expect(adapter.events.setStatus(id, "processed")).rejects.toMatchObject({
          ...NOT_FOUND,
          entity: "event",
          id,
        });
      });

      it("prune deletes events received before the cutoff and returns the count", async () => {
        const adapter = await fresh();
        const a = await adapter.events.insert({ payload: { n: 1 } });
        const b = await adapter.events.insert({ payload: { n: 2 } });

        expect(await adapter.events.prune(new Date(a.receivedAt.getTime() - HOUR_MS))).toBe(0);
        expect(await adapter.events.get(a.id)).not.toBeNull();

        const pruned = await adapter.events.prune(new Date(b.receivedAt.getTime() + HOUR_MS));
        expect(pruned).toBeGreaterThanOrEqual(2);
        expect(await adapter.events.get(a.id)).toBeNull();
        expect(await adapter.events.get(b.id)).toBeNull();
      });
    });

    describe("locks", () => {
      it("acquires a free key and rejects a held one", async () => {
        const adapter = await fresh();
        const key = `lock:${uid()}`;
        expect(await adapter.locks.acquire(key, 60_000)).toBe(true);
        expect(await adapter.locks.acquire(key, 60_000)).toBe(false);
        expect(await adapter.locks.acquire(`lock:${uid()}`, 60_000)).toBe(true);
      });

      it("lets only one of several concurrent acquires win", async () => {
        const adapter = await fresh();
        const key = `lock:${uid()}`;
        const results = await Promise.all(
          Array.from({ length: 5 }, () => adapter.locks.acquire(key, 60_000)),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
      });

      it("frees the key on release", async () => {
        const adapter = await fresh();
        const key = `lock:${uid()}`;
        await adapter.locks.acquire(key, 60_000);
        await adapter.locks.release(key);
        expect(await adapter.locks.acquire(key, 60_000)).toBe(true);
        await adapter.locks.release(`lock:${uid()}`);
      });

      it("lets an expired lock be taken", async () => {
        const adapter = await fresh();
        const key = `lock:${uid()}`;
        expect(await adapter.locks.acquire(key, 100)).toBe(true);
        expect(await adapter.locks.acquire(key, 100)).toBe(false);
        await sleep(250);
        expect(await adapter.locks.acquire(key, 60_000)).toBe(true);
        expect(await adapter.locks.acquire(key, 60_000)).toBe(false);
      });
    });

    describe("storage", () => {
      it("puts and gets bytes, and returns null for missing paths", async () => {
        const adapter = await fresh();
        const path = `_/${uid()}/media/${uid()}.jpg`;
        const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
        await adapter.storage.put(path, bytes, "image/jpeg");

        const read = await adapter.storage.get(path);
        expect(read).not.toBeNull();
        expect(Array.from(read ?? [])).toEqual(Array.from(bytes));
        expect(await adapter.storage.get(`_/${uid()}/missing.jpg`)).toBeNull();
      }, 20_000);

      it("returns a signed URL and reports the bucket", async () => {
        const adapter = await fresh();
        const path = `_/${uid()}/doc.pdf`;
        await adapter.storage.put(path, new Uint8Array([37, 80, 68, 70]), "application/pdf");
        const url = await adapter.storage.signedUrl(path, 300);
        expect(typeof url).toBe("string");
        expect(() => new URL(url)).not.toThrow();
        expect(url).toContain("doc.pdf");
        expect(await adapter.storage.bucketExists()).toBe(true);
      }, 20_000);
    });

    describe("schema", () => {
      it("reports the schema version and a healthy schema", async () => {
        const adapter = await fresh();
        expect(await adapter.schemaVersion()).toBe(WA_SCHEMA_VERSION);
        expect(await adapter.healthCheck()).toEqual({ tablesOk: true, missing: [] });
      });
    });
  });
}
