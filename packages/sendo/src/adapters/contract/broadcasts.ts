import { describe, expect, it } from "vitest";
import type { Account, Contact } from "../../types/entities";
import type { BroadcastInsertInput, SendoAdapter } from "../types";
import {
  type Fresh,
  NOT_FOUND,
  makeError,
  makeOutbound,
  makeTenantId,
  seedAccount,
  seedContact,
  seedConversation,
  tick,
  violates,
} from "./helpers";

const ZERO_COUNTS = {
  pending: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
};

function broadcastInput(
  account: Account,
  overrides: Partial<BroadcastInsertInput> = {},
): BroadcastInsertInput {
  return {
    tenantId: account.tenantId,
    accountId: account.id,
    templateName: "cobro_noviembre",
    language: "es",
    category: "UTILITY",
    ...overrides,
  };
}

async function seedContacts(adapter: SendoAdapter, account: Account, n: number) {
  const contacts: Contact[] = [];
  for (let i = 0; i < n; i++) contacts.push(await seedContact(adapter, account));
  return contacts;
}

/** Contract for `broadcasts`. */
export function broadcastsContract(fresh: Fresh): void {
  describe("broadcasts", () => {
    it("inserts with defaults, gets and updates", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter, { tenantId: makeTenantId() });
      const broadcast = await adapter.broadcasts.insert(
        broadcastInput(account, { variables: { "1": "Ana" }, createdBy: "user-admin" }),
      );
      expect(broadcast).toMatchObject({
        tenantId: account.tenantId,
        accountId: account.id,
        templateName: "cobro_noviembre",
        language: "es",
        category: "UTILITY",
        variables: { "1": "Ana" },
        ratePerMinute: 60,
        status: "queued",
        pauseReason: null,
        createdBy: "user-admin",
        startedAt: null,
        finishedAt: null,
      });
      expect(broadcast.createdAt).toBeInstanceOf(Date);
      expect(await adapter.broadcasts.get(broadcast.id)).toEqual(broadcast);
      expect(await adapter.broadcasts.get(crypto.randomUUID())).toBeNull();

      const startedAt = new Date("2026-11-01T15:00:00.000Z");
      const paused = await adapter.broadcasts.update(broadcast.id, {
        status: "paused",
        pauseReason: "billing",
        startedAt,
        ratePerMinute: 30,
      });
      expect(paused).toMatchObject({
        status: "paused",
        pauseReason: "billing",
        ratePerMinute: 30,
        startedAt,
        variables: { "1": "Ana" },
      });
      const resumed = await adapter.broadcasts.update(broadcast.id, {
        status: "sending",
        pauseReason: null,
      });
      expect(resumed).toMatchObject({ status: "sending", pauseReason: null, startedAt });
      expect(await adapter.broadcasts.get(broadcast.id)).toEqual(resumed);
      expect(await adapter.broadcasts.update(broadcast.id, {})).toEqual(resumed);
    });

    it("rejects unknown ids, accounts and invalid values", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter);
      const missing = crypto.randomUUID();
      await expect(adapter.broadcasts.update(missing, { status: "done" })).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "broadcast",
        id: missing,
      });
      await expect(
        adapter.broadcasts.insert(broadcastInput(account, { accountId: missing })),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "account" });
      await expect(
        adapter.broadcasts.insert(broadcastInput(account, { ratePerMinute: 0 })),
      ).rejects.toMatchObject(violates("sendo_broadcasts_rate_per_minute_check"));
      const broadcast = await adapter.broadcasts.insert(broadcastInput(account));
      await expect(
        adapter.broadcasts.update(broadcast.id, { status: "nope" as "done" }),
      ).rejects.toMatchObject(violates("sendo_broadcasts_status_check"));
      await expect(
        adapter.broadcasts.insertRecipients(missing, [{ contactId: crypto.randomUUID() }]),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "broadcast" });
      const unknownContact = crypto.randomUUID();
      await expect(
        adapter.broadcasts.insertRecipients(broadcast.id, [{ contactId: unknownContact }]),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "contact", id: unknownContact });
      await expect(
        adapter.broadcasts.updateRecipient(missing, { status: "sent" }),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "broadcast_recipient" });
    });

    it("lists a tenant's broadcasts newest first, filtered and paged", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const other = await seedAccount(adapter, { tenantId });
      const elsewhere = await seedAccount(adapter, { tenantId: makeTenantId() });
      const a = await adapter.broadcasts.insert(broadcastInput(account));
      await tick();
      const b = await adapter.broadcasts.insert(broadcastInput(other, { status: "sending" }));
      await tick();
      const c = await adapter.broadcasts.insert(broadcastInput(account, { status: "done" }));
      await adapter.broadcasts.insert(broadcastInput(elsewhere));

      const all = await adapter.broadcasts.list({ tenantId, limit: 10 });
      expect(all.items.map((x) => x.id)).toEqual([c.id, b.id, a.id]);
      expect(all.nextCursor).toBeNull();

      const first = await adapter.broadcasts.list({ tenantId, limit: 2 });
      expect(first.items.map((x) => x.id)).toEqual([c.id, b.id]);
      expect(first.nextCursor).not.toBeNull();
      const second = await adapter.broadcasts.list({
        tenantId,
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second).toEqual({ items: [a], nextCursor: null });

      const byAccount = await adapter.broadcasts.list({
        tenantId,
        accountId: account.id,
        limit: 10,
      });
      expect(byAccount.items.map((x) => x.id)).toEqual([c.id, a.id]);
      const active = await adapter.broadcasts.list({
        tenantId,
        status: ["queued", "sending"],
        limit: 10,
      });
      expect(active.items.map((x) => x.id)).toEqual([b.id, a.id]);
    });

    it("inserts recipients once per contact and counts them by status", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter, { tenantId: makeTenantId() });
      const [ana, beto, carla] = await seedContacts(adapter, account, 3);
      if (!ana || !beto || !carla) throw new Error("contacts not seeded");
      const broadcast = await adapter.broadcasts.insert(broadcastInput(account));
      expect(await adapter.broadcasts.counts(broadcast.id)).toEqual(ZERO_COUNTS);

      const inserted = await adapter.broadcasts.insertRecipients(broadcast.id, [
        { contactId: ana.id, variables: { "1": "Ana" } },
        { contactId: beto.id },
        { contactId: beto.id },
        { contactId: carla.id, status: "skipped", skipReason: "no_opt_in" },
      ]);
      expect(inserted).toBe(3);
      expect(
        await adapter.broadcasts.insertRecipients(broadcast.id, [
          { contactId: ana.id },
          { contactId: carla.id },
        ]),
      ).toBe(0);
      expect(await adapter.broadcasts.insertRecipients(broadcast.id, [])).toBe(0);
      expect(await adapter.broadcasts.counts(broadcast.id)).toEqual({
        ...ZERO_COUNTS,
        pending: 2,
        skipped: 1,
      });

      const pending = await adapter.broadcasts.nextPending(broadcast.id, 10);
      expect(pending.map((r) => r.contactId).sort()).toEqual([ana.id, beto.id].sort());
      expect(pending.find((r) => r.contactId === ana.id)).toMatchObject({
        tenantId: account.tenantId,
        broadcastId: broadcast.id,
        variables: { "1": "Ana" },
        messageId: null,
        status: "pending",
        skipReason: null,
        error: null,
      });
      expect(await adapter.broadcasts.nextPending(broadcast.id, 1)).toHaveLength(1);
      expect(await adapter.broadcasts.nextPending(broadcast.id, 0)).toEqual([]);
    });

    it("pages a broadcast's recipients in a stable order, filtered by status", async () => {
      const adapter = await fresh();
      const account = await seedAccount(adapter, { tenantId: makeTenantId() });
      const contacts = await seedContacts(adapter, account, 5);
      const broadcast = await adapter.broadcasts.insert(broadcastInput(account));
      const other = await adapter.broadcasts.insert(broadcastInput(account));
      await adapter.broadcasts.insertRecipients(
        broadcast.id,
        contacts.map((c, i) =>
          i === 4
            ? { contactId: c.id, status: "skipped" as const, skipReason: "no_opt_in" }
            : { contactId: c.id },
        ),
      );
      await adapter.broadcasts.insertRecipients(other.id, [{ contactId: contacts[0]?.id ?? "" }]);

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let pages = 0; pages < 5; pages++) {
        const page = await adapter.broadcasts.listRecipients({
          broadcastId: broadcast.id,
          cursor,
          limit: 2,
        });
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((r) => r.contactId));
        cursor = page.nextCursor;
        if (cursor === null) break;
      }
      expect(seen.sort()).toEqual(contacts.map((c) => c.id).sort());

      const skipped = await adapter.broadcasts.listRecipients({
        broadcastId: broadcast.id,
        status: ["skipped", "failed"],
        limit: 10,
      });
      expect(skipped.items).toHaveLength(1);
      expect(skipped.items[0]).toMatchObject({
        contactId: contacts[4]?.id,
        skipReason: "no_opt_in",
      });
      expect(skipped.nextCursor).toBeNull();
      expect(
        await adapter.broadcasts.listRecipients({ broadcastId: crypto.randomUUID(), limit: 10 }),
      ).toEqual({ items: [], nextCursor: null });
    });

    it("updates recipients, finds them by message and cancels the pending ones", async () => {
      const adapter = await fresh();
      const { account, contact, conversation } = await seedConversation(adapter, {
        tenantId: makeTenantId(),
      });
      const [beto, carla] = await seedContacts(adapter, account, 2);
      if (!beto || !carla) throw new Error("contacts not seeded");
      const broadcast = await adapter.broadcasts.insert(broadcastInput(account));
      await adapter.broadcasts.insertRecipients(broadcast.id, [
        { contactId: contact.id },
        { contactId: beto.id },
        { contactId: carla.id },
      ]);
      const [first] = await adapter.broadcasts.nextPending(broadcast.id, 1);
      if (!first) throw new Error("no pending recipient");
      const message = await adapter.messages.insertOutbound(
        makeOutbound(conversation, {
          type: "template",
          content: { name: "cobro_noviembre" },
          metadata: { broadcastId: broadcast.id },
        }),
      );
      expect(await adapter.broadcasts.recipientByMessageId(message.id)).toBeNull();

      await tick();
      const sent = await adapter.broadcasts.updateRecipient(first.id, {
        status: "sent",
        messageId: message.id,
      });
      expect(sent).toMatchObject({ id: first.id, status: "sent", messageId: message.id });
      expect(sent.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
      expect(await adapter.broadcasts.recipientByMessageId(message.id)).toEqual(sent);

      const failed = await adapter.broadcasts.updateRecipient(first.id, {
        status: "failed",
        error: makeError({ code: 131026 }),
      });
      expect(failed).toMatchObject({
        status: "failed",
        messageId: message.id,
        error: { code: 131026 },
      });
      await expect(
        adapter.broadcasts.updateRecipient(first.id, { messageId: crypto.randomUUID() }),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "message" });

      expect(await adapter.broadcasts.cancelPending(broadcast.id)).toBe(2);
      expect(await adapter.broadcasts.cancelPending(broadcast.id)).toBe(0);
      expect(await adapter.broadcasts.nextPending(broadcast.id, 10)).toEqual([]);
      expect(await adapter.broadcasts.counts(broadcast.id)).toEqual({
        ...ZERO_COUNTS,
        failed: 1,
        cancelled: 2,
      });
    });

    it("are deleted with their account on purge", async () => {
      const adapter = await fresh();
      const { account, contact, conversation } = await seedConversation(adapter, {
        tenantId: makeTenantId(),
      });
      const broadcast = await adapter.broadcasts.insert(broadcastInput(account));
      await adapter.broadcasts.insertRecipients(broadcast.id, [{ contactId: contact.id }]);
      const [recipient] = await adapter.broadcasts.nextPending(broadcast.id, 1);
      const message = await adapter.messages.insertOutbound(makeOutbound(conversation));
      if (!recipient) throw new Error("no recipient");
      await adapter.broadcasts.updateRecipient(recipient.id, {
        status: "sent",
        messageId: message.id,
      });

      await adapter.accounts.update(account.id, { active: false });
      await adapter.accounts.purge(account.id);
      expect(await adapter.broadcasts.get(broadcast.id)).toBeNull();
      expect(await adapter.broadcasts.recipientByMessageId(message.id)).toBeNull();
      expect(await adapter.broadcasts.counts(broadcast.id)).toEqual(ZERO_COUNTS);
    });
  });

  describe("messages.pendingDraftConversations", () => {
    it("returns the requested conversations that have a pending draft", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const withDraft = await seedConversation(adapter, { account });
      const approved = await seedConversation(adapter, { account });
      const plain = await seedConversation(adapter, { account });
      const other = await seedConversation(adapter, { account });
      await adapter.messages.insertOutbound(makeOutbound(withDraft.conversation, { draft: true }));
      await adapter.messages.insertOutbound(makeOutbound(withDraft.conversation, { draft: true }));
      const draft = await adapter.messages.insertOutbound(
        makeOutbound(approved.conversation, { draft: true }),
      );
      await adapter.messages.update(draft.id, { draft: false });
      await adapter.messages.insertOutbound(makeOutbound(plain.conversation));
      await adapter.messages.insertOutbound(makeOutbound(other.conversation, { draft: true }));

      const ids = [withDraft, approved, plain].map((s) => s.conversation.id);
      expect(await adapter.messages.pendingDraftConversations([...ids, "not-a-uuid"])).toEqual([
        withDraft.conversation.id,
      ]);
      expect(await adapter.messages.pendingDraftConversations([])).toEqual([]);
    });
  });
}
