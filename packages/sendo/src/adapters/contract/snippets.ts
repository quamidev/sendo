import { describe, expect, it } from "vitest";
import type { SnippetUpsertInput } from "../types";
import { type Fresh, NOT_FOUND, makeTenantId, seedAccount, tick, violates } from "./helpers";

const SHORTCUT_TAKEN = violates("sendo_snippets_shortcut_key");

/** Contract for `snippets`. */
export function snippetsContract(fresh: Fresh): void {
  describe("snippets", () => {
    const base = (overrides: Partial<SnippetUpsertInput> = {}): SnippetUpsertInput => ({
      tenantId: makeTenantId(),
      shortcut: "horario",
      body: "Atendemos de 8:00 a 17:00, {{nombre}}.",
      ...overrides,
    });

    it("inserts a tenant snippet with defaults and reads it back", async () => {
      const adapter = await fresh();
      const snippet = await adapter.snippets.upsert(base({ by: "user-ana" }));
      expect(snippet).toMatchObject({
        accountId: null,
        shortcut: "horario",
        body: "Atendemos de 8:00 a 17:00, {{nombre}}.",
        visibility: "tenant",
        ownerUserId: null,
        createdBy: "user-ana",
        updatedBy: "user-ana",
      });
      expect(snippet.createdAt).toBeInstanceOf(Date);
      expect(snippet.updatedAt).toBeInstanceOf(Date);
      expect(await adapter.snippets.get(snippet.id)).toEqual(snippet);
      expect(await adapter.snippets.get(crypto.randomUUID())).toBeNull();
    });

    it("updates by id within the tenant, keeping createdBy", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const account = await seedAccount(adapter, { tenantId });
      const snippet = await adapter.snippets.upsert(base({ tenantId, by: "user-ana" }));
      await tick();

      const updated = await adapter.snippets.upsert({
        id: snippet.id,
        tenantId,
        accountId: account.id,
        shortcut: "horario-sabado",
        body: "Sábados de 8:00 a 12:00.",
        by: "user-luis",
      });
      expect(updated).toMatchObject({
        id: snippet.id,
        accountId: account.id,
        shortcut: "horario-sabado",
        body: "Sábados de 8:00 a 12:00.",
        visibility: "tenant",
        createdBy: "user-ana",
        updatedBy: "user-luis",
        createdAt: snippet.createdAt,
      });
      expect(updated.updatedAt.getTime()).toBeGreaterThan(snippet.updatedAt.getTime());
      expect(await adapter.snippets.get(snippet.id)).toEqual(updated);

      const elsewhere = { ...base({ tenantId: makeTenantId() }), id: snippet.id };
      await expect(adapter.snippets.upsert(elsewhere)).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "snippet",
        id: snippet.id,
      });
      const unknown = crypto.randomUUID();
      await expect(adapter.snippets.upsert({ ...base(), id: unknown })).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "snippet",
        id: unknown,
      });
      expect((await adapter.snippets.get(snippet.id))?.shortcut).toBe("horario-sabado");
    });

    it("keeps shortcuts unique per tenant and owner", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const team = await adapter.snippets.upsert(base({ tenantId }));
      await expect(adapter.snippets.upsert(base({ tenantId }))).rejects.toMatchObject(
        SHORTCUT_TAKEN,
      );

      const personal = { tenantId, visibility: "personal" as const };
      await adapter.snippets.upsert(base({ ...personal, ownerUserId: "user-ana" }));
      await expect(
        adapter.snippets.upsert(base({ ...personal, ownerUserId: "user-ana" })),
      ).rejects.toMatchObject(SHORTCUT_TAKEN);
      await adapter.snippets.upsert(base({ ...personal, ownerUserId: "user-luis" }));
      await adapter.snippets.upsert(base({ tenantId: makeTenantId() }));

      const other = await adapter.snippets.upsert(base({ tenantId, shortcut: "precios" }));
      await expect(
        adapter.snippets.upsert({ ...base({ tenantId }), id: other.id }),
      ).rejects.toMatchObject(SHORTCUT_TAKEN);
      expect((await adapter.snippets.get(other.id))?.shortcut).toBe("precios");
      expect((await adapter.snippets.get(team.id))?.shortcut).toBe("horario");
    });

    it("enforces the shortcut format and the owner rule", async () => {
      const adapter = await fresh();
      for (const shortcut of ["Horario", "hola!", "", "x".repeat(33)]) {
        await expect(adapter.snippets.upsert(base({ shortcut }))).rejects.toMatchObject(
          violates("sendo_snippets_shortcut_check"),
        );
      }
      await expect(adapter.snippets.upsert(base({ visibility: "personal" }))).rejects.toMatchObject(
        violates("sendo_snippets_owner_check"),
      );
      await expect(
        adapter.snippets.upsert(base({ visibility: "tenant", ownerUserId: "user-ana" })),
      ).rejects.toMatchObject(violates("sendo_snippets_owner_check"));
    });

    it("lists tenant snippets plus the user's personal ones, by shortcut", async () => {
      const adapter = await fresh();
      const tenantId = makeTenantId();
      const accountA = await seedAccount(adapter, { tenantId });
      const accountB = await seedAccount(adapter, { tenantId });
      const make = (shortcut: string, overrides: Partial<SnippetUpsertInput> = {}) =>
        adapter.snippets.upsert(base({ tenantId, shortcut, ...overrides }));

      const precios = await make("precios");
      const anaHorario = await make("horario", { visibility: "personal", ownerUserId: "ana" });
      const horario = await make("horario");
      const luis = await make("adios", { visibility: "personal", ownerUserId: "luis" });
      const onlyA = await make("direccion-a", { accountId: accountA.id });
      const onlyB = await make("direccion-b", { accountId: accountB.id });
      await adapter.snippets.upsert(base({ shortcut: "ajeno" }));

      const ids = async (query: Parameters<typeof adapter.snippets.list>[0]) =>
        (await adapter.snippets.list(query)).map((s) => s.id);

      expect(await ids({ tenantId })).toEqual([onlyA.id, onlyB.id, horario.id, precios.id]);
      expect(await ids({ tenantId, userId: "ana" })).toEqual([
        onlyA.id,
        onlyB.id,
        horario.id,
        anaHorario.id,
        precios.id,
      ]);
      expect(await ids({ tenantId, userId: "luis", accountId: accountA.id })).toEqual([
        luis.id,
        onlyA.id,
        horario.id,
        precios.id,
      ]);
      expect(await adapter.snippets.list({ tenantId: makeTenantId(), userId: "ana" })).toEqual([]);
    });

    it("deletes by id and throws RecordNotFoundError for unknown ids", async () => {
      const adapter = await fresh();
      const snippet = await adapter.snippets.upsert(base());
      await adapter.snippets.delete(snippet.id);
      expect(await adapter.snippets.get(snippet.id)).toBeNull();
      await expect(adapter.snippets.delete(snippet.id)).rejects.toMatchObject({
        ...NOT_FOUND,
        entity: "snippet",
        id: snippet.id,
      });
    });
  });
}
