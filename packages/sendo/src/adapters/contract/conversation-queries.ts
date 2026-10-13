import { describe, expect, it } from "vitest";
import type { Account, Conversation } from "../../types/entities";
import type {
  ConversationFilter,
  ConversationPatch,
  EscalationCandidatesQuery,
  SendoAdapter,
} from "../types";
import { type Fresh, HOUR_MS, makeTenantId, seedAccount, seedContact } from "./helpers";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface Seeded {
  conversation: Conversation;
  name: string;
}

/** A conversation on `account` with its contact and `patch` applied. */
async function seed(
  adapter: SendoAdapter,
  account: Account,
  name: string,
  patch: ConversationPatch = {},
  contact: { phone?: string; appRef?: string } = {},
): Promise<Seeded> {
  const created = await seedContact(adapter, account, contact.phone);
  await adapter.contacts.upsert({
    accountId: account.id,
    tenantId: account.tenantId,
    phone: created.phone,
    profileName: name,
  });
  if (contact.appRef) await adapter.contacts.setAppRef(created.id, contact.appRef);
  const { conversation } = await adapter.conversations.getOpenOrCreate({
    contactId: created.id,
    accountId: account.id,
    tenantId: account.tenantId,
  });
  return { conversation: await adapter.conversations.update(conversation.id, patch), name };
}

