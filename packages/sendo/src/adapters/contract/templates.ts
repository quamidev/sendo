import { describe, expect, it } from "vitest";
import type { SendoAdapter } from "../types";
import { type Fresh, makeTemplateInput, seedAccount } from "./helpers";

/** Contract for `templates`. */
export function templatesContract(fresh: Fresh): void {
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
      expect((await adapter.templates.get(other.id, foreign?.name ?? "", "es"))?.active).toBe(true);

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

      const names = async (query: Parameters<SendoAdapter["templates"]["list"]>[0]) =>
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
}
