import { describe, expect, it } from "vitest";
import type { TagColor } from "../../types/enums";
import type { TagUpsertInput } from "../types";
import {
  type Fresh,
  NOT_FOUND,
  makeTenantId,
  seedAccount,
  seedConversation,
  violates,
} from "./helpers";

/** Contract for `tags` (catalog and conversation tags). */
export function tagsContract(fresh: Fresh): void {
  describe("tags", () => {
    const base = (overrides: Partial<TagUpsertInput> = {}): TagUpsertInput => ({
      tenantId: makeTenantId(),
      name: "VIP",
      color: "violet",
      ...overrides,
    });

    it("inserts, reads, updates within the tenant and lists by name ignoring case", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const vip = await adapter.tags.upsert(base({ tenantId }));
      expect(vip).toMatchObject({ tenantId, name: "VIP", color: "violet" });
      expect(vip.createdAt).toBeInstanceOf(Date);
      expect(await adapter.tags.get(vip.id)).toEqual(vip);
      expect(await adapter.tags.get(crypto.randomUUID())).toBeNull();

      const cobranza = await adapter.tags.upsert(
        base({ tenantId, name: "cobranza", color: "red" }),
      );
      const agenda = await adapter.tags.upsert(base({ tenantId, name: "Agenda", color: "blue" }));
      await adapter.tags.upsert(base({ name: "Ajena" }));
      expect((await adapter.tags.list({ tenantId })).map((t) => t.id)).toEqual([
        agenda.id,
        cobranza.id,
        vip.id,
      ]);

      const renamed = await adapter.tags.upsert({
        id: vip.id,
        tenantId,
        name: "Cliente VIP",
        color: "amber",
      });
      expect(renamed).toEqual({ ...vip, name: "Cliente VIP", color: "amber" });
      expect(await adapter.tags.get(vip.id)).toEqual(renamed);

      await expect(
        adapter.tags.upsert({ ...base({ name: "Robada" }), id: vip.id }),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "tag", id: vip.id });
      expect((await adapter.tags.get(vip.id))?.name).toBe("Cliente VIP");
    });

    it("keeps names unique per tenant ignoring case", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const vip = await adapter.tags.upsert(base({ tenantId }));
      await expect(adapter.tags.upsert(base({ tenantId, name: "vip" }))).rejects.toMatchObject(
        violates("sendo_tags_name_key"),
      );
      await adapter.tags.upsert(base({ name: "vip" }));

      const other = await adapter.tags.upsert(base({ tenantId, name: "Nuevo" }));
      await expect(
        adapter.tags.upsert({ ...base({ tenantId, name: "Vip" }), id: other.id }),
      ).rejects.toMatchObject(violates("sendo_tags_name_key"));
      const recased = await adapter.tags.upsert({ ...base({ tenantId, name: "Vip" }), id: vip.id });
      expect(recased.name).toBe("Vip");
    });

    it("enforces the palette and a non-blank name", async () => {
      const adapter = await fresh();
      await expect(adapter.tags.upsert(base({ color: "black" as TagColor }))).rejects.toMatchObject(
        violates("sendo_tags_color_check"),
      );
      for (const name of ["", "   ", "x".repeat(65)]) {
        await expect(adapter.tags.upsert(base({ name }))).rejects.toMatchObject(
          violates("sendo_tags_name_check"),
        );
      }
    });

    it("adds and removes conversation tags idempotently, with usage and per-conversation lists", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const first = await seedConversation(adapter, { account });
      const second = await seedConversation(adapter, { account });
      const vip = await adapter.tags.upsert(base({ tenantId }));
      const agenda = await adapter.tags.upsert(base({ tenantId, name: "agenda", color: "blue" }));

      expect(
        await adapter.tags.addToConversation(first.conversation.id, vip.id, { by: "ana" }),
      ).toBe(true);
      expect(await adapter.tags.addToConversation(first.conversation.id, vip.id)).toBe(false);
      expect(await adapter.tags.addToConversation(first.conversation.id, agenda.id)).toBe(true);
      expect(await adapter.tags.addToConversation(second.conversation.id, vip.id)).toBe(true);

      expect(await adapter.tags.usage(vip.id)).toBe(2);
      expect(await adapter.tags.usage(agenda.id)).toBe(1);
      expect(await adapter.tags.usage(crypto.randomUUID())).toBe(0);

      const missing = crypto.randomUUID();
      const byConversation = await adapter.tags.forConversations([
        first.conversation.id,
        second.conversation.id,
        missing,
      ]);
      expect(byConversation).toEqual({
        [first.conversation.id]: [agenda, vip],
        [second.conversation.id]: [vip],
        [missing]: [],
      });
      expect(await adapter.tags.forConversations([])).toEqual({});

      expect(await adapter.tags.removeFromConversation(first.conversation.id, vip.id)).toBe(true);
      expect(await adapter.tags.removeFromConversation(first.conversation.id, vip.id)).toBe(false);
      expect(await adapter.tags.usage(vip.id)).toBe(1);
      expect(
        (await adapter.tags.forConversations([first.conversation.id]))[first.conversation.id],
      ).toEqual([agenda]);
    });

    it("refuses unknown conversations and tags of another tenant", async () => {
      const adapter = await fresh();
      const { conversation } = await seedConversation(adapter, { tenantId: makeTenantId() });
      const foreign = await adapter.tags.upsert(base());
      const unknownConversation = crypto.randomUUID();
      const unknownTag = crypto.randomUUID();

      await expect(
        adapter.tags.addToConversation(conversation.id, foreign.id),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "tag", id: foreign.id });
      await expect(
        adapter.tags.addToConversation(conversation.id, unknownTag),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "tag", id: unknownTag });
      const own = await adapter.tags.upsert(base({ tenantId: conversation.tenantId }));
      await expect(
        adapter.tags.addToConversation(unknownConversation, own.id),
      ).rejects.toMatchObject({ ...NOT_FOUND, entity: "conversation", id: unknownConversation });
      expect(await adapter.tags.usage(foreign.id)).toBe(0);
    });

    it("deleting a tag removes it from every conversation", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const a = await seedConversation(adapter, { account });
      const b = await seedConversation(adapter, { account });
      const vip = await adapter.tags.upsert(base({ tenantId }));
      const kept = await adapter.tags.upsert(base({ tenantId, name: "agenda" }));
      await adapter.tags.addToConversation(a.conversation.id, vip.id);
      await adapter.tags.addToConversation(b.conversation.id, vip.id);
      await adapter.tags.addToConversation(b.conversation.id, kept.id);

      await adapter.tags.delete(vip.id);
      expect(await adapter.tags.get(vip.id)).toBeNull();
      expect(await adapter.tags.usage(vip.id)).toBe(0);
      expect(await adapter.tags.forConversations([a.conversation.id, b.conversation.id])).toEqual({
        [a.conversation.id]: [],
        [b.conversation.id]: [kept],
      });
      expect(await adapter.tags.list({ tenantId })).toEqual([kept]);
      await expect(adapter.tags.delete(vip.id)).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "tag",
        id: vip.id,
      });
    });
  });
}