/** Contract for the team-inbox and tick queries on `conversations`. */
export function conversationQueriesContract(fresh: Fresh): void {
  describe("conversation queries", () => {
    /** Names matched by `filter` through `list` (newest activity first), checked against `count`. */
    const names = async (
      adapter: SendoAdapter,
      filter: ConversationFilter,
      seeded: Seeded[],
    ): Promise<string[]> => {
      const page = await adapter.conversations.list({ ...filter, limit: 50 });
      expect(await adapter.conversations.count(filter)).toBe(page.items.length);
      const byId = new Map(seeded.map((s) => [s.conversation.id, s.name]));
      return page.items.map((c) => byId.get(c.id) ?? `unknown:${c.id}`);
    };
    const at = (day: number): Date => new Date(Date.UTC(2026, 4, day, 12));

    it("filters by tags (any match), queue and status together", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const vip = await adapter.tags.upsert({ tenantId, name: "VIP", color: "violet" });
      const pago = await adapter.tags.upsert({ tenantId, name: "Pago", color: "green" });
      const unused = await adapter.tags.upsert({ tenantId, name: "Sin uso", color: "gray" });

      const ana = await seed(adapter, account, "ana", { lastActivityAt: at(5), queue: "cobranza" });
      const beto = await seed(adapter, account, "beto", {
        lastActivityAt: at(4),
        status: "human",
      });
      const carla = await seed(adapter, account, "carla", {
        lastActivityAt: at(3),
        queue: "cobranza",
        status: "human",
      });
      const dani = await seed(adapter, account, "dani", { lastActivityAt: at(2) });
      const all = [ana, beto, carla, dani];
      await adapter.tags.addToConversation(ana.conversation.id, vip.id);
      await adapter.tags.addToConversation(ana.conversation.id, pago.id);
      await adapter.tags.addToConversation(beto.conversation.id, pago.id);
      await adapter.tags.addToConversation(carla.conversation.id, vip.id);

      expect(await names(adapter, { tenantId, tagIds: [vip.id, pago.id] }, all)).toEqual([
        "ana",
        "beto",
        "carla",
      ]);
      expect(await names(adapter, { tenantId, tagIds: [pago.id] }, all)).toEqual(["ana", "beto"]);
      expect(await names(adapter, { tenantId, tagIds: [unused.id] }, all)).toEqual([]);
      expect(await names(adapter, { tenantId, tagIds: [] }, all)).toEqual([
        "ana",
        "beto",
        "carla",
        "dani",
      ]);
      expect(await names(adapter, { tenantId, queue: "cobranza" }, all)).toEqual(["ana", "carla"]);
      expect(await names(adapter, { tenantId, queue: null }, all)).toEqual(["beto", "dani"]);
      expect(
        await names(
          adapter,
          { tenantId, tagIds: [vip.id], status: "human", queue: "cobranza" },
          all,
        ),
      ).toEqual(["carla"]);

      const page = await adapter.conversations.list({
        tenantId,
        tagIds: [vip.id, pago.id],
        limit: 5,
      });
      expect(page.items[0]).toMatchObject({
        id: ana.conversation.id,
        contact: { profileName: "ana" },
      });
    });

    it("excludeAccountIds leaves out those accounts' conversations, with the other filters", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const active = await seedAccount(adapter, { tenantId });
      const gone = await seedAccount(adapter, { tenantId });
      const alsoGone = await seedAccount(adapter, { tenantId });
      const all = [
        await seed(adapter, active, "ana", { lastActivityAt: at(5) }),
        await seed(adapter, gone, "beto", { lastActivityAt: at(4), status: "human" }),
        await seed(adapter, alsoGone, "carla", { lastActivityAt: at(3) }),
        await seed(adapter, active, "dani", { lastActivityAt: at(2), status: "human" }),
      ];

      expect(await names(adapter, { tenantId, excludeAccountIds: [gone.id] }, all)).toEqual([
        "ana",
        "carla",
        "dani",
      ]);
      expect(
        await names(adapter, { tenantId, excludeAccountIds: [gone.id, alsoGone.id] }, all),
      ).toEqual(["ana", "dani"]);
      expect(
        await names(adapter, { tenantId, status: "human", excludeAccountIds: [gone.id] }, all),
      ).toEqual(["dani"]);
      expect(await names(adapter, { tenantId, excludeAccountIds: [] }, all)).toEqual([
        "ana",
        "beto",
        "carla",
        "dani",
      ]);
      expect(
        await names(adapter, { tenantId, search: "beto", excludeAccountIds: [alsoGone.id] }, all),
      ).toEqual(["beto"]);
    });

    it("visibleTo mirrors canSeeConversation and pages with a cursor", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const all = [
        await seed(adapter, account, "mine", { lastActivityAt: at(9), assignedTo: "ana" }),
        await seed(adapter, account, "mine-other-queue", {
          lastActivityAt: at(8),
          assignedTo: "ana",
          queue: "ventas",
        }),
        await seed(adapter, account, "theirs", { lastActivityAt: at(7), assignedTo: "luis" }),
        await seed(adapter, account, "general", { lastActivityAt: at(6) }),
        await seed(adapter, account, "my-queue", { lastActivityAt: at(5), queue: "cobranza" }),
        await seed(adapter, account, "quoted-queue", {
          lastActivityAt: at(4),
          queue: 'turno "B", tarde',
        }),
        await seed(adapter, account, "other-queue", { lastActivityAt: at(3), queue: "ventas" }),
        await seed(adapter, account, "closed-mine", {
          lastActivityAt: at(2),
          assignedTo: "ana",
          status: "closed",
        }),
      ];
      const visibleTo = { userId: "ana", queues: ["cobranza", 'turno "B", tarde'] };

      expect(await names(adapter, { tenantId, visibleTo }, all)).toEqual([
        "mine",
        "mine-other-queue",
        "general",
        "my-queue",
        "quoted-queue",
        "closed-mine",
      ]);
      expect(
        await names(adapter, { tenantId, visibleTo: { userId: "luis", queues: [] } }, all),
      ).toEqual(["theirs", "general"]);
      expect(
        await names(adapter, { tenantId, visibleTo, status: ["agent", "human"] }, all),
      ).toEqual(["mine", "mine-other-queue", "general", "my-queue", "quoted-queue"]);
      expect(await names(adapter, { tenantId: makeTenantId(), visibleTo }, all)).toEqual([]);

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 4; i++) {
        const page = await adapter.conversations.list({ tenantId, visibleTo, limit: 2, cursor });
        seen.push(...page.items.map((c) => c.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(
        ["mine", "mine-other-queue", "general", "my-queue", "quoted-queue", "closed-mine"].map(
          (n) => all.find((s) => s.name === n)?.conversation.id,
        ),
      );
    });

    it("search matches name, app ref and phone, case-insensitively and literally", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const all = [
        await seed(
          adapter,
          account,
          "Ana López",
          { lastActivityAt: at(5) },
          { phone: "+50255501234", appRef: "PAC-0042" },
        ),
        await seed(
          adapter,
          account,
          "Beto 100%",
          { lastActivityAt: at(4) },
          { phone: "+50255509999", appRef: "pac_7" },
        ),
        await seed(
          adapter,
          account,
          'Carla "La Jefa", (admin)',
          { lastActivityAt: at(3) },
          { phone: "+50244401234" },
        ),
      ];

      expect(await names(adapter, { tenantId, search: "  ana  " }, all)).toEqual(["Ana López"]);
      expect(await names(adapter, { tenantId, search: "LÓPEZ" }, all)).toEqual(["Ana López"]);
      expect(await names(adapter, { tenantId, search: "pac-00" }, all)).toEqual(["Ana López"]);
      expect(await names(adapter, { tenantId, search: "5550 1234" }, all)).toEqual(["Ana López"]);
      expect(await names(adapter, { tenantId, search: "01234" }, all)).toEqual([
        "Ana López",
        'Carla "La Jefa", (admin)',
      ]);
      expect(await names(adapter, { tenantId, search: "100%" }, all)).toEqual(["Beto 100%"]);
      expect(await names(adapter, { tenantId, search: "0%" }, all)).toEqual(["Beto 100%"]);
      expect(await names(adapter, { tenantId, search: "pac_" }, all)).toEqual(["Beto 100%"]);
      expect(await names(adapter, { tenantId, search: '"la jefa", (' }, all)).toEqual([
        'Carla "La Jefa", (admin)',
      ]);
      expect(await names(adapter, { tenantId, search: "nadie" }, all)).toEqual([]);
      expect(await names(adapter, { tenantId, search: "   " }, all)).toHaveLength(3);

      const vip = await adapter.tags.upsert({ tenantId, name: "VIP", color: "violet" });
      const carla = all[2];
      if (!carla) throw new Error("seed missing");
      await adapter.tags.addToConversation(carla.conversation.id, vip.id);
      expect(
        await names(adapter, { tenantId, search: "1234", tagIds: [vip.id], status: "agent" }, all),
      ).toEqual(['Carla "La Jefa", (admin)']);
    });

    it("countBySource groups by source for the tenant, account and creation range", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const accountA = await seedAccount(adapter, { tenantId });
      const accountB = await seedAccount(adapter, { tenantId });
      const start = new Date(Date.now() - MINUTE_MS);
      await seed(adapter, accountA, "a1", { source: "garita" });
      await seed(adapter, accountA, "a2", { source: "garita" });
      await seed(adapter, accountA, "a3", { source: "ad:123" });
      await seed(adapter, accountA, "a4");
      await seed(adapter, accountB, "b1", { source: "ad:123" });
      await seed(adapter, accountB, "b2", { source: "ad:123" });
      await seed(adapter, accountB, "b3", { source: "web" });
      const other = await seedAccount(adapter, { tenantId: makeTenantId() });
      await seed(adapter, other, "x1", { source: "garita" });
      const end = new Date(Date.now() + MINUTE_MS);

      expect(await adapter.conversations.countBySource({ tenantId })).toEqual([
        { source: "ad:123", conversations: 3 },
        { source: "garita", conversations: 2 },
        { source: "web", conversations: 1 },
        { source: null, conversations: 1 },
      ]);
      expect(
        await adapter.conversations.countBySource({
          tenantId,
          accountId: accountA.id,
          from: start,
          to: end,
        }),
      ).toEqual([
        { source: "garita", conversations: 2 },
        { source: "ad:123", conversations: 1 },
        { source: null, conversations: 1 },
      ]);
      expect(await adapter.conversations.countBySource({ tenantId, from: end })).toEqual([]);
      expect(await adapter.conversations.countBySource({ tenantId, to: start })).toEqual([]);
    });

    it("countByAssignee counts open conversations per user by default", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      await seed(adapter, account, "1", { assignedTo: "ana", status: "human" });
      await seed(adapter, account, "2", { assignedTo: "ana" });
      await seed(adapter, account, "3", { assignedTo: "ana", status: "closed" });
      await seed(adapter, account, "4", { assignedTo: "luis", status: "human" });
      await seed(adapter, account, "5", { status: "human" });
      const other = await seedAccount(adapter, { tenantId: makeTenantId() });
      await seed(adapter, other, "6", { assignedTo: "ana", status: "human" });

      expect(
        await adapter.conversations.countByAssignee({
          tenantId,
          assignees: ["ana", "luis", "eva"],
        }),
      ).toEqual({ ana: 2, luis: 1, eva: 0 });
      expect(
        await adapter.conversations.countByAssignee({
          tenantId,
          assignees: ["ana", "luis"],
          status: "human",
        }),
      ).toEqual({ ana: 1, luis: 1 });
      expect(await adapter.conversations.countByAssignee({ tenantId, assignees: [] })).toEqual({});
    });

    it("findForTick escalate: waiting human conversations not escalated since, oldest first", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const accountA = await seedAccount(adapter, { tenantId });
      const accountB = await seedAccount(adapter, { tenantId });
      const now = Date.UTC(2026, 5, 1, 15);
      const ago = (minutes: number) => new Date(now - minutes * MINUTE_MS);
      const human = (minutes: number, patch: ConversationPatch = {}): ConversationPatch => ({
        status: "human",
        awaitingReplySince: ago(minutes),
        ...patch,
      });

      const all = [
        await seed(adapter, accountA, "waiting-40", human(40)),
        await seed(adapter, accountA, "waiting-20", human(20, { queue: "cobranza" })),
        await seed(adapter, accountB, "waiting-60-b", human(60)),
        await seed(adapter, accountA, "escalated-before-wait", human(30, { escalatedAt: ago(90) })),
        await seed(adapter, accountA, "already-escalated", human(50, { escalatedAt: ago(10) })),
        await seed(adapter, accountA, "recent", human(5)),
        await seed(adapter, accountA, "agent-status", { awaitingReplySince: ago(45) }),
        await seed(adapter, accountA, "answered", { status: "human" }),
        await seed(adapter, accountA, "closed", human(80, { status: "closed" })),
      ];
      const other = await seedAccount(adapter, { tenantId: makeTenantId() });
      await seed(adapter, other, "other-tenant", human(70));

      const find = async (
        query: Partial<Omit<EscalationCandidatesQuery, "type" | "tenantId">>,
      ): Promise<string[]> => {
        const rows = await adapter.conversations.findForTick({
          type: "escalate",
          tenantId,
          waitingSince: ago(15),
          limit: 10,
          ...query,
        });
        return rows.map((c) => all.find((s) => s.conversation.id === c.id)?.name ?? c.id);
      };

      expect(await find({})).toEqual([
        "waiting-60-b",
        "waiting-40",
        "escalated-before-wait",
        "waiting-20",
      ]);
      expect(await find({ accountId: accountA.id })).toEqual([
        "waiting-40",
        "escalated-before-wait",
        "waiting-20",
      ]);
      expect(await find({ queue: "cobranza" })).toEqual(["waiting-20"]);
      expect(await find({ queue: null, limit: 2 })).toEqual(["waiting-60-b", "waiting-40"]);
      expect(await find({ waitingSince: ago(45) })).toEqual(["waiting-60-b"]);
      expect(await find({ limit: 0 })).toEqual([]);

      const [first] = await adapter.conversations.findForTick({
        type: "escalate",
        tenantId,
        waitingSince: ago(15),
        limit: 1,
      });
      expect(first).toMatchObject({ status: "human", awaitingReplySince: ago(60) });
    });

    it("findForTick auto_close: open conversations inactive since before the cutoff", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const accountA = await seedAccount(adapter, { tenantId });
      const accountB = await seedAccount(adapter, { tenantId });
      const now = Date.UTC(2026, 5, 10, 12);
      const daysAgo = (days: number) => new Date(now - days * DAY_MS);
      const all = [
        await seed(adapter, accountA, "agent-10d", { lastActivityAt: daysAgo(10) }),
        await seed(adapter, accountB, "human-12d", {
          lastActivityAt: daysAgo(12),
          status: "human",
        }),
        await seed(adapter, accountA, "agent-8d", { lastActivityAt: daysAgo(8) }),
        await seed(adapter, accountA, "recent", { lastActivityAt: daysAgo(2) }),
        await seed(adapter, accountA, "closed", { lastActivityAt: daysAgo(30), status: "closed" }),
      ];
      const find = async (accountId?: string, limit = 10) =>
        (
          await adapter.conversations.findForTick({
            type: "auto_close",
            tenantId,
            accountId,
            inactiveSince: daysAgo(7),
            limit,
          })
        ).map((c) => all.find((s) => s.conversation.id === c.id)?.name ?? c.id);

      expect(await find()).toEqual(["human-12d", "agent-10d", "agent-8d"]);
      expect(await find(accountA.id)).toEqual(["agent-10d", "agent-8d"]);
      expect(await find(undefined, 1)).toEqual(["human-12d"]);
    });
  });
}
