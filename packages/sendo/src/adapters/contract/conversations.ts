import { describe, expect, it } from "vitest";
import type { Conversation } from "../../types/entities";
import type { SendoAdapter } from "../types";
import {
  type Fresh,
  NOT_FOUND,
  tick,
  makeTenantId,
  type Seed,
  seedAccount,
  seedContact,
  seedConversation,
  makeInbound,
  makeOutbound,
  makeMetaId,
} from "./helpers";

/** Contract for `conversations`. */
export function conversationsContract(fresh: Fresh): void {
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
        channel: "whatsapp",
        source: null,
        assignedAt: null,
        agentPaused: false,
        queue: null,
        everHuman: false,
        awaitingReplySince: null,
        escalatedAt: null,
        afterHoursNotifiedAt: null,
      });
      expect(result.conversation.lastActivityAt).toBeInstanceOf(Date);
      expect(result.conversation.createdAt).toBeInstanceOf(Date);
      expect(await adapter.conversations.get(result.conversation.id)).toEqual(result.conversation);
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
        assignedAt: new Date("2026-02-01T09:00:00.000Z"),
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
        assignedAt: null,
        handoffReason: null,
      });
    });

    it("updates the team and bookkeeping columns", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter);
      const patch = {
        source: "ig-bio",
        assignedAt: new Date("2026-02-01T10:00:00.000Z"),
        agentPaused: true,
        queue: "ventas",
        everHuman: true,
        awaitingReplySince: new Date("2026-02-01T09:58:00.000Z"),
        escalatedAt: new Date("2026-02-01T10:30:00.000Z"),
        afterHoursNotifiedAt: new Date("2026-02-01T23:00:00.000Z"),
      };
      expect(await adapter.conversations.update(conversation.id, patch)).toMatchObject(patch);
      expect(await adapter.conversations.get(conversation.id)).toMatchObject(patch);

      const cleared = await adapter.conversations.update(conversation.id, {
        source: null,
        assignedAt: null,
        agentPaused: false,
        queue: null,
        awaitingReplySince: null,
        escalatedAt: null,
        afterHoursNotifiedAt: null,
      });
      expect(cleared).toMatchObject({
        source: null,
        assignedAt: null,
        agentPaused: false,
        queue: null,
        everHuman: true,
        awaitingReplySince: null,
        escalatedAt: null,
        afterHoursNotifiedAt: null,
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
        adapter: SendoAdapter,
        seed: Seed,
        iso: string,
        patch: Parameters<SendoAdapter["conversations"]["update"]>[1] = {},
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
}
